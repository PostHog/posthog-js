import { assignableWindow } from '../utils/globals'
import { createLogger } from '../utils/logger'
import { isUndefined } from '@posthog/core'
import { PostHogComponent } from '../posthog-component'

const logger = createLogger('[TracingHeaders]')

export class TracingHeaders extends PostHogComponent {
    private _restoreXHRPatch: (() => void) | undefined = undefined
    private _restoreFetchPatch: (() => void) | undefined = undefined

    private _loadScript(cb: () => void): void {
        if (assignableWindow.__PosthogExtensions__?.tracingHeadersPatchFns) {
            // already loaded
            cb()
        }

        assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this._instance, 'tracing-headers', (err) => {
            if (err) {
                return logger.error('failed to load script', err)
            }
            cb()
        })
    }
    public startIfEnabledOrStop() {
        if (this._config.__add_tracing_headers) {
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
            assignableWindow.__PosthogExtensions__?.tracingHeadersPatchFns?._patchXHR(
                this._config.__add_tracing_headers || [],
                this._instance.get_distinct_id(),
                this._instance.sessionManager
            )
        }
        if (isUndefined(this._restoreFetchPatch)) {
            assignableWindow.__PosthogExtensions__?.tracingHeadersPatchFns?._patchFetch(
                this._config.__add_tracing_headers || [],
                this._instance.get_distinct_id(),
                this._instance.sessionManager
            )
        }
    }
}
