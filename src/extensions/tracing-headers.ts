import { PostHog } from '../posthog-core'
import { assignableWindow } from '../utils/globals'
import { logger } from '../utils/logger'
import { loadScript } from '../utils'
import Config from '../config'
import { isUndefined } from '../utils/type-utils'

const LOGGER_PREFIX = '[TRACING-HEADERS]'

export class TracingHeaders {
    private __restoreXHRPatch: (() => void) | undefined = undefined
    private __restoreFetchPatch: (() => void) | undefined = undefined

    constructor(private readonly __instance: PostHog) {}

    private __loadScript(cb: () => void): void {
        if (assignableWindow.postHogTracingHeadersPatchFns) {
            // already loaded
            cb()
        }

        loadScript(
            this.__instance.requestRouter.endpointFor('assets', `/static/tracing-headers.js?v=${Config.LIB_VERSION}`),
            (err) => {
                if (err) {
                    logger.error(LOGGER_PREFIX + ' failed to load script', err)
                }
                cb()
            }
        )
    }

    public startIfEnabledOrStop() {
        if (this.__instance.config.__add_tracing_headers) {
            this.__loadScript(this.__startCapturing)
        } else {
            this.__restoreXHRPatch?.()
            this.__restoreFetchPatch?.()
            // we don't want to call these twice so we reset them
            this.__restoreXHRPatch = undefined
            this.__restoreFetchPatch = undefined
        }
    }

    private __startCapturing = () => {
        // NB: we can assert sessionManager is present only because we've checked previously
        if (isUndefined(this.__restoreXHRPatch)) {
            assignableWindow.postHogTracingHeadersPatchFns._patchXHR(this.__instance.sessionManager!)
        }
        if (isUndefined(this.__restoreFetchPatch)) {
            assignableWindow.postHogTracingHeadersPatchFns._patchFetch(this.__instance.sessionManager!)
        }
    }
}
