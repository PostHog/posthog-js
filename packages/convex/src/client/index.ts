import type { Scheduler } from 'convex/server'
import type { ComponentApi } from '../component/_generated/component.js'
import {
  type FeatureFlagResult,
  type FeatureFlagValue,
  type FlagDefinitions,
  type JsonType,
  LocalFeatureFlagEvaluator,
} from './feature-flags/index.js'

/** Context with a scheduler — available in mutations and actions. */
type SchedulerCtx = { scheduler: Scheduler }

/** Context with runQuery — available in queries, mutations, and actions. */
type RunQueryCtx = { runQuery: (reference: any, args: any) => Promise<any> }

/** Context with runAction — available in actions. Used by remote flag evaluation methods. */
type RunActionCtx = { runAction: (reference: any, args: any) => Promise<any> }

type FeatureFlagOptions = {
  groups?: Record<string, string>
  personProperties?: Record<string, any>
  groupProperties?: Record<string, Record<string, any>>
  disableGeoip?: boolean
}

type AllFlagsOptions = FeatureFlagOptions & { flagKeys?: string[] }

export type { FeatureFlagResult, FeatureFlagValue, JsonType }

export type PostHogEvent = {
  event: string
  distinctId: string
  properties?: Record<string, unknown>
}

export type BeforeSendFn = (event: PostHogEvent) => PostHogEvent | null

export type IdentifyFn = (ctx: any) => Promise<{ distinctId: string } | null>

export function normalizeError(error: unknown): {
  message: string
  stack?: string
  name?: string
} {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack, name: error.name }
  }
  if (typeof error === 'string') {
    return { message: error }
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    const obj = error as {
      message: string
      stack?: unknown
      name?: unknown
    }
    return {
      message: obj.message,
      stack: typeof obj.stack === 'string' ? obj.stack : undefined,
      name: typeof obj.name === 'string' ? obj.name : undefined,
    }
  }
  return { message: String(error) }
}

/**
 * Client-side wrapper around the PostHog Convex component.
 *
 * Credentials (`POSTHOG_PROJECT_TOKEN`, `POSTHOG_HOST`, `POSTHOG_PERSONAL_API_KEY`) are declared on the
 * component in `convex.config.ts` and read directly inside the component's actions — they don't
 * need to be plumbed through every call site. Configure callbacks (identify, beforeSend) on the
 * client; everything else lives in env vars.
 */
export class PostHog {
  private beforeSend?: BeforeSendFn | BeforeSendFn[]
  private identifyFn?: IdentifyFn

  constructor(
    public component: ComponentApi,
    options?: {
      beforeSend?: BeforeSendFn | BeforeSendFn[]
      identify?: IdentifyFn
    }
  ) {
    this.beforeSend = options?.beforeSend
    this.identifyFn = options?.identify
  }

  /**
   * Trigger a one-off refresh of the cached feature flag definitions. Named for parity with
   * `posthog-node`'s `reloadFeatureFlags()`. The component already refreshes on a cron when
   * `POSTHOG_PERSONAL_API_KEY` is set, so call this only when you need an immediate refresh
   * (e.g. after creating a flag in development). Requires an action context.
   */
  async reloadFeatureFlags(ctx: RunActionCtx): Promise<unknown> {
    return await ctx.runAction(this.component.lib.refreshFlagDefinitions, {})
  }

  private async resolveDistinctId(ctx: unknown, argsDistinctId?: string): Promise<string> {
    if (this.identifyFn) {
      const result = await this.identifyFn(ctx)
      if (result) return result.distinctId
    }
    if (argsDistinctId) return argsDistinctId
    throw new Error(
      'PostHog: Could not resolve distinctId. Either configure an identify callback ' +
        'in the PostHog constructor or pass distinctId explicitly.'
    )
  }

  private runBeforeSend(event: PostHogEvent): PostHogEvent | null {
    if (!this.beforeSend) return event
    const fns = Array.isArray(this.beforeSend) ? this.beforeSend : [this.beforeSend]
    let result: PostHogEvent | null = event
    for (const fn of fns) {
      result = fn(result)
      if (!result) return null
    }
    return result
  }

