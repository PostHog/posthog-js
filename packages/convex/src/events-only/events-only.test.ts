/// <reference types="vite/client" />
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { api } from './_generated/api.js'
import type { ComponentApi as EventsOnlyComponentApi } from './_generated/component.js'
import type { ComponentApi as DefaultComponentApi } from '../component/_generated/component.js'
import { PostHog } from '../client/index.js'
import posthogEventsOnly from './convex.config.js'
import schema from './schema.js'

const modules = import.meta.glob('./**/*.ts')

// Compile-time contract: `new PostHog(components.posthog)` must accept the event-only component,
// so switching installs only changes the import in the app's `convex/convex.config.ts`.
function _assertClientAcceptsEventsOnlyComponent(component: EventsOnlyComponentApi<'posthog'>): void {
  const asDefault: DefaultComponentApi<'posthog'> = component
  new PostHog(asDefault)
  new PostHog(component)
}

const originalFetch = global.fetch
let fetchedUrls: string[] = []

function mockFetch() {
  fetchedUrls = []
  return vi.fn(async (url: string | URL) => {
    fetchedUrls.push(url.toString())
    const body = url.toString().includes('/flags') ? { flags: {}, errorsWhileComputingFlags: false } : { status: 1 }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
}

describe('event-only component', () => {
  beforeEach(() => {
    process.env.POSTHOG_PROJECT_TOKEN = 'phc_test'
    process.env.POSTHOG_HOST = 'https://test.posthog.com'
    // Set to show the event-only component ignores it rather than starting a refresh.
    process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test'
    global.fetch = mockFetch()
  })

  afterEach(() => {
    global.fetch = originalFetch
    delete process.env.POSTHOG_PROJECT_TOKEN
    delete process.env.POSTHOG_HOST
    delete process.env.POSTHOG_PERSONAL_API_KEY
  })

  // Convex registers a component's crons from a `crons.ts` module in its directory, at deploy-time
  // analysis. Keeping that module out of this directory is what removes the 5-minute supervisor.
  test('ships no crons module, so it registers no cron', () => {
    expect(Object.keys(modules).filter((path) => /(^|\/)crons\.[jt]s$/.test(path))).toEqual([])
  })

  test('defines no tables', () => {
    expect(Object.keys(schema.tables)).toEqual([])
  })

  test('declares only the project token and host env vars, under the default component name', () => {
    const exported = (
      posthogEventsOnly as unknown as {
        export: () => { name: string; envVars: Array<[string, { optional: boolean }]> }
      }
    ).export()
    expect(exported.name).toBe('posthog')
    expect(exported.envVars.map(([name]) => name).sort()).toEqual(['POSTHOG_HOST', 'POSTHOG_PROJECT_TOKEN'])
    expect(exported.envVars.every(([, value]) => value.optional)).toBe(true)
    expect(typeof _assertClientAcceptsEventsOnlyComponent).toBe('function')
  })

  test('captures events and evaluates remote flags without scheduling any work', async () => {
    const t = convexTest(schema, modules)

    await t.action(api.lib.capture, { distinctId: 'u1', event: 'signed_up' })
    await t.action(api.lib.identify, { distinctId: 'u1' })
    await t.action(api.lib.groupIdentify, { groupType: 'company', groupKey: 'acme' })
    await t.action(api.lib.alias, { distinctId: 'u1', alias: 'u1-alias' })
    await t.action(api.lib.captureException, { distinctId: 'u1', errorMessage: 'boom' })
    await t.action(api.lib.evaluateFlag, { distinctId: 'u1', key: 'my-flag' })
    await t.action(api.lib.evaluateFlagPayload, { distinctId: 'u1', key: 'my-flag' })
    await t.action(api.lib.evaluateAllFlags, { distinctId: 'u1' })

    expect(fetchedUrls.some((url) => url.includes('/i/v1/analytics/events'))).toBe(true)
    expect(fetchedUrls.some((url) => url.includes('/flags'))).toBe(true)
    expect(fetchedUrls.some((url) => url.includes('/flags/definitions'))).toBe(false)

    const scheduled = await t.run(async (ctx) => await ctx.db.system.query('_scheduled_functions').collect())
    expect(scheduled).toEqual([])
  })

  test('reports local evaluation as unavailable and skips refreshes', async () => {
    const t = convexTest(schema, modules)

    expect(await t.query(api.lib.getFlagDefinitions, {})).toEqual({
      disabled: false,
      localEvalConfigured: false,
      eventsOnly: true,
      data: null,
      fetchedAt: null,
    })
    expect(await t.action(api.lib.refreshFlagDefinitions, {})).toEqual({ status: 'skipped', reason: 'events-only' })
    expect(fetchedUrls).toEqual([])
  })

  test('reports disabled when POSTHOG_PROJECT_TOKEN is unset', async () => {
    delete process.env.POSTHOG_PROJECT_TOKEN
    const t = convexTest(schema, modules)

    expect(await t.query(api.lib.getFlagDefinitions, {})).toMatchObject({ disabled: true })
  })
})
