import { PostHog } from 'posthog-node/edge'
import { action, internalAction, internalMutation, internalQuery, query } from './_generated/server.js'
import { internal } from './_generated/api.js'
import { v } from 'convex/values'

function createClient(apiKey: string, host: string) {
  return new PostHog(apiKey, { host, flushAt: 1, flushInterval: 0 })
}

/** Properties are JSON-serialized to bypass Convex's restriction on `$`-prefixed field names. */
function parseProperties(json: string | undefined): Record<string, unknown> | undefined {
  if (!json) return undefined
  try {
    return JSON.parse(json)
  } catch (e) {
    console.warn('[PostHog] Failed to parse serialized properties, dropping them.', e)
    return undefined
  }
}

export const capture = action({
  args: {
    apiKey: v.string(),
    host: v.string(),
    distinctId: v.string(),
    event: v.string(),
    properties: v.optional(v.string()),
    groups: v.optional(v.string()),
    sendFeatureFlags: v.optional(v.boolean()),
    timestamp: v.optional(v.number()),
    uuid: v.optional(v.string()),
    disableGeoip: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const client = createClient(args.apiKey, args.host)
    client.capture({
      distinctId: args.distinctId,
      event: args.event,
      properties: parseProperties(args.properties),
      groups: parseProperties(args.groups) as Record<string, string | number> | undefined,
      sendFeatureFlags: args.sendFeatureFlags,
      timestamp: args.timestamp ? new Date(args.timestamp) : undefined,
      uuid: args.uuid,
      disableGeoip: args.disableGeoip,
    })
    await client.shutdown()
  },
})

export const identify = action({
  args: {
    apiKey: v.string(),
    host: v.string(),
    distinctId: v.string(),
    properties: v.optional(v.string()),
    disableGeoip: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const client = createClient(args.apiKey, args.host)
    client.identify({
      distinctId: args.distinctId,
      properties: parseProperties(args.properties),
      disableGeoip: args.disableGeoip,
    })
    await client.shutdown()
  },
})

export const groupIdentify = action({
  args: {
    apiKey: v.string(),
    host: v.string(),
    groupType: v.string(),
    groupKey: v.string(),
    properties: v.optional(v.string()),
    distinctId: v.optional(v.string()),
    disableGeoip: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const client = createClient(args.apiKey, args.host)
    client.groupIdentify({
      groupType: args.groupType,
      groupKey: args.groupKey,
      properties: parseProperties(args.properties),
      distinctId: args.distinctId,
      disableGeoip: args.disableGeoip,
    })
    await client.shutdown()
  },
})

export const alias = action({
  args: {
    apiKey: v.string(),
    host: v.string(),
    distinctId: v.string(),
    alias: v.string(),
    disableGeoip: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const client = createClient(args.apiKey, args.host)
    client.alias({
      distinctId: args.distinctId,
      alias: args.alias,
      disableGeoip: args.disableGeoip,
    })
    await client.shutdown()
  },
})

export const captureException = action({
  args: {
    apiKey: v.string(),
    host: v.string(),
    distinctId: v.optional(v.string()),
    errorMessage: v.string(),
    errorStack: v.optional(v.string()),
    errorName: v.optional(v.string()),
    additionalProperties: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const client = createClient(args.apiKey, args.host)
    const error = new Error(args.errorMessage)
    if (args.errorName) error.name = args.errorName
    if (args.errorStack) error.stack = args.errorStack
    client.captureException(error, args.distinctId, parseProperties(args.additionalProperties))
    await client.shutdown()
  },
})

// --- Feature flag local evaluation ---
//
// Feature flag definitions are fetched periodically by `refreshFlagDefinitions` (scheduled via
// crons.ts) and stored in the `flagDefinitions` table. Clients read them via `getFlagDefinitions`
// and evaluate flags locally — there is no per-call action for flag evaluation.

const DEFAULT_HOST = 'https://us.i.posthog.com'

function trimEnvValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Returns the latest cached flag definitions, or `null` if none have been fetched yet.
 *
 * The `data` field is a JSON-stringified `FlagDefinitions` object (see `client/feature-flags/types.ts`).
 */
export const getFlagDefinitions = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query('flagDefinitions').order('desc').first()
    if (!row) return null
    return { data: row.data, fetchedAt: row.fetchedAt, etag: row.etag }
  },
})

