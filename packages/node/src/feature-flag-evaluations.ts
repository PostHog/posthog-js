import { FeatureFlagValue, JsonType } from '@posthog/core'

import { FeatureFlagError } from './types'

/**
 * Internal per-flag record stored by a {@link FeatureFlagEvaluations} instance.
 * Not part of the public API.
 *
 * @internal
 */
export type EvaluatedFlagRecord = {
  key: string
  enabled: boolean
  variant: string | undefined
  payload: JsonType | undefined
  id: number | undefined
  version: number | undefined
  reason: string | undefined
  locallyEvaluated: boolean
}

/**
 * Parameters passed to the host when a `$feature_flag_called` event should be captured.
 *
 * @internal
 */
export type FlagCalledEventParams = {
  distinctId: string
  key: string
  response: FeatureFlagValue | undefined
  groups: Record<string, string | number> | undefined
  disableGeoip: boolean | undefined
  properties: Record<string, any>
}

/**
 * Thin interface the evaluations object uses to talk back to the PostHog client.
 * Keeps the class decoupled from the full client surface area.
 *
 * @internal
 */
export interface FeatureFlagEvaluationsHost {
  captureFlagCalledEventIfNeeded(params: FlagCalledEventParams): void
  logWarning(message: string): void
}

/**
 * A snapshot of feature flag evaluations for a single distinctId at a point in time.
 *
 * Returned by {@link IPostHog.evaluateFlags} — branch on `isEnabled()` / `getFlag()`
 * and pass the same object to `capture()` via the `flags` option so the captured event
 * carries the exact flag values the code branched on.
 *
 * ```ts
 * const flags = await posthog.evaluateFlags(distinctId, { personProperties: { plan: 'enterprise' } })
 *
 * if (flags.isEnabled('new-dashboard')) {
 *   renderNewDashboard()
 * }
 *
 * posthog.capture({ distinctId, event: 'page_viewed', flags })
 * ```
 */
export class FeatureFlagEvaluations {
  private readonly _host: FeatureFlagEvaluationsHost
  private readonly _distinctId: string
  private readonly _groups: Record<string, string | number> | undefined
  private readonly _disableGeoip: boolean | undefined
  private readonly _flags: Record<string, EvaluatedFlagRecord>
  private readonly _requestId: string | undefined
  private readonly _evaluatedAt: number | undefined
  private readonly _accessed: Set<string>

  /**
   * @internal — instances are created by the SDK via `posthog.evaluateFlags()`.
   */
  constructor(init: {
    host: FeatureFlagEvaluationsHost
    distinctId: string
    groups?: Record<string, string | number>
    disableGeoip?: boolean
    flags: Record<string, EvaluatedFlagRecord>
    requestId?: string
    evaluatedAt?: number
    accessed?: Set<string>
  }) {
    this._host = init.host
    this._distinctId = init.distinctId
    this._groups = init.groups
    this._disableGeoip = init.disableGeoip
    this._flags = init.flags
    this._requestId = init.requestId
    this._evaluatedAt = init.evaluatedAt
    this._accessed = init.accessed ?? new Set()
  }

  /**
   * Check whether a feature flag is enabled. Fires a `$feature_flag_called` event
   * on the first access per (distinctId, flag, value) tuple, deduped via the SDK's
   * existing cache.
   *
   * Flags that were not returned from the underlying evaluation are treated as
   * disabled (returns `false`).
   */
  isEnabled(key: string): boolean {
    const flag = this._flags[key]
    this._recordAccess(key)
    return flag?.enabled ?? false
  }

  /**
   * Get the evaluated value of a feature flag. Fires a `$feature_flag_called` event
   * on the first access per (distinctId, flag, value) tuple.
   *
   * Returns the variant string for multivariate flags, `true` for enabled flags
   * without a variant, `false` for disabled flags, and `undefined` for flags that
   * were not returned by the evaluation.
   */
  getFlag(key: string): FeatureFlagValue | undefined {
    const flag = this._flags[key]
    this._recordAccess(key)
    if (!flag) {
      return undefined
    }
    if (!flag.enabled) {
      return false
    }
    return flag.variant ?? true
  }

  /**
   * Get the payload associated with a feature flag. Does not count as an access
   * for `onlyAccessed()` and does not fire any event.
   */
  getFlagPayload(key: string): JsonType | undefined {
    return this._flags[key]?.payload
  }

