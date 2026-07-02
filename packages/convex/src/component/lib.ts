import { PostHog as PostHogEdge } from 'posthog-node/edge'
import { action, env, internalMutation, internalQuery, query, type MutationCtx } from './_generated/server.js'
import { api, internal } from './_generated/api.js'
import { v, type GenericId } from 'convex/values'
import { version } from './version.js'

/**
 * Brand events sent through this component as `posthog-convex` rather than `posthog-edge` in the
 * `$lib` / `$lib_version` properties — makes them filterable in PostHog and lets us attribute
 * issues to the integration vs. raw `posthog-node` usage.
 */
class PostHog extends PostHogEdge {
  getLibraryId(): string {
    return 'posthog-convex'
  }
  getLibraryVersion(): string {
    return version
  }
}

const DEFAULT_HOST = 'https://us.i.posthog.com'

/**
 * Resolve the credentials and host the component was configured with.
 *
 * Reads the typed `env` from `_generated/server` (declared in `convex.config.ts`). The
 * installing app wires the values via `app.use(posthog, { env: { ... } })`, typically
 * threading them straight through from its own deployment env vars. Trimming guards
 * against accidental whitespace from `npx convex env set`.
 */
function readConfig(): { projectToken: string; host: string; personalApiKey: string } {
  const projectToken = (env.POSTHOG_PROJECT_TOKEN ?? '').trim()
  const host = (env.POSTHOG_HOST ?? '').trim() || DEFAULT_HOST
  const personalApiKey = (env.POSTHOG_PERSONAL_API_KEY ?? '').trim()
  if (!projectToken) {
    // Convex's typed env-var validation should prevent an empty `POSTHOG_PROJECT_TOKEN` at deploy time,
    // but the gate is enforced at the app's `convex.config.ts`. Log loudly here so anyone hitting
    // an unexpected empty value (e.g. the token was cleared post-deploy on a stale isolate) has a trail
    // to follow rather than silently dropped events.
    console.warn(
      '[PostHog] POSTHOG_PROJECT_TOKEN is not configured; this event will be dropped. ' +
        'Set it with `npx convex env set POSTHOG_PROJECT_TOKEN phc_…` and redeploy.'
    )
  }
  return { projectToken, host, personalApiKey }
}

/**
 * Cache PostHog clients across action invocations within the same Convex isolate.
 *
 * Convex reuses JS isolates between invocations, so module-level state survives. Constructing
 * a fresh client per call (and tearing it down with `shutdown()`) is wasted work — the client
 * carries no per-invocation state once `flush()` has drained its queue.
 *
 * Keyed by `projectToken|host` so a deployment that rotates its env vars (via `npx convex env set`)
 * picks up the new client without restarting the isolate.
 */
const clientCache = new Map<string, PostHog>()

function getClient(projectToken: string, host: string): PostHog {
  const key = `${projectToken}|${host}`
  let client = clientCache.get(key)
  if (!client) {
    client = new PostHog(projectToken, { host, flushAt: 1, flushInterval: 0 })
    clientCache.set(key, client)
  }
  return client
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
    const { projectToken, host } = readConfig()
    if (!projectToken) return
    const client = getClient(projectToken, host)
    await client.captureImmediate({
      distinctId: args.distinctId,
      event: args.event,
      properties: parseProperties(args.properties),
      groups: parseProperties(args.groups) as Record<string, string | number> | undefined,
      sendFeatureFlags: args.sendFeatureFlags,
      timestamp: args.timestamp ? new Date(args.timestamp) : undefined,
      uuid: args.uuid,
      disableGeoip: args.disableGeoip,
    })
  },
})

