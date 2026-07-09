/**
 * Official PostHog provider for the OpenFeature **server** SDK
 * (`@openfeature/server-sdk`), backed by a configured `posthog-node` client.
 *
 * This is the JS counterpart of the Python `PostHogProvider`: the server model
 * is stateless and multi-user, so the distinct id arrives per evaluation (from
 * the context's `targetingKey`) and resolution is asynchronous.
 */
import {
  TargetingKeyMissingError,
  type EvaluationContext,
  type JsonValue,
  type Provider,
  type ResolutionDetails,
} from '@openfeature/server-sdk'
import type { PostHog } from 'posthog-node'

import {
  resolveBooleanDetails,
  resolveNumberDetails,
  resolveObjectDetails,
  resolveStringDetails,
  splitContext,
  type PostHogFlagResult,
} from './mapping'

export interface PostHogServerProviderOptions {
  /**
   * Distinct id to use when the evaluation context has no `targetingKey`. When
   * omitted, a missing targeting key raises `TargetingKeyMissingError` (the
   * OpenFeature-idiomatic behaviour). Set a value (e.g. `'anonymous'`) to opt
   * into anonymous evaluation.
   */
  defaultDistinctId?: string
  /**
   * Forwarded to `getFeatureFlagResult` to control `$feature_flag_called`
   * capture. Defaults to `true` so PostHog flag analytics (and experiments)
   * keep working.
   */
  sendFeatureFlagEvents?: boolean
}

/**
 * OpenFeature server provider backed by a configured `posthog-node` client.
 *
 * The caller owns the PostHog client lifecycle: construct and configure the
 * client yourself (project key, `personalApiKey` for local evaluation, `host`,
 * ...), then hand it to this provider.
 *
 * Evaluation-context mapping:
 *   - `targetingKey`              -> PostHog `distinctId`
 *   - reserved `groups`           -> PostHog `groups`
 *   - reserved `groupProperties`  -> PostHog `groupProperties`
 *   - every other attribute       -> PostHog `personProperties`
 *
 * Flag-type mapping (all via `getFeatureFlagResult`):
 *   - boolean -> `enabled`
 *   - string  -> the multivariate `variant` key
 *   - number  -> the `variant` parsed as a number
 *   - object  -> the flag's JSON `payload`
 */
export class PostHogServerProvider implements Provider {
  public readonly runsOn = 'server'
  public readonly metadata = { name: 'PostHogServerProvider' } as const

  private readonly _client: PostHog
  private readonly _defaultDistinctId?: string
  private readonly _sendFeatureFlagEvents: boolean

  constructor(client: PostHog, options: PostHogServerProviderOptions = {}) {
    this._client = client
    this._defaultDistinctId = options.defaultDistinctId
    this._sendFeatureFlagEvents = options.sendFeatureFlagEvents ?? true
  }

  async initialize(): Promise<void> {
    // Preload locally-evaluated flag definitions. reloadFeatureFlags() safely
    // no-ops without a personalApiKey, and never rejects: posthog-node swallows
    // its poller errors internally and surfaces the client/network-error class
    // (ClientError: 401/403/429, bad response) via its `error` event. So listen
    // on that channel around the reload to surface a genuine misconfiguration
    // on a client set up for local evaluation. Remote evaluation still works
    // regardless, so this never blocks readiness.
    //
    // Caveat: posthog-node only routes ClientError through `error`, so a raw
    // network/DNS failure on a bad `host` still won't surface here.
    let preloadError: Error | undefined
    const unsubscribe = this._client.on('error', (err: Error) => {
      preloadError = err
    })
    try {
      await this._client.reloadFeatureFlags()
    } finally {
      unsubscribe()
    }
    if (preloadError) {
      // eslint-disable-next-line no-console
      console.warn(
        '[PostHogServerProvider] initialize() flag preload failed; remote evaluation still available.',
        preloadError
      )
    }
  }

  async resolveBooleanEvaluation(
    flagKey: string,
    _defaultValue: boolean,
    context: EvaluationContext
  ): Promise<ResolutionDetails<boolean>> {
    return resolveBooleanDetails(await this._evaluate(flagKey, context), flagKey)
  }

  async resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext
  ): Promise<ResolutionDetails<string>> {
    return resolveStringDetails(await this._evaluate(flagKey, context), flagKey, defaultValue)
  }

  async resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext
  ): Promise<ResolutionDetails<number>> {
    return resolveNumberDetails(await this._evaluate(flagKey, context), flagKey, defaultValue)
  }

  async resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext
  ): Promise<ResolutionDetails<T>> {
    return resolveObjectDetails<T>(await this._evaluate(flagKey, context), flagKey, defaultValue)
  }

  private async _evaluate(flagKey: string, context: EvaluationContext): Promise<PostHogFlagResult | undefined> {
    const distinctId = this._resolveDistinctId(context)
    const { personProperties, groups, groupProperties } = splitContext(context)
    return this._client.getFeatureFlagResult(flagKey, distinctId, {
      groups: Object.keys(groups).length > 0 ? groups : undefined,
      personProperties:
        Object.keys(personProperties).length > 0 ? (personProperties as Record<string, string>) : undefined,
      groupProperties:
        Object.keys(groupProperties).length > 0
          ? (groupProperties as Record<string, Record<string, string>>)
          : undefined,
      sendFeatureFlagEvents: this._sendFeatureFlagEvents,
    })
  }

  private _resolveDistinctId(context: EvaluationContext): string {
    if (context?.targetingKey) {
      return context.targetingKey
    }
    if (this._defaultDistinctId !== undefined) {
      return this._defaultDistinctId
    }
    throw new TargetingKeyMissingError('No targetingKey in evaluation context and no defaultDistinctId configured.')
  }
}
