import { PostHog } from '../posthog-core'
import { assignableWindow } from '../utils/globals'
import { logger } from '../utils/logger'
import Config from '../config'
import { isUndefined } from '../utils/type-utils'

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

        this.instance.requestRouter.loadScript(`/static/tracing-headers.js?v=${Config.LIB_VERSION}`, (err) => {
            if (err) {
                logger.error(LOGGER_PREFIX + ' failed to load script', err)
            }
            cb()
        })
    }
    public startIfEnabledOrStop() {
        if (this.instance.config.__add_tracing_headers) {
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
        if (isUndefined(this._restoreXHRPatch)) {
            assignableWindow.postHogTracingHeadersPatchFns._patchXHR(this.instance.sessionManager!)
        }
        if (isUndefined(this._restoreFetchPatch)) {
            assignableWindow.postHogTracingHeadersPatchFns._patchFetch(this.instance.sessionManager!)
        }
    }
}
