/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import schema from './schema.js'
import { api, internal } from './_generated/api.js'
import { PostHog } from '../client/index.js'
import type { FlagProperty, PostHogFeatureFlag, PropertyGroup } from '../client/feature-flags/types.js'

const modules = import.meta.glob('./**/*.ts')
const rows: [FlagProperty['value'], unknown, boolean, boolean][] = [
  [false, 'banana', true, false],
  [false, 0, true, false],
  [['true', 'false'], 'true', false, true],
  [['true', 'false'], 'pro', true, false],
  [[], true, true, true],
  [[], [], true, true],
  [true, [true], true, false],
  [false, 'FALSE', true, true],
  [false, null, true, false],
  [[], [true, ['TRUE', []]], true, true],
  [[], false, false, false],
  [[], 0, false, false],
  [[], 'banana', false, false],
]
const makeFlag = (key: string, properties: FlagProperty[], group = false): PostHogFeatureFlag => ({
  id: 1,
  name: key,
  key,
  active: true,
  deleted: false,
  rollout_percentage: null,
  ensure_experience_continuity: false,
  experiment_set: [],
  filters: { groups: [{ properties }], ...(group ? { aggregation_group_type_index: 0 } : {}) },
})
const property: FlagProperty = { key: 'value', value: false, operator: 'exact' }
const flags = [
  makeFlag('person', [property]),
  makeFlag('group', [property], true),
  makeFlag('cohort', [{ key: 'id', type: 'cohort', value: '1' }]),
  makeFlag('dependent', [{ key: 'person', type: 'flag', value: true, dependency_chain: ['person'] }]),
  ...rows.flatMap(([value], index) =>
    ['exact', 'is_not'].map((operator) =>
      makeFlag(`${index}-${operator}`, [{ key: `value-${index}`, value, operator }])
    )
  ),
]
const cohorts: Record<string, PropertyGroup> = {
  '1': { type: 'AND', values: [{ type: 'OR', values: [{ key: 'id', type: 'cohort', value: '2' }] }] },
  '2': { type: 'AND', values: [property] },
}
const personProperties = {
  value: 'banana',
  ...Object.fromEntries(rows.map(([, actual], index) => [`value-${index}`, actual])),
}
const args = {
  distinctId: 'user',
  personProperties,
  groups: { company: 'acme' },
  groupProperties: { company: { value: 'banana' } },
}
const envelope = (version?: number) => ({
  flags,
  cohorts,
  group_type_mapping: { '0': 'company' },
  property_matching_version: version,
})

beforeEach(() => {
  vi.stubEnv('POSTHOG_PROJECT_TOKEN', 'project')
  vi.stubEnv('POSTHOG_PERSONAL_API_KEY', 'personal')
  vi.stubEnv('POSTHOG_HOST', 'https://example.com')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('versioned definitions through Convex HTTP, storage and client hydration', () => {
  test('version-only reloads and omitted metadata select the correct semantics on every local API', async () => {
    const t = convexTest(schema, modules)
    const client = new PostHog({ lib: { getFlagDefinitions: api.lib.getFlagDefinitions } } as never)
    const ctx = { runQuery: t.query }
    for (const version of [undefined, 1, 2, 1, 2, undefined, 3]) {
      const fetch = vi.fn(
        async (_url: string) =>
          new Response(JSON.stringify(envelope(version)), { status: 200, headers: { ETag: 'same-flags' } })
      )
      vi.stubGlobal('fetch', fetch)
      expect(await t.action(api.lib.refreshFlagDefinitions, {})).toEqual({ status: 'updated' })
      const row = await t.query(api.lib.getFlagDefinitions, {})
      expect(JSON.parse(row.data!).propertyMatchingVersion).toBe(version)
      for (const key of ['person', 'group', 'cohort', 'dependent']) {
        expect(await client.getFeatureFlag(ctx, { ...args, key })).toBe(version !== 2)
        expect((await client.getFeatureFlagResult(ctx, { ...args, key }))?.enabled).toBe(version !== 2)
      }
      for (let index = 0; index < rows.length; index++) {
        const expected = rows[index][version === 2 ? 3 : 2]
        expect(await client.getFeatureFlag(ctx, { ...args, key: `${index}-exact` })).toBe(expected)
        expect(await client.getFeatureFlag(ctx, { ...args, key: `${index}-is_not` })).toBe(!expected)
      }
      const all = await client.getAllFlags(ctx, args)
      expect(all.person).toBe(version !== 2)
      expect(all.dependent).toBe(version !== 2)
      expect(fetch).toHaveBeenCalledTimes(1) // Definitions only, never remote /flags fallback.
      expect(fetch.mock.calls[0][0]).toContain('/flags/definitions')
    }
  })

  test('304 and failed refreshes retain the persisted version and definitions', async () => {
    const t = convexTest(schema, modules)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(envelope(2)), { headers: { ETag: 'v2' } }))
    )
    await t.action(api.lib.refreshFlagDefinitions, {})
    const original = (await t.query(api.lib.getFlagDefinitions, {})).data
    for (const status of [304, 400]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status }))
      )
      await t.action(api.lib.refreshFlagDefinitions, {})
      expect((await t.query(api.lib.getFlagDefinitions, {})).data).toBe(original)
    }
  })

  test('old persisted JSON without version hydrates as legacy', async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.lib._setFlagDefinitions, {
      data: JSON.stringify({ flags, cohorts, groupTypeMapping: { '0': 'company' } }),
    })
    const client = new PostHog({ lib: { getFlagDefinitions: api.lib.getFlagDefinitions } } as never)
    expect(await client.getFeatureFlag({ runQuery: t.query }, { ...args, key: 'cohort' })).toBe(true)
  })
})
