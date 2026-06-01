import { PostHog } from '../posthog-core'
import { assignableWindow } from '../utils/globals'
import { createLogger } from '../utils/logger'
import { isArray, isUndefined } from '@posthog/core'
import type { Extension } from './types'

const logger = createLogger('[TracingHeaders]')

type TracingHeadersHostnames = string[] | boolean | undefined

export class TracingHeaders implements Extension {
    private _restoreXHRPatch: (() => void) | undefined = undefined
    private _restoreFetchPatch: (() => void) | undefined = undefined
    private _hostnamesForPatch: TracingHeadersHostnames = undefined

    constructor(private readonly _instance: PostHog) {}

    initialize() {
        this.startIfEnabledOrStop()
    }

    private _loadScript(cb: () => void): void {
        if (assignableWindow.__PosthogExtensions__?.tracingHeadersPatchFns) {
            // already loaded
            cb()
            return
        }

        assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this._instance, 'tracing-headers', (err) => {
            if (err) {
                return logger.error('failed to load script', err)
            }
            cb()
        })
    }
    private _getConfiguredHostnames(): string[] | boolean | undefined {
        // Prefer the public `tracing_headers` option; fall back to deprecated aliases.
        return (
            this._instance.config.tracing_headers ??
            this._instance.config.addTracingHeaders ??
            this._instance.config.__add_tracing_headers
        )
    }

    private _syncHostnamesForPatch(): TracingHeadersHostnames {
        const hostnames = this._getConfiguredHostnames()

        if (isArray(hostnames)) {
            if (isArray(this._hostnamesForPatch)) {
                this._hostnamesForPatch.splice(0, this._hostnamesForPatch.length, ...hostnames)
            } else {
                this._hostnamesForPatch = [...hostnames]
            }
            return hostnames.length > 0 ? this._hostnamesForPatch : undefined
        }

        // If an already-installed wrapper captured an array, empty it before switching away so it stops matching.
        if (isArray(this._hostnamesForPatch)) {
            this._hostnamesForPatch.splice(0)
        }
        this._hostnamesForPatch = hostnames || undefined
        return this._hostnamesForPatch
    }

    private _stopCapturing(): void {
        this._restoreXHRPatch?.()
        this._restoreFetchPatch?.()
        // we don't want to call these twice so we reset them
        this._restoreXHRPatch = undefined
        this._restoreFetchPatch = undefined
    }

    public startIfEnabledOrStop() {
        if (this._syncHostnamesForPatch()) {
            this._loadScript(this._startCapturing)
        } else {
            this._stopCapturing()
        }
    }

    private _startCapturing = () => {
        const hostnames = this._syncHostnamesForPatch()
        if (!hostnames) {
            this._stopCapturing()
            return
        }

        if (isUndefined(this._restoreXHRPatch)) {
            this._restoreXHRPatch = assignableWindow.__PosthogExtensions__?.tracingHeadersPatchFns?._patchXHR(
                hostnames,
                this._instance.get_distinct_id(),
                this._instance.sessionManager
            )
        }
        if (isUndefined(this._restoreFetchPatch)) {
            this._restoreFetchPatch = assignableWindow.__PosthogExtensions__?.tracingHeadersPatchFns?._patchFetch(
                hostnames,
                this._instance.get_distinct_id(),
                this._instance.sessionManager
            )
        }
    }
}
