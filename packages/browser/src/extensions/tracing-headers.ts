import { PostHog } from '../posthog-core'
import { assignableWindow } from '../utils/globals'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { isArray, isString, isUndefined } from '@posthog/core'
import type { TraceparentTargets, TracingHeadersHostnames } from './tracing-headers-types'
import type { Extension } from './types'

const logger = /* @__PURE__ */ createLogger('[TracingHeaders]')

export class TracingHeaders implements Extension {
    private _restoreXHRPatch: (() => void) | undefined = undefined
    private _restoreFetchPatch: (() => void) | undefined = undefined
    private _hostnamesForPatch: TracingHeadersHostnames = undefined
    // The hostnames value the installed patches were given.
    private _patchedHostnames: TracingHeadersHostnames = undefined
    // Mutated in place (never reassigned) so already-installed patches see config changes.
    private readonly _traceparentTargetsForPatch: string[] = []

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

        if (isArray(this._hostnamesForPatch)) {
            // we empty the array before reassignment because there may be existing
            // fetch/XHR patches reading this array. if we're in a situation where
            // we're reapplying a patch and it fails for any reason, we've at least
            // avoided sending headers to stale hostnames.
            this._hostnamesForPatch.splice(0)
            if (!hostnames) {
                // keep the (now empty) array instance: installed patches may still be reading it for
                // trace_propagation_targets, and re-enabling tracing_headers later must reach them
                return undefined
            }
        }

        this._hostnamesForPatch = hostnames || undefined
        return this._hostnamesForPatch
    }

    private _syncTraceparentTargetsForPatch(): TraceparentTargets {
        const configured = this._instance.config.trace_propagation_targets
        const targets = isArray(configured) ? configured.filter((target) => isString(target) && !!target) : []
        this._traceparentTargetsForPatch.splice(0, this._traceparentTargetsForPatch.length, ...targets)
        return targets.length > 0 ? this._traceparentTargetsForPatch : undefined
    }

    private _syncForPatch(): { hostnames: TracingHeadersHostnames; traceparentTargets: TraceparentTargets } {
        return {
            hostnames: this._syncHostnamesForPatch(),
            traceparentTargets: this._syncTraceparentTargetsForPatch(),
        }
    }

    private _stopCapturing(): void {
        this._restoreXHRPatch?.()
        this._restoreFetchPatch?.()
        // we don't want to call these twice so we reset them
        this._restoreXHRPatch = undefined
        this._restoreFetchPatch = undefined
    }

    public startIfEnabledOrStop() {
        const { hostnames, traceparentTargets } = this._syncForPatch()
        if (hostnames || traceparentTargets) {
            this._loadScript(this._startCapturing)
        } else {
            this._stopCapturing()
        }
    }

    private _startCapturing = () => {
        const { hostnames, traceparentTargets } = this._syncForPatch()
        if (!hostnames && !traceparentTargets) {
            this._stopCapturing()
            return
        }
        // Always hand the patches the live arrays, even when one feature is currently empty, so enabling it
        // later via set_config takes effect without re-patching.
        if (!hostnames && !isArray(this._hostnamesForPatch)) {
            this._hostnamesForPatch = []
        }
        // Arrays reach installed patches in place, but a boolean (legacy `__add_tracing_headers: true`) is captured
        // by value, so when the hostnames value itself changes the patches must be reinstalled to drop it.
        if (this._patchedHostnames !== this._hostnamesForPatch) {
            this._stopCapturing()
            this._patchedHostnames = this._hostnamesForPatch
        }

        if (isUndefined(this._restoreXHRPatch)) {
            this._restoreXHRPatch = assignableWindow.__PosthogExtensions__?.tracingHeadersPatchFns?._patchXHR(
                this._hostnamesForPatch,
                () => this._instance.get_distinct_id(),
                this._instance.sessionManager,
                this._traceparentTargetsForPatch
            )
        }
        if (isUndefined(this._restoreFetchPatch)) {
            this._restoreFetchPatch = assignableWindow.__PosthogExtensions__?.tracingHeadersPatchFns?._patchFetch(
                this._hostnamesForPatch,
                () => this._instance.get_distinct_id(),
                this._instance.sessionManager,
                this._traceparentTargetsForPatch
            )
        }
    }
}