export const identify = action({
  args: {
    distinctId: v.string(),
    properties: v.optional(v.string()),
    disableGeoip: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const { projectToken, host } = readConfig()
    if (!projectToken) return
    const client = getClient(projectToken, host)
    // posthog-node's `identifyImmediate` is missing an `await` on `identifyStatelessImmediate`
    // (packages/node/src/client.ts:674), so the returned promise resolves before the event hits
    // the wire. We sidestep that by composing the `$identify` event the same way `identifyImmediate`
    // does and routing it through `captureImmediate`, which awaits correctly.
    const properties = parseProperties(args.properties) ?? {}
    const { $set, $set_once, $anon_distinct_id, ...rest } = properties as {
      $set?: Record<string, unknown>
      $set_once?: Record<string, unknown>
      $anon_distinct_id?: string
    } & Record<string, unknown>
    await client.captureImmediate({
      distinctId: args.distinctId,
      event: '$identify',
      properties: {
        $set: $set ?? rest,
        $set_once: $set_once ?? {},
        $anon_distinct_id,
      },
      disableGeoip: args.disableGeoip,
    })
  },
})

export const groupIdentify = action({
  args: {
    groupType: v.string(),
    groupKey: v.string(),
    properties: v.optional(v.string()),
    distinctId: v.optional(v.string()),
    disableGeoip: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const { projectToken, host } = readConfig()
    if (!projectToken) return
    const client = getClient(projectToken, host)
    await client.groupIdentifyImmediate({
      groupType: args.groupType,
      groupKey: args.groupKey,
      properties: parseProperties(args.properties) ?? {},
      distinctId: args.distinctId,
      disableGeoip: args.disableGeoip,
    })
  },
})

export const alias = action({
  args: {
    distinctId: v.string(),
    alias: v.string(),
    disableGeoip: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const { projectToken, host } = readConfig()
    if (!projectToken) return
    const client = getClient(projectToken, host)
    await client.aliasImmediate({
      distinctId: args.distinctId,
      alias: args.alias,
      disableGeoip: args.disableGeoip,
    })
  },
})

export const captureException = action({
  args: {
    distinctId: v.optional(v.string()),
    errorMessage: v.string(),
    errorStack: v.optional(v.string()),
    errorName: v.optional(v.string()),
    additionalProperties: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const { projectToken, host } = readConfig()
    if (!projectToken) return
    const client = getClient(projectToken, host)
    const error = new Error(args.errorMessage)
    if (args.errorName) error.name = args.errorName
    if (args.errorStack) error.stack = args.errorStack
    await client.captureExceptionImmediate(error, args.distinctId, parseProperties(args.additionalProperties))
  },
})

// --- Feature flag remote evaluation ---
//
// These actions hit PostHog's `/flags` endpoint directly via `posthog-node`. Use them when
// local evaluation isn't available (no personal API key) or can't reach a verdict (experience
// continuity flags, static cohorts, properties you don't have in your server context). They
// require an action context — that's the trade for not needing flag definitions cached upfront.

const remoteFlagsArgs = {
  distinctId: v.string(),
  groups: v.optional(v.any()),
  personProperties: v.optional(v.any()),
  groupProperties: v.optional(v.any()),
  disableGeoip: v.optional(v.boolean()),
  flagKeys: v.optional(v.array(v.string())),
}

function remoteFlagsOptions(args: {
  groups?: unknown
  personProperties?: unknown
  groupProperties?: unknown
  disableGeoip?: boolean
  flagKeys?: string[]
}) {
  return {
    groups: args.groups as Record<string, string> | undefined,
    personProperties: args.personProperties as Record<string, any> | undefined,
    groupProperties: args.groupProperties as Record<string, Record<string, any>> | undefined,
    disableGeoip: args.disableGeoip,
    flagKeys: args.flagKeys,
    onlyEvaluateLocally: false,
  }
}

export const evaluateFlag = action({
  args: { ...remoteFlagsArgs, key: v.string() },
  handler: async (_ctx, args) => {
    const { projectToken, host } = readConfig()
    if (!projectToken) return null
    const client = getClient(projectToken, host)
    // Scope the request to just the flag the caller asked about — otherwise PostHog evaluates
    // every flag in the project on every call. Honour an explicit `flagKeys` override when given.
    const snapshot = await client.evaluateFlags(args.distinctId, {
      ...remoteFlagsOptions(args),
      flagKeys: args.flagKeys ?? [args.key],
    })
    const value = snapshot.getFlag(args.key)
    return value ?? null
  },
})

