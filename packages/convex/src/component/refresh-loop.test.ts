/// <reference types="vite/client" />
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { convexTest } from 'convex-test'
import schema from './schema.js'
import { api, internal } from './_generated/api.js'

const modules = import.meta.glob('./**/*.ts')

type ScheduledJob = {
  _id: string
  name: string
  scheduledTime: number
  state: { kind: 'pending' | 'inProgress' | 'success' | 'failed' | 'canceled' }
}

const originalFetch = global.fetch
let flagsFetches = 0

function mockFetch() {
  flagsFetches = 0
  return jest.fn(async (url: string | URL) => {
    if (url.toString().includes('/flags/definitions')) flagsFetches++
    return new Response(JSON.stringify({ flags: [], group_type_mapping: {}, cohorts: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

function scheduledJobs(t: ReturnType<typeof convexTest>): Promise<ScheduledJob[]> {
  return t.run(async (ctx) => (await ctx.db.system.query('_scheduled_functions').collect()) as ScheduledJob[])
}

const byName = (jobs: ScheduledJob[], needle: string) => jobs.filter((j) => j.name.includes(needle))
const pending = (jobs: ScheduledJob[]) => jobs.filter((j) => j.state.kind === 'pending')

// The chain self-reschedules forever, so the usual `finishAllScheduledFunctions` driver would
// never terminate, and stepping fake timers by hand trips convex-test's transaction tracking.
// Instead we invoke a single tick directly and inspect what it queued — `scheduler.runAfter`
// records the job synchronously in `_scheduled_functions`, so the queued cadence is observable
// without ever firing a timer.

describe('self-rescheduling flag refresh loop', () => {
  beforeEach(() => {
    process.env.POSTHOG_PROJECT_TOKEN = 'phc_test'
    process.env.POSTHOG_HOST = 'https://test.posthog.com'
    process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test'
    global.fetch = mockFetch()
  })

  afterEach(() => {
    global.fetch = originalFetch
    delete process.env.POSTHOG_PROJECT_TOKEN
    delete process.env.POSTHOG_HOST
    delete process.env.POSTHOG_PERSONAL_API_KEY
    delete process.env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS
  })

  test('queues the next tick at the configured interval, not the 60s default', async () => {
    process.env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS = '3600'
    const t = convexTest(schema, modules)

    await t.mutation(internal.lib.refreshLoop, {})

    const jobs = await scheduledJobs(t)
    // The tick kicks a refresh now…
    expect(byName(jobs, 'refreshFlagDefinitions')).toHaveLength(1)
    // …and queues exactly one successor an interval out. With the old fixed cron the period was
    // pinned to the 60s default because the env var is invisible at registration (#3957).
    const next = byName(jobs, 'refreshLoop')
    expect(next).toHaveLength(1)
    const delayMs = next[0].scheduledTime - Date.now()
    expect(delayMs).toBeGreaterThan(3600 * 1000 - 1000)
    expect(delayMs).toBeLessThanOrEqual(3600 * 1000)
  })

  test('queues the next tick at the 60s default when the interval is unset', async () => {
    const t = convexTest(schema, modules)

    await t.mutation(internal.lib.refreshLoop, {})

    const next = byName(await scheduledJobs(t), 'refreshLoop')
    expect(next).toHaveLength(1)
    const delayMs = next[0].scheduledTime - Date.now()
    expect(delayMs).toBeGreaterThan(60 * 1000 - 1000)
    expect(delayMs).toBeLessThanOrEqual(60 * 1000)
  })

  test('records the queued tick id so the supervisor can detect a live chain', async () => {
    process.env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS = '3600'
    const t = convexTest(schema, modules)

    await t.mutation(internal.lib.refreshLoop, {})

    const next = byName(await scheduledJobs(t), 'refreshLoop')
    const state = await t.run(async (ctx) => ctx.db.query('cronState').first())
    expect(state?.loopJobId).toBe(next[0]._id)
  })

  test('supervisor starts the chain when none is running', async () => {
    const t = convexTest(schema, modules)

    await t.mutation(internal.lib.ensureRefreshLoop, {})

    expect(pending(byName(await scheduledJobs(t), 'refreshLoop'))).toHaveLength(1)
  })

  test('supervisor is idempotent: a second run does not spawn a rival chain', async () => {
    const t = convexTest(schema, modules)

    await t.mutation(internal.lib.ensureRefreshLoop, {})
    await t.mutation(internal.lib.ensureRefreshLoop, {})

    expect(pending(byName(await scheduledJobs(t), 'refreshLoop'))).toHaveLength(1)
  })

  test('the refresh the loop kicks actually fetches definitions and caches them', async () => {
    const t = convexTest(schema, modules)

    // refreshLoop schedules this action; running it directly proves the kicked work fetches.
    await t.action(api.lib.refreshFlagDefinitions, {})

    expect(flagsFetches).toBe(1)
    const row = await t.run(async (ctx) => ctx.db.query('flagDefinitions').first())
    expect(row).not.toBeNull()
  })
})