  private async loadEvaluator(ctx: RunQueryCtx): Promise<LocalFeatureFlagEvaluator | null> {
    const row = (await ctx.runQuery(this.component.lib.getFlagDefinitions, {})) as {
      localEvalConfigured: boolean
      data: string | null
      fetchedAt: number | null
      etag?: string
    }
    if (!row.localEvalConfigured) {
      // Loud failure rather than silent `undefined`: a caller invoking a local-eval method
      // without `POSTHOG_PERSONAL_API_KEY` configured almost certainly meant to use a remote
      // `evaluate*` method instead. Throwing tells them exactly what to do.
      throw new Error(
        'PostHog: local feature flag evaluation is not configured. ' +
          'Set POSTHOG_PERSONAL_API_KEY on your Convex deployment, or call the remote ' +
          '`evaluateFlag` / `evaluateFlagPayload` / `evaluateAllFlags` methods instead ' +
          '(action context only).'
      )
    }
    // PAK is set but the cron hasn't populated the cache yet — return null so callers fall
    // back to their `undefined` graceful-degrade path until definitions land.
    if (!row.data) return null
    let parsed: FlagDefinitions
    try {
      parsed = JSON.parse(row.data) as FlagDefinitions
    } catch (e) {
      console.warn('[PostHog] Failed to parse cached flag definitions; treating as unavailable.', e)
      return null
    }
    return new LocalFeatureFlagEvaluator(parsed)
  }

  // --- Fire-and-forget methods (work in mutations and actions) ---

  async capture(
    ctx: SchedulerCtx,
    args: {
      distinctId?: string
      event: string
      properties?: Record<string, unknown>
      groups?: Record<string, string | number>
      sendFeatureFlags?: boolean
      timestamp?: Date
      uuid?: string
      disableGeoip?: boolean
    }
  ) {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId)
    const result = this.runBeforeSend({
      event: args.event,
      distinctId,
      properties: args.properties,
    })
    if (!result) return