export const evaluateFlagPayload = action({
  args: { ...remoteFlagsArgs, key: v.string() },
  handler: async (_ctx, args) => {
    const { projectToken, host } = readConfig()
    if (!projectToken) return null
    const client = getClient(projectToken, host)
    const snapshot = await client.evaluateFlags(args.distinctId, {
      ...remoteFlagsOptions(args),
      flagKeys: args.flagKeys ?? [args.key],
    })
    const payload = snapshot.getFlagPayload(args.key)
    return payload ?? null
  },
})

export const evaluateAllFlags = action({
  args: remoteFlagsArgs,
  handler: async (_ctx, args) => {
    const { projectToken, host } = readConfig()
    if (!projectToken) return { featureFlags: {}, featureFlagPayloads: {} }
    const client = getClient(projectToken, host)
    const snapshot = await client.evaluateFlags(args.distinctId, remoteFlagsOptions(args))
    const featureFlags: Record<string, unknown> = {}
    const featureFlagPayloads: Record<string, unknown> = {}
    for (const key of snapshot.keys) {
      const value = snapshot.getFlag(key)
      if (value !== undefined) featureFlags[key] = value
      const payload = snapshot.getFlagPayload(key)
      if (payload !== undefined) featureFlagPayloads[key] = payload
    }
    return { featureFlags, featureFlagPayloads }
  },
})

// --- Feature flag local evaluation ---
//
// Flag definitions are fetched on the cron in `crons.ts` and stored in `flagDefinitions`.
// Clients read them via `getFlagDefinitions` and evaluate flags locally — there is no
// per-call action for flag evaluation.

// `localEvalConfigured` lets the client distinguish "PAK not set" (throw, point at the
// remote `evaluateFlag` methods) from "PAK set but cron hasn't fetched yet" (return
// `undefined`). `data` is a JSON-stringified `FlagDefinitions` (see
// `client/feature-flags/types.ts`), null until the first successful refresh.
export const getFlagDefinitions = query({
  args: {},
  handler: async (ctx) => {
    const localEvalConfigured = !!(env.POSTHOG_PERSONAL_API_KEY ?? '').trim()
    const row = await ctx.db.query('flagDefinitions').order('desc').first()
    if (!row) {
      return { localEvalConfigured, data: null, fetchedAt: null, etag: undefined }
    }
    return { localEvalConfigured, data: row.data, fetchedAt: row.fetchedAt, etag: row.etag }
  },
})

// All three queries against `flagDefinitions` use `.order('desc').first()` so they all see the
// same row even if a stray duplicate ever lands in the table. Without consistent ordering,
// `_setFlagDefinitions` could upsert against an older row than the one `getFlagDefinitions`
// returns, leaving the row callers actually read perpetually stale.

export const _setFlagDefinitions = internalMutation({
  args: { data: v.string(), etag: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('flagDefinitions').order('desc').first()
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
    const row = await ctx.db.query('flagDefinitions').order('desc').first()
    return row?.etag
  },
})

// --- Local-evaluation refresh loop ---
//
// A self-rescheduling chain rather than a fixed-interval cron, so the runtime-only
// `POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS` governs the cadence (see `crons.ts` for why a cron can't).

export const DEFAULT_INTERVAL_SECONDS = 60

export function envFlagIsTrue(raw: string | undefined): boolean {
  const value = (raw ?? '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function localEvaluationEnabled(): boolean {
  const personalApiKey = (env.POSTHOG_PERSONAL_API_KEY ?? '').trim()
  if (!personalApiKey) return false
  return !envFlagIsTrue(env.POSTHOG_DISABLE_LOCAL_EVALUATION)
}

// Read at runtime, where the forwarded value is visible. String-typed on the wire, so an invalid
// value warns and falls back rather than failing. Exported for tests.
export function readPollingIntervalSeconds(): number {
  const raw = (env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS ?? '').trim()
  if (!raw) return DEFAULT_INTERVAL_SECONDS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    console.warn(
      `[PostHog] POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS="${raw}" is not a positive integer; ` +
        `falling back to ${DEFAULT_INTERVAL_SECONDS}s.`
    )
    return DEFAULT_INTERVAL_SECONDS
  }
  return parsed
}

