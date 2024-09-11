import { PostHog } from '../posthog-core'
import { assignableWindow } from '../utils/globals'
import { logger } from '../utils/logger'
import { isUndefined } from '../utils/type-utils'

const LOGGER_PREFIX = '[TRACING-HEADERS]'

export class TracingHeaders {
    private _restoreXHRPatch: (() => void) | undefined = undefined
    private _restoreFetchPatch: (() => void) | undefined = undefined

    constructor(private readonly instance: PostHog) {}

    private _loadScript(cb: () => void): void {
        if (assignableWindow.__PosthogExtensions__?.tracingHeadersPatchFns) {
            // already loaded
            cb()
        }

        assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this.instance, 'tracing-headers', (err) => {
            if (err) {
                return logger.error(LOGGER_PREFIX + ' failed to load script', err)
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
            assignableWindow.__PosthogExtensions__?.tracingHeadersPatchFns?._patchXHR(this.instance.sessionManager!)
        }
        if (isUndefined(this._restoreFetchPatch)) {
            assignableWindow.__PosthogExtensions__?.tracingHeadersPatchFns?._patchFetch(this.instance.sessionManager!)
        }
    }
}
