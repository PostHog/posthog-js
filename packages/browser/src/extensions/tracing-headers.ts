import { PostHog } from '../posthog-core'
import { posthogExtensions } from '../utils/globals'
import { createLogger } from '../utils/logger'
import { isUndefined } from '@posthog/core'

const logger = createLogger('[TracingHeaders]')

export class TracingHeaders {
    private _restoreXHRPatch: (() => void) | undefined = undefined
    private _restoreFetchPatch: (() => void) | undefined = undefined

    constructor(private readonly _instance: PostHog) {}

    private _loadScript(cb: () => void): void {
        if (posthogExtensions?.tracingHeadersPatchFns) {
            // already loaded
            cb()
        }

        posthogExtensions?.loadExternalDependency?.(this._instance, 'tracing-headers', (err) => {
            if (err) {
                return logger.error('failed to load script', err)
            }
            cb()
        })
    }
    public startIfEnabledOrStop() {
        if (this._instance.config.__add_tracing_headers) {
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
        if (isUndefined(this._restoreXHRPatch)) {
            posthogExtensions?.tracingHeadersPatchFns?._patchXHR(
                this._instance.config.__add_tracing_headers || [],
                this._instance.get_distinct_id(),
                this._instance.sessionManager
            )
        }
        if (isUndefined(this._restoreFetchPatch)) {
            posthogExtensions?.tracingHeadersPatchFns?._patchFetch(
                this._instance.config.__add_tracing_headers || [],
                this._instance.get_distinct_id(),
                this._instance.sessionManager
            )
        }
    }
}