// Record the latest queued tick in the `refreshLoopState` singleton so `ensureRefreshLoop` can
// tell a live chain from a dead one before scheduling.
async function recordLoopJob(ctx: MutationCtx, jobId: GenericId<'_scheduled_functions'>): Promise<void> {
  const existing = await ctx.db.query('refreshLoopState').first()
  if (existing) {
    await ctx.db.patch(existing._id, { loopJobId: jobId })
  } else {
    await ctx.db.insert('refreshLoopState', { loopJobId: jobId })
  }
}

/**
 * One tick: kick off a refresh now, then queue the next tick at the configured interval. A mutation
 * so the chain is durable — scheduled mutations run exactly-once with retries, and queuing the next
 * tick commits atomically with this one, so the chain can't silently break. The fetch is a separate
 * at-most-once action; if it fails, the next tick refetches.
 *
 * Never invoke directly (e.g. dashboard "Run function"): it unconditionally queues a successor, so a
 * manual call forks the chain into two loops that run forever and double the cadence — the
 * supervisor can't detect the fork. Use `ensureRefreshLoop` to (re)start it.
 */
export const refreshLoop = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!localEvaluationEnabled()) return
    await ctx.scheduler.runAfter(0, api.lib.refreshFlagDefinitions, {})
    const nextId = await ctx.scheduler.runAfter(readPollingIntervalSeconds() * 1000, internal.lib.refreshLoop, {})
    await recordLoopJob(ctx, nextId)
  },
})

/**
 * Supervisor, called by the cron in `crons.ts`: starts the chain unless a tick is already pending
 * or running, recording the new tick's id so the next call sees it as alive. Idempotent —
 * overlapping runs can't spawn duplicate chains.
 */
export const ensureRefreshLoop = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!localEvaluationEnabled()) return
    const state = await ctx.db.query('refreshLoopState').first()
    if (state) {
      const job = await ctx.db.system.get(state.loopJobId)
      if (job && (job.state.kind === 'pending' || job.state.kind === 'inProgress')) {
        return
      }
    }
    const jobId = await ctx.scheduler.runAfter(0, internal.lib.refreshLoop, {})
    await recordLoopJob(ctx, jobId)
  },
})

/**
 * Fetches flag definitions from PostHog's local-evaluation endpoint and stores them in the
 * `flagDefinitions` table. Called automatically by the refresh loop (see above) when
 * `POSTHOG_PERSONAL_API_KEY` is set, and also exposed publicly so the client's
 * `reloadFeatureFlags(ctx)` method (parity with `posthog-node`) can trigger an on-demand refresh.
 */
