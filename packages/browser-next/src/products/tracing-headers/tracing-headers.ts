import { patchFetch, patchXHR } from '@posthog/browser-common/utils/tracing-headers'
import type { TracingHeadersSession } from '@posthog/browser-common/utils/tracing-headers'
import type { BrowserExtension } from '../../core/context/browser-client'
import type { IPostHog, NewSessionReason } from '../../core/types'
import { analyticsOf } from '../analytics/analytics-core'
import { snapshotTracingHeadersOptions, type TracingHeadersOptions } from './tracing-headers-options'

export type { TracingHeadersOptions } from './tracing-headers-options'

const MAX_SESSION_LENGTH = 86_400_000

/**
 * Returns the persisted session without extending it or rotating it for inactivity, matching posthog-js's
 * read-only session check, so background requests neither keep a session alive nor rotate it for inactivity.
 * Starts a session, as capture would, only when none exists, a reset is pending, or it reached its maximum length.
 */
const readSession = (client: IPostHog): TracingHeadersSession | undefined => {
    const analytics = analyticsOf(client)
    const state = analytics?._core._state
    if (!state) return undefined
    const previous = state.session
    let current = state.peekSession()
    let reason: NewSessionReason | undefined
    // Like posthog-js, a session past its maximum length rotates even on a read-only check.
    if (!(current && Date.now() - current.sessionStartTimestamp <= MAX_SESSION_LENGTH)) {
        const prepared = state.prepareSessionForEvent()
        if (state.sessionAdmitted(prepared)) {
            current = prepared.context
            reason = prepared.reason
        } else {
            current = state.peekSession()
        }
    }
    // Reading can commit a session or this tab's window ID, so notify observers as capture would have.
    analytics._publishSessionCommit(previous, state.session, reason)
    return current
}

/**
 * Add PostHog tracing headers and W3C `traceparent` to matching `fetch` and `XMLHttpRequest` requests.
 * Identity and session are read for each request. PostHog headers are omitted while capture is not permitted.
 */
export const tracingHeaders = (options: TracingHeadersOptions = {}): BrowserExtension => {
    const snapshot = snapshotTracingHeadersOptions(options)
    const restores: Array<() => void> = []
    let client: IPostHog | undefined

    // Read failures are logged and treated as missing values, so one failed read does not drop the other headers.
    const whenCapturing =
        <T>(read: (posthog: IPostHog) => T | undefined) =>
        (): T | undefined => {
            try {
                return client?.canCapture ? read(client) : undefined
            } catch (error) {
                client?.logger.error('Tracing headers could not read the current identity', error)
                return undefined
            }
        }
    const distinctId = whenCapturing((posthog) => posthog.distinctId)
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
