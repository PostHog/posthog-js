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

type FeatureFlagOptions = {
  groups?: Record<string, string>
  personProperties?: Record<string, any>
  groupProperties?: Record<string, Record<string, any>>
  disableGeoip?: boolean
}

type AllFlagsOptions = FeatureFlagOptions & { flagKeys?: string[] }

const DEFAULT_HOST = 'https://us.i.posthog.com'

function normalizeApiKey(value?: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeHost(value?: unknown): string {
  const normalizedValue = typeof value === 'string' ? value.trim() : ''
  return normalizedValue || DEFAULT_HOST
}

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

export class PostHog {
  private apiKey: string
  private host: string
  private beforeSend?: BeforeSendFn | BeforeSendFn[]
  private identifyFn?: IdentifyFn

  constructor(
    public component: ComponentApi,
    options?: {
      apiKey?: string
      host?: string
      beforeSend?: BeforeSendFn | BeforeSendFn[]
      identify?: IdentifyFn
    }
  ) {
    this.apiKey = normalizeApiKey(options?.apiKey ?? process.env.POSTHOG_API_KEY)
    this.host = normalizeHost(options?.host ?? process.env.POSTHOG_HOST)
    this.beforeSend = options?.beforeSend
    this.identifyFn = options?.identify
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
      data: string
      fetchedAt: number
      etag?: string
    } | null
    if (!row) return null
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
      apiKey: this.apiKey,
      host: this.host,
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
      apiKey: this.apiKey,
      host: this.host,
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
      apiKey: this.apiKey,
      host: this.host,
      groupType: args.groupType,
      groupKey: args.groupKey,
      properties: result.properties ? JSON.stringify(result.properties) : undefined,
      distinctId: args.distinctId,
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
      apiKey: this.apiKey,
      host: this.host,
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
      apiKey: this.apiKey,
      host: this.host,
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
  // component's cron. They return `undefined`/`null` when:
  //   - flag definitions haven't been fetched yet (POSTHOG_PERSONAL_API_KEY missing, or cron
  //     hasn't run for the first time);
  //   - the flag uses features incompatible with local evaluation (experience continuity,
  //     static cohorts, properties not provided).

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
  ): Promise<JsonType | null> {
    const evaluator = await this.loadEvaluator(ctx)
    if (!evaluator) return null
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
    if (!result || result.value === false) {
      if (!result) return undefined
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
}
