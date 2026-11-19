import { patchFetch, patchXHR } from '@posthog/browser-common/utils/tracing-headers'
import type { TracingHeadersSession } from '@posthog/browser-common/utils/tracing-headers'
import type { BrowserExtension } from '../../core/context/browser-client'
import type { IPostHog } from '../../core/types'
import { analyticsOf } from '../analytics/analytics-of'
import { snapshotTracingHeadersOptions, type TracingHeadersOptions } from './tracing-headers-options'

export type { TracingHeadersOptions } from './tracing-headers-options'

/**
 * Reads the session the next capture would use without starting, extending, rotating or announcing one, so a
 * request never changes session state. `undefined` omits the session header until capture starts a session.
 */
const readSession = (client: IPostHog): TracingHeadersSession | undefined =>
    analyticsOf(client)?._core._state.peekSession()

/**
 * Add PostHog tracing headers and W3C `traceparent` to matching `fetch` and `XMLHttpRequest` requests.
 * Identity and session are read for each request. PostHog headers are omitted while capture is not permitted.
 */
export const tracingHeaders = (options: TracingHeadersOptions = {}): BrowserExtension => {
    const snapshot = snapshotTracingHeadersOptions(options)
    const restores: Array<() => void> = []
    let client: IPostHog | undefined

    // A failed read is logged and rethrown, so the request is sent without any PostHog headers rather than some.
    const whenCapturing =
        <T>(read: (posthog: IPostHog) => T | undefined) =>
        (): T | undefined => {
            try {
                return client?.canCapture ? read(client) : undefined
            } catch (error) {
                client?.logger.error('Tracing headers could not read the current identity', error)
                throw error
            }
        }
    // Adopt an identity another subdomain stored first, as capture does, so it pairs with the session read next.
    const distinctId = whenCapturing((posthog) => (analyticsOf(posthog)?._canMutate(), posthog.distinctId))
    const session = whenCapturing(readSession)

    return {
        name: 'tracingHeaders',
        setup: (value: IPostHog) => {
            client = value
            if (!snapshot) return
            let browserWindow: (Window & typeof globalThis) | undefined
            try {
                browserWindow = globalThis.window
            } catch {
                /* Non-browser host. */
            }
            const { hostnames, tracePropagationTargets } = snapshot
            const targets = tracePropagationTargets.length ? tracePropagationTargets : undefined
            restores.push(
                patchFetch(browserWindow, hostnames, distinctId, session, targets),
                patchXHR(browserWindow, hostnames, distinctId, session, targets)
            )
        },
        dispose: () => {
            client = undefined
            // A wrapper installed after ours can keep calling it, so make it inert before trying to unlink it. The
            // patches read these arrays for each request, and a disposed extension is never set up again.
            if (snapshot) {
                snapshot.hostnames.length = 0
                snapshot.tracePropagationTargets.length = 0
            }
            for (const restore of restores.splice(0).reverse()) restore()
        },
    }
}
