import { PostHog } from '../posthog-core'
import { assignableWindow, window } from '../utils/globals'
import { logger } from '../utils/logger'
import { loadScript } from '../utils'
import Config from '../config'

const LOGGER_PREFIX = '[TRACING-HEADERS]'

export class TracingHeaders {
    private _restoreXHRPatch: (() => void) | undefined = undefined
    private _restoreFetchPatch: (() => void) | undefined = undefined

    constructor(private readonly instance: PostHog) {}

    private _loadScript(cb: () => void): void {
        if (assignableWindow.postHogTracingHeadersPatchFns) {
            // already loaded
            cb()
        }

        loadScript(
            this.instance.requestRouter.endpointFor('assets', `/static/tracing-headers.js?v=${Config.LIB_VERSION}`),
            (err) => {
                if (err) {
                    logger.error(LOGGER_PREFIX + ' failed to load script', err)
                }
                cb()
            }
        )
    }
    public startIfEnabledOrStop() {
        if (this.instance.config.__add_tracing_headers && this._canPatch()) {
            this._loadScript(this._startCapturing)
        } else {
            this._restoreXHRPatch?.()
            this._restoreFetchPatch?.()
            // we don't want to call these twice so we reset them
            this._restoreXHRPatch = undefined
            this._restoreFetchPatch = undefined
        }
    }

    private _startCapturing = () => {
        // NB: we can assert sessionManager is present only because we've checked previously
        assignableWindow.postHogTracingHeadersPatchFns._patchXHR(this.instance.sessionManager!)
        assignableWindow.postHogTracingHeadersPatchFns._patchFetch(this.instance.sessionManager!)
    }

    private _canPatch() {
        const skipping = 'skipping fetch patching'

        if (!window) {
            logger.warn(LOGGER_PREFIX + ' window is not available, ' + skipping)
            return false
        }
        if (!window.fetch) {
            logger.warn(LOGGER_PREFIX + ' window.fetch is not available, ' + skipping)
            return false
        }
        if (this._restoreFetchPatch || this._restoreXHRPatch) {
            logger.warn(LOGGER_PREFIX + ' already patched, ' + skipping)
            return false
        }

        if (!this.instance.sessionManager) {
            logger.warn(LOGGER_PREFIX + ' sessionManager is not available, ' + skipping)
            return false
        }

        return true
    }
}