  /**
   * Return a filtered copy containing only flags that have been accessed via
   * `isEnabled()` or `getFlag()` before this call. If no flags have been accessed,
   * logs a warning and returns a copy with all flags (to avoid dropping exposure
   * data silently).
   */
  onlyAccessed(): FeatureFlagEvaluations {
    if (this._accessed.size === 0) {
      this._host.logWarning(
        'FeatureFlagEvaluations.onlyAccessed() was called before any flags were accessed — attaching all evaluated flags as a fallback. See https://posthog.com/docs/feature-flags/server-sdks for details.'
      )
      return this._cloneWith(this._flags)
    }
    const filtered: Record<string, EvaluatedFlagRecord> = {}
    for (const key of this._accessed) {
      const flag = this._flags[key]
      if (flag) {
        filtered[key] = flag
      }
    }
    return this._cloneWith(filtered)
  }

  /**
   * Return a filtered copy containing only flags with the given keys. Keys that
   * are not present in the evaluation are dropped and logged as a warning.
   */
  only(keys: string[]): FeatureFlagEvaluations {
    const filtered: Record<string, EvaluatedFlagRecord> = {}
    const missing: string[] = []
    for (const key of keys) {
      const flag = this._flags[key]
      if (flag) {
        filtered[key] = flag
      } else {
        missing.push(key)
      }
    }
    if (missing.length > 0) {
      this._host.logWarning(
        `FeatureFlagEvaluations.only() was called with flag keys that are not in the evaluation set and will be dropped: ${missing.join(', ')}`
      )
    }
    return this._cloneWith(filtered)
  }

  /**
   * Returns the flag keys that are part of this evaluation.
   */
  get keys(): string[] {
    return Object.keys(this._flags)
  }

  /**
   * Build the `$feature/*` and `$active_feature_flags` event properties derived
   * from the current flag set. Called by `capture()` when an event is captured
   * with `flags: ...`.
   *
   * @internal
   */
  _getEventProperties(): Record<string, any> {
    const properties: Record<string, any> = {}
    const activeFlags: string[] = []
    for (const [key, flag] of Object.entries(this._flags)) {
      const value = flag.enabled === false ? false : (flag.variant ?? true)
      properties[`$feature/${key}`] = value
      if (flag.enabled) {
        activeFlags.push(key)
      }
    }
    if (activeFlags.length > 0) {
      activeFlags.sort()
      properties['$active_feature_flags'] = activeFlags
    }
    return properties
  }

  /**
   * @internal
   */
  _getDistinctId(): string {
    return this._distinctId
  }

  /**
   * @internal
   */
  _getGroups(): Record<string, string | number> | undefined {
    return this._groups
  }

  private _cloneWith(flags: Record<string, EvaluatedFlagRecord>): FeatureFlagEvaluations {
    return new FeatureFlagEvaluations({
      host: this._host,
      distinctId: this._distinctId,
      groups: this._groups,
      disableGeoip: this._disableGeoip,
      flags,
      requestId: this._requestId,
      evaluatedAt: this._evaluatedAt,
      // Copy the accessed set so the child can track further access independently
      // of the parent. Callers expect `onlyAccessed()` on the parent to reflect
      // only what the parent saw, not what happened on filtered views.
      accessed: new Set(this._accessed),
    })
  }

  private _recordAccess(key: string): void {
    this._accessed.add(key)

    const flag = this._flags[key]
    const response: FeatureFlagValue | undefined =
      flag === undefined ? undefined : flag.enabled === false ? false : (flag.variant ?? true)

    const properties: Record<string, any> = {
      $feature_flag: key,
      $feature_flag_response: response,
      $feature_flag_id: flag?.id,
      $feature_flag_version: flag?.version,
      $feature_flag_reason: flag?.reason,
      locally_evaluated: flag?.locallyEvaluated ?? false,
      [`$feature/${key}`]: response,
      $feature_flag_request_id: this._requestId,
      $feature_flag_evaluated_at: flag?.locallyEvaluated ? Date.now() : this._evaluatedAt,
    }

    if (flag === undefined) {
      properties.$feature_flag_error = FeatureFlagError.FLAG_MISSING
    }

    this._host.captureFlagCalledEventIfNeeded({
      distinctId: this._distinctId,
      key,
      response,
      groups: this._groups,
      disableGeoip: this._disableGeoip,
      properties,
    })
  }
}