export const _setFlagDefinitions = internalMutation({
  args: { data: v.string(), etag: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('flagDefinitions').first()
    const next = { data: args.data, fetchedAt: Date.now(), etag: args.etag }
    if (existing) {
      await ctx.db.replace(existing._id, next)
    } else {
      await ctx.db.insert('flagDefinitions', next)
    }
  },
})

export const _getCurrentEtag = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query('flagDefinitions').first()
    return row?.etag
  },
})

/**
 * Fetches flag definitions from PostHog's local-evaluation endpoint and stores them in the
 * `flagDefinitions` table. Driven by the cron scheduler in `crons.ts`.
 *
 * Reads configuration from Convex deployment environment variables:
 *   - `POSTHOG_API_KEY` (project key) — required
 *   - `POSTHOG_PERSONAL_API_KEY` — required; local eval is disabled if missing
 *   - `POSTHOG_HOST` — optional, defaults to `https://us.i.posthog.com`
 */
export const refreshFlagDefinitions = internalAction({
  args: {},
  handler: async (ctx) => {
    const projectApiKey = trimEnvValue(process.env.POSTHOG_API_KEY)
    const personalApiKey = trimEnvValue(process.env.POSTHOG_PERSONAL_API_KEY)
    const host = trimEnvValue(process.env.POSTHOG_HOST) || DEFAULT_HOST

    if (!projectApiKey || !personalApiKey) {
      // Local evaluation requires both keys. Silently skip rather than churning errors —
      // the user may simply not have opted in to local evaluation.
      return { status: 'skipped' as const, reason: 'missing-keys' as const }
    }

    const etag = await ctx.runQuery(internal.lib._getCurrentEtag, {})

    const url = `${host.replace(/\/$/, '')}/flags/definitions?token=${projectApiKey}&send_cohorts`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${personalApiKey}`,
    }
    if (etag) headers['If-None-Match'] = etag

    let response: Response
    try {
      response = await fetch(url, { method: 'GET', headers })
    } catch (err) {
      console.warn('[PostHog] Failed to fetch flag definitions:', err)
      return { status: 'error' as const, reason: 'fetch-failed' as const }
    }

    if (response.status === 304) {
      return { status: 'unchanged' as const }
    }
    if (response.status === 401 || response.status === 403) {
      console.warn(
        `[PostHog] Flag definitions fetch failed with ${response.status}. ` +
          `Check that POSTHOG_PERSONAL_API_KEY is a valid personal API key with read access to feature flags.`
      )
      return { status: 'error' as const, reason: 'auth' as const }
    }
    if (response.status === 402) {
      console.warn('[PostHog] Feature flags quota limit exceeded — disabling local evaluation.')
      await ctx.runMutation(internal.lib._setFlagDefinitions, {
        data: JSON.stringify({ flags: [], groupTypeMapping: {}, cohorts: {} }),
        etag: undefined,
      })
      return { status: 'error' as const, reason: 'quota' as const }
    }
    if (response.status === 429) {
      console.warn('[PostHog] Rate limited while fetching flag definitions.')
      return { status: 'error' as const, reason: 'rate-limited' as const }
    }
    if (response.status !== 200) {
      console.warn(`[PostHog] Unexpected status ${response.status} fetching flag definitions.`)
      return { status: 'error' as const, reason: 'unexpected-status' as const }
    }

    let body: { flags?: unknown; group_type_mapping?: unknown; cohorts?: unknown }
    try {
      body = (await response.json()) as typeof body
    } catch (err) {
      console.warn('[PostHog] Failed to parse flag definitions response:', err)
      return { status: 'error' as const, reason: 'parse-failed' as const }
    }
    if (!('flags' in body)) {
      console.warn('[PostHog] Flag definitions response missing `flags` field.')
      return { status: 'error' as const, reason: 'invalid-shape' as const }
    }

    const data = JSON.stringify({
      flags: body.flags ?? [],
      groupTypeMapping: body.group_type_mapping ?? {},
      cohorts: body.cohorts ?? {},
    })

    await ctx.runMutation(internal.lib._setFlagDefinitions, {
      data,
      etag: response.headers.get('ETag') ?? undefined,
    })

    return { status: 'updated' as const }
  },
})