export const refreshFlagDefinitions = action({
  args: {},
  handler: async (ctx) => {
    const { projectToken, host, personalApiKey } = readConfig()

    if (!projectToken || !personalApiKey) {
      // The cron registers unconditionally (see `crons.ts`); this is its runtime gate.
      return { status: 'skipped' as const, reason: 'missing-keys' as const }
    }

    const etag = await ctx.runQuery(internal.lib._getCurrentEtag, {})

    const url = `${host.replace(/\/$/, '')}/flags/definitions?token=${projectToken}&send_cohorts`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${personalApiKey}`,
    }
    if (etag) headers['If-None-Match'] = etag

    // PostHog's `/flags/definitions` endpoint sits behind a warm-on-demand cache. The first
    // call after a flag is created — or any time the cache evicts — comes back as a 503 with
    // "Required data not found in cache. … Please try again later." Retry transient 5xx (and
    // 429s, since rate limiting on a one-minute cron is similarly worth waiting out) with
    // bounded exponential backoff so a single cold-cache hit doesn't make callers wait a full
    // cron tick. Tests override the delays via env var to keep retry-heavy cases snappy.
    const testOverride = Number(process.env.POSTHOG_FLAGS_RETRY_DELAY_MS_OVERRIDE)
    const RETRY_DELAYS_MS =
      Number.isFinite(testOverride) && testOverride >= 0
        ? [testOverride, testOverride, testOverride]
        : [1500, 3000, 6000]
    let response: Response
    let attempt = 0
    while (true) {
      try {
        response = await fetch(url, { method: 'GET', headers })
      } catch (err) {
        console.warn('[PostHog] Failed to fetch flag definitions:', err)
        return { status: 'error' as const, reason: 'fetch-failed' as const }
      }
      const transient = response.status === 429 || (response.status >= 500 && response.status < 600)
      if (!transient || attempt >= RETRY_DELAYS_MS.length) break
      const wait = RETRY_DELAYS_MS[attempt]
      attempt++
      // Drain the body so the connection can be reused.
      try {
        await response.text()
      } catch {
        // ignore
      }
      console.warn(
        `[PostHog] Flag definitions fetch returned ${response.status}; retrying in ${wait}ms (attempt ${attempt}/${RETRY_DELAYS_MS.length}).`
      )
      await new Promise((r) => setTimeout(r, wait))
    }

    if (response.status === 304) {
      return { status: 'unchanged' as const }
    }
    if (response.status === 401 || response.status === 403) {
      console.warn(
        `[PostHog] Flag definitions fetch failed with ${response.status}. ` +
          `Check that the personal/feature-flags-secure API key has read access to feature flags.`
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
      console.warn('[PostHog] Rate limited while fetching flag definitions (after retries).')
      return { status: 'error' as const, reason: 'rate-limited' as const }
    }
    if (response.status !== 200) {
      let bodyText = '<no body>'
      try {
        bodyText = (await response.text()).slice(0, 500)
      } catch {
        // ignore — body wasn't readable
      }
      // PostHog returns 503 with `Required data not found in cache` for two indistinguishable
      // cases: (a) the project has zero flag definitions configured, and (b) the warm-on-demand
      // cache evicted and hasn't repopulated yet. We can't tell which, so we treat them the same
      // way: if we have no existing defs cached, persist an empty snapshot so eval methods can
      // resolve flag lookups to `undefined` cleanly and the UI stops looking broken. If we
      // already had defs cached, leave them alone — last-known-good beats a flap.
      const looksCacheCold =
        response.status === 503 && bodyText.toLowerCase().includes('required data not found in cache')
      if (looksCacheCold) {
        const existing = await ctx.runQuery(api.lib.getFlagDefinitions, {})
        const STALE_AFTER_MS = 5 * 60 * 1000
        if (existing.fetchedAt === null) {
          // No prior cache — write an empty snapshot so subsequent reads are deterministic and
          // the UI shows "no flags" instead of "loading".
          await ctx.runMutation(internal.lib._setFlagDefinitions, {
            data: JSON.stringify({ flags: [], groupTypeMapping: {}, cohorts: {} }),
            etag: undefined,
          })
          console.info(
            "[PostHog] No flag definitions returned (project may have no flags yet, or PostHog's cache is warming). Cached an empty snapshot."
          )
          return { status: 'empty' as const }
        }
        if (Date.now() - existing.fetchedAt > STALE_AFTER_MS) {
          // We had cached defs but haven't successfully refreshed them in a while — could be that
          // every flag was deleted upstream and PostHog now responds with "no flags in cache" 503s.
          // Replace with an empty snapshot rather than serving stale data indefinitely.
          await ctx.runMutation(internal.lib._setFlagDefinitions, {
            data: JSON.stringify({ flags: [], groupTypeMapping: {}, cohorts: {} }),
            etag: undefined,
          })
          console.info(
            '[PostHog] Cached flag definitions are >5 minutes stale and PostHog reports an empty cache. Replaced with an empty snapshot.'
          )
          return { status: 'empty' as const }
        }
        // Recent cached defs — keep them while PostHog's cache potentially warms back up.
        return { status: 'stale' as const }
      }

      console.warn(
        `[PostHog] Unexpected status ${response.status} fetching flag definitions from ${url.replace(projectToken, '<token>')}. ` +
          `Response body: ${bodyText}`
      )
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