    await ctx.scheduler.runAfter(0, this.component.lib.capture, {
      distinctId: result.distinctId,
      event: result.event,
      properties: result.properties ? JSON.stringify(result.properties) : undefined,
      groups: args.groups ? JSON.stringify(args.groups) : undefined,
      sendFeatureFlags: args.sendFeatureFlags,
      timestamp: args.timestamp?.getTime(),
      uuid: args.uuid,
      disableGeoip: args.disableGeoip,
    })
  }

  async identify(
    ctx: SchedulerCtx,
    args: {
      distinctId?: string
      properties?: Record<string, unknown> & {
        $set?: Record<string, unknown>
        $set_once?: Record<string, unknown>
        $anon_distinct_id?: string
      }
      disableGeoip?: boolean
    }
  ) {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId)
    const result = this.runBeforeSend({
      event: '$identify',
      distinctId,
      properties: args.properties,
    })
    if (!result) return

    await ctx.scheduler.runAfter(0, this.component.lib.identify, {
      distinctId: result.distinctId,
      properties: result.properties ? JSON.stringify(result.properties) : undefined,
      disableGeoip: args.disableGeoip,
    })
  }

  async groupIdentify(
    ctx: SchedulerCtx,
    args: {
      groupType: string
      groupKey: string
      properties?: Record<string, unknown>
      distinctId?: string
      disableGeoip?: boolean
    }
  ) {
    const result = this.runBeforeSend({
      event: '$groupidentify',
      distinctId: args.distinctId ?? '',
      properties: args.properties,
    })
    if (!result) return

    await ctx.scheduler.runAfter(0, this.component.lib.groupIdentify, {
      groupType: args.groupType,
      groupKey: args.groupKey,
      properties: result.properties ? JSON.stringify(result.properties) : undefined,
      // Use the post-beforeSend distinctId so any mutation (redaction, remapping) is honoured.
      // Fall back to undefined when the result is the empty placeholder so we don't ship "" to
      // the component (which would then send `distinct_id: ""` for a group identify).
      distinctId: result.distinctId || undefined,
      disableGeoip: args.disableGeoip,
    })
  }

  async alias(
    ctx: SchedulerCtx,
    args: {
      distinctId?: string
      alias: string
      disableGeoip?: boolean
    }
  ) {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId)
    const result = this.runBeforeSend({
      event: '$create_alias',
      distinctId,
    })
    if (!result) return

    await ctx.scheduler.runAfter(0, this.component.lib.alias, {
      distinctId: result.distinctId,
      alias: args.alias,
      disableGeoip: args.disableGeoip,
    })
  }

  async captureException(
    ctx: SchedulerCtx,
    args: {
      error: unknown
      distinctId?: string
      additionalProperties?: Record<string, unknown>
    }
  ) {
    const { message, stack, name } = normalizeError(args.error)

    let distinctId: string | undefined
    try {
      distinctId = await this.resolveDistinctId(ctx, args.distinctId)
    } catch {
      // captureException works without a distinctId
    }

    const result = this.runBeforeSend({
      event: '$exception',
      distinctId: distinctId ?? '',
      properties: args.additionalProperties,
    })
    if (!result) return

    await ctx.scheduler.runAfter(0, this.component.lib.captureException, {
      distinctId: result.distinctId || undefined,
      errorMessage: message,
      errorStack: stack,
      errorName: name,
      additionalProperties: result.properties ? JSON.stringify(result.properties) : undefined,
    })
  }

  // --- Feature flag methods (locally evaluated; work in queries, mutations, and actions) ---
  //
  // All feature flag methods evaluate flags locally against the definitions cached by the
  // component's cron. `undefined` signals that the eval couldn't reach a verdict — either
  // definitions haven't been fetched yet (POSTHOG_PERSONAL_API_KEY missing, or the cron hasn't
  // run for the first time), or the flag uses features incompatible with local evaluation
  // (experience continuity, static cohorts, properties not provided). For payload methods,
  // `null` is reserved for the case where the flag was evaluated but matched no payload — so
  // callers can distinguish "no payload" from "eval unavailable".

  async getFeatureFlag(
    ctx: RunQueryCtx,
    args: { key: string; distinctId?: string } & FeatureFlagOptions
  ): Promise<FeatureFlagValue | undefined> {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId)
    const evaluator = await this.loadEvaluator(ctx)
    if (!evaluator) return undefined
    return await evaluator.getFeatureFlag(
      args.key,
      distinctId,
      args.groups ?? {},
      args.personProperties ?? {},
      args.groupProperties ?? {}
    )
  }

  async isFeatureEnabled(
    ctx: RunQueryCtx,
    args: { key: string; distinctId?: string } & FeatureFlagOptions
  ): Promise<boolean | undefined> {
    const value = await this.getFeatureFlag(ctx, args)
    if (value === undefined) return undefined
    return value !== false && value !== null
  }

  async getFeatureFlagPayload(
    ctx: RunQueryCtx,
    args: {
      key: string
      distinctId?: string
      matchValue?: boolean | string
    } & FeatureFlagOptions
  ): Promise<JsonType | null | undefined> {
    const evaluator = await this.loadEvaluator(ctx)
    // `undefined` means we couldn't evaluate (no definitions cached, or the evaluator returned
    // inconclusive). `null` means we did evaluate and there's no payload — distinguishing the
    // two lets callers handle the "definitions not loaded yet" case explicitly.
    if (!evaluator) return undefined
    // When a caller supplies `matchValue` the payload lookup doesn't need a distinctId — it's a
    // pure key+value lookup. Defer resolution until we actually need it, so callers using the
    // "look up payload for a flag value I already evaluated" pattern don't have to configure an
    // identify callback or pass a distinctId they don't have.
    if (args.matchValue !== undefined) {
      return evaluator.getFeatureFlagPayload(args.key, '', args.matchValue)
    }
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId)
    return await evaluator.getFeatureFlagPayload(
      args.key,
      distinctId,
      undefined,
      args.groups ?? {},
      args.personProperties ?? {},
      args.groupProperties ?? {}
    )
  }

  async getFeatureFlagResult(
    ctx: RunQueryCtx,
    args: { key: string; distinctId?: string } & FeatureFlagOptions
  ): Promise<FeatureFlagResult | undefined> {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId)
    const evaluator = await this.loadEvaluator(ctx)
    if (!evaluator) return undefined
    const result = await evaluator.getFeatureFlagResult(
      args.key,
      distinctId,
      args.groups ?? {},
      args.personProperties ?? {},
      args.groupProperties ?? {}
    )
    if (!result) return undefined
    // `null` isn't in `FeatureFlagValue`'s declared type but the evaluator handles it defensively
    // in several places (payload lookup, flag-dependency cache). Treat it as a disabled value
    // here so a stray `null` can't slip through as `enabled: true, variant: null`.
    if (result.value === false || result.value === null) {
      return { key: args.key, enabled: false, variant: null, payload: result.payload ?? null }
    }
    return {
      key: args.key,
      enabled: true,
      variant: typeof result.value === 'string' ? result.value : null,
      payload: result.payload ?? null,
    }
  }

  async getAllFlags(
    ctx: RunQueryCtx,
    args: { distinctId?: string } & AllFlagsOptions
  ): Promise<Record<string, FeatureFlagValue>> {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId)
    const evaluator = await this.loadEvaluator(ctx)
    if (!evaluator) return {}
    const { featureFlags } = await evaluator.getAllFlagsAndPayloads(
      distinctId,
      args.groups ?? {},
      args.personProperties ?? {},
      args.groupProperties ?? {},
      args.flagKeys
    )
    return featureFlags
  }

  async getAllFlagsAndPayloads(
    ctx: RunQueryCtx,
    args: { distinctId?: string } & AllFlagsOptions
  ): Promise<{
    featureFlags: Record<string, FeatureFlagValue>
    featureFlagPayloads: Record<string, JsonType>
  }> {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId)
    const evaluator = await this.loadEvaluator(ctx)
    if (!evaluator) return { featureFlags: {}, featureFlagPayloads: {} }
    return await evaluator.getAllFlagsAndPayloads(
      distinctId,
      args.groups ?? {},
      args.personProperties ?? {},
      args.groupProperties ?? {},
      args.flagKeys
    )
  }

  // --- Remote feature flag evaluation (action context) ---
  //
  // For flags that can't be evaluated locally — experience continuity, static cohorts,
  // properties you can't pass in — or when you haven't configured a personal API key. These
  // hit PostHog's `/flags` endpoint via a component action, so they require an action ctx and
  // incur a per-call network round trip.

  private async evaluateRemoteFlag<T>(
    ctx: RunActionCtx,
    action: any,
    args: { key: string; distinctId?: string } & FeatureFlagOptions
  ): Promise<T> {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId)
    return (await ctx.runAction(action, {
      key: args.key,
      distinctId,
      groups: args.groups,
      personProperties: args.personProperties,
      groupProperties: args.groupProperties,
      disableGeoip: args.disableGeoip,
    })) as T
  }

  /**
   * Evaluate a single flag remotely against PostHog's `/flags` endpoint. Action context only.
   * Returns the flag value, or `null` if the flag doesn't exist.
   */
  async evaluateFlag(
    ctx: RunActionCtx,
    args: { key: string; distinctId?: string } & FeatureFlagOptions
  ): Promise<FeatureFlagValue | null> {
    return this.evaluateRemoteFlag<FeatureFlagValue | null>(ctx, this.component.lib.evaluateFlag, args)
  }

  /**
   * Evaluate a single flag's payload remotely against PostHog's `/flags` endpoint. Action context
   * only. Returns the payload, or `null` if the flag doesn't match or has no payload configured.
   */
  async evaluateFlagPayload(
    ctx: RunActionCtx,
    args: { key: string; distinctId?: string } & FeatureFlagOptions
  ): Promise<JsonType | null> {
    const action = this.component.lib.evaluateFlagPayload
    return this.evaluateRemoteFlag<JsonType | null>(ctx, action, args)
  }

  /**
   * Evaluate every flag for the user remotely in one `/flags` request. Action context only.
   * Returns both `featureFlags` (key → value) and `featureFlagPayloads` (key → payload). Use
   * `flagKeys` to scope the request to a specific subset.
   */
  async evaluateAllFlags(
    ctx: RunActionCtx,
    args: { distinctId?: string } & AllFlagsOptions
  ): Promise<{
    featureFlags: Record<string, FeatureFlagValue>
    featureFlagPayloads: Record<string, JsonType>
  }> {
    const distinctId = await this.resolveDistinctId(ctx, args.distinctId)
    return (await ctx.runAction(this.component.lib.evaluateAllFlags, {
      distinctId,
      groups: args.groups,
      personProperties: args.personProperties,
      groupProperties: args.groupProperties,
      disableGeoip: args.disableGeoip,
      flagKeys: args.flagKeys,
    })) as {
      featureFlags: Record<string, FeatureFlagValue>
      featureFlagPayloads: Record<string, JsonType>
    }
  }
}
