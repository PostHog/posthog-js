import { SessionIdManager } from '../sessionid'
import { patchFetch, patchXHR } from '@posthog/browser-common/utils/tracing-headers'
import type {
    TracingHeadersDistinctIdProvider,
    TracingHeadersSessionProvider,
} from '@posthog/browser-common/utils/tracing-headers'
import { window } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from '../utils/globals'
import { COOKIELESS_SENTINEL_VALUE } from '../constants'
import { isFunction } from '@posthog/core'
import type {
    TraceparentTargets,
    TracingHeadersDistinctId,
    TracingHeadersHostnames,
} from '../extensions/tracing-headers-types'

// Cores call these lazily loaded functions with this signature, so keep it stable and adapt
// posthog-js state to the shared patches here.
const readDistinctId =
    (distinctId: TracingHeadersDistinctId): TracingHeadersDistinctIdProvider =>
    () => {
        const current = isFunction(distinctId) ? distinctId() : distinctId
        return current === COOKIELESS_SENTINEL_VALUE ? undefined : current
    }

const readSession = (sessionManager: SessionIdManager | undefined): TracingHeadersSessionProvider | undefined =>
    sessionManager && (() => sessionManager.checkAndGetSessionAndWindowId(true))

const adapt =
    (patchFn: typeof patchFetch) =>
    (
        hostnames: TracingHeadersHostnames,
        distinctId: TracingHeadersDistinctId,
        sessionManager?: SessionIdManager,
        traceparentTargets?: TraceparentTargets
    ): (() => void) =>
        patchFn(window, hostnames, readDistinctId(distinctId), readSession(sessionManager), traceparentTargets)

const patchFns = {
    _patchFetch: adapt(patchFetch),
    _patchXHR: adapt(patchXHR),
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.tracingHeadersPatchFns = patchFns

// we used to put tracingHeadersPatchFns on window, and now we put it on __PosthogExtensions__
// but that means that old clients which lazily load this extension are looking in the wrong place
// yuck,
// so we also put it directly on the window
// when 1.161.1 is the oldest version seen in production we can remove this
assignableWindow.postHogTracingHeadersPatchFns = patchFns

export default patchFns
