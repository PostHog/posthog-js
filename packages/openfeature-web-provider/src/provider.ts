/**
 * Official PostHog provider for the OpenFeature **web** SDK
 * (`@openfeature/web-sdk`), backed by a configured `posthog-js` client.
 *
 * The browser model is single-user and synchronous: `posthog-js` owns the user
 * identity and keeps flags in memory, so evaluation is synchronous and the
 * static evaluation context is reconciled into the SDK whenever it changes
 * (the OpenFeature `onContextChange` contract).
 */
import type { EvaluationContext, JsonValue, Provider, ResolutionDetails } from '@openfeature/web-sdk'
import type { PostHog } from 'posthog-js'

import {
  resolveBooleanDetails,
  resolveNumberDetails,
  resolveObjectDetails,
  resolveStringDetails,
  splitContext,
} from './mapping'

export interface PostHogWebProviderOptions {
  /**
   * Forwarded to `getFeatureFlagResult` to control `$feature_flag_called`
   * capture. Defaults to `true` so PostHog flag analytics (and experiments)
   * keep working.
   */
  sendFeatureFlagEvents?: boolean
  /**
   * Maximum time in milliseconds that `initialize()` / `onContextChange()` will
   * wait for `posthog-js` to (re)load flags before resolving anyway. This is a
   * safety net: if the SDK never fires its flags callback after a reload (e.g.
   * `posthog.init()` was never called, or a network request fails silently),
   * the OpenFeature client would otherwise stay stuck in NOT_READY forever. On
   * timeout the provider becomes ready and serves whatever flags are cached.
   * Defaults to 5000.
   */
  reloadTimeoutMs?: number
}

/**
 * OpenFeature web provider backed by a configured `posthog-js` client.
 *
 * The caller owns the PostHog client lifecycle (init it, and manage the user
 * identity via `posthog.identify()` as usual). This provider does **not** call
 * `identify()` — `targetingKey` is therefore not used to switch users, since in
 * the browser the host app owns identity. The rest of the evaluation context is
 * reconciled into the SDK so it influences flag evaluation:
 *   - reserved `groups`           -> `posthog.group(type, key)`
 *   - reserved `groupProperties`  -> `posthog.group(type, key, properties)`
 *   - every other attribute       -> `posthog.setPersonPropertiesForFlags(...)`
 *
 * Note that `group()` and `setPersonPropertiesForFlags()` persist on the client
 * and may emit a `$groupidentify` event — the standard `posthog-js` behaviour.
 *
 * Flag-type mapping mirrors the server provider (boolean -> `enabled`, string
 * -> `variant`, number -> parsed `variant`, object -> `payload`).
 */
export class PostHogWebProvider implements Provider {
  public readonly runsOn = 'client'
  public readonly metadata = { name: 'PostHogWebProvider' } as const

  private readonly _client: PostHog
  private readonly _sendFeatureFlagEvents: boolean
  private readonly _reloadTimeoutMs: number

  constructor(client: PostHog, options: PostHogWebProviderOptions = {}) {
    this._client = client
    this._sendFeatureFlagEvents = options.sendFeatureFlagEvents ?? true
    this._reloadTimeoutMs = options.reloadTimeoutMs ?? 5000
  }

  async initialize(context?: EvaluationContext): Promise<void> {
    await this._reconcile(context)
  }

  async onContextChange(oldContext: EvaluationContext, newContext: EvaluationContext): Promise<void> {
    // The web SDK runs this handler on every setContext() call with no equality
    // check, so a host that re-sets an equivalent context (e.g. a React
    // integration passing a fresh object each render) would otherwise trigger a
    // $groupidentify and a flag reload every time. Skip when nothing changed.
    if (deepEqual(oldContext, newContext)) {
      return
    }
    await this._reconcile(newContext)
  }

  resolveBooleanEvaluation(flagKey: string, _defaultValue: boolean): ResolutionDetails<boolean> {
    return resolveBooleanDetails(this._evaluate(flagKey), flagKey)
  }

  resolveStringEvaluation(flagKey: string, defaultValue: string): ResolutionDetails<string> {
    return resolveStringDetails(this._evaluate(flagKey), flagKey, defaultValue)
  }

  resolveNumberEvaluation(flagKey: string, defaultValue: number): ResolutionDetails<number> {
    return resolveNumberDetails(this._evaluate(flagKey), flagKey, defaultValue)
  }

  resolveObjectEvaluation<T extends JsonValue>(flagKey: string, defaultValue: T): ResolutionDetails<T> {
    return resolveObjectDetails<T>(this._evaluate(flagKey), flagKey, defaultValue)
  }

  private _evaluate(flagKey: string): ReturnType<PostHog['getFeatureFlagResult']> {
    return this._client.getFeatureFlagResult(flagKey, { send_event: this._sendFeatureFlagEvents })
  }

  /**
   * Reconcile the evaluation context into `posthog-js` and wait for flags to
   * (re)load. Person properties and groups are applied with their own reloads
   * suppressed where possible; a single trailing `reloadFeatureFlags()` (which
   * `posthog-js` debounces with any others) is then awaited so OpenFeature
   * treats reconciliation as complete only once fresh flags are available.
   */
  private async _reconcile(context?: EvaluationContext): Promise<void> {
    const { personProperties, groups, groupProperties } = splitContext(context)

    if (Object.keys(personProperties).length > 0) {
      this._client.setPersonPropertiesForFlags(personProperties, false)
    }
    for (const [groupType, groupKey] of Object.entries(groups)) {
      this._client.group(groupType, groupKey, groupProperties[groupType])
    }

    await this._reloadFlags()
  }

  private _reloadFlags(): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false
      let subscribed = false
      // Cleanups are collected as they're created so `finish` never has to
      // reference `unsubscribe`/`timer` before they're declared below.
      const cleanups: Array<() => void> = []

      const finish = (): void => {
        if (settled) {
          return
        }
        settled = true
        cleanups.forEach((fn) => fn())
        resolve()
      }

      // `onFeatureFlags` fires synchronously on subscribe if flags are already
      // loaded; ignore that immediate call (it happens before `subscribed` is
      // set) and resolve only on the callback that follows our reload request.
      const unsubscribe = this._client.onFeatureFlags(() => {
        if (subscribed) {
          finish()
        }
      })
      // Safety net: resolve anyway if posthog-js never delivers the callback
      // (uninitialised SDK, silent network failure, ...) so the OpenFeature
      // client can't get stuck NOT_READY forever.
      const timer = setTimeout(finish, this._reloadTimeoutMs)
      cleanups.push(unsubscribe, () => clearTimeout(timer))
      subscribed = true
      this._client.reloadFeatureFlags()
    })
  }
}

/**
 * Deep structural equality for evaluation contexts (which are JSON-like, with
 * possibly-nested `groupProperties`). Used to skip redundant reconciliation
 * when the host re-sets an equivalent context.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }
  const aKeys = Object.keys(a as Record<string, unknown>)
  const bKeys = Object.keys(b as Record<string, unknown>)
  if (aKeys.length !== bKeys.length) {
    return false
  }
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  )
}
