import { afterEach, describe, expect, test, vi } from 'vitest'
import { PostHog } from '../entrypoints/index.node'
import { FeatureFlagsPoller, FeatureFlagEvaluationContext } from '../extensions/feature-flags/feature-flags'
import type { FlagDefinitionCacheData } from '../extensions/feature-flags/cache'
import type { FlagProperty, PostHogFeatureFlag, PropertyGroup } from '../types'

const property: FlagProperty = { key: 'value', value: false, operator: 'exact', type: 'person' }
const flag = (key: string, properties: FlagProperty[], group = false): PostHogFeatureFlag => ({
  id: 1,
  key,
  name: key,
  active: true,
  deleted: false,
  rollout_percentage: null,
  ensure_experience_continuity: false,
  experiment_set: [],
  filters: { groups: [{ properties }], ...(group ? { aggregation_group_type_index: 0 } : {}) },
})
const flags = [
  flag('person', [property]),
  flag('group', [property], true),
  flag('cohort', [{ key: 'id', value: '1', type: 'cohort' }]),
  flag('dependent', [
    { key: 'person', type: 'flag', value: true, operator: 'flag_evaluates_to', dependency_chain: ['person'] },
  ]),
]
const cohorts: Record<string, PropertyGroup> = {
  '1': { type: 'AND', values: [{ type: 'OR', values: [{ key: 'id', value: '2', type: 'cohort' }] }] },
  '2': { type: 'AND', values: [property] },
}
const context = (): FeatureFlagEvaluationContext => ({
  distinctId: 'user',
  groups: { company: 'acme' },
  personProperties: { value: 'banana' },
  groupProperties: { company: { value: 'banana' } },
  evaluationCache: {},
})
const envelope = (version?: number) => ({
  flags,
  cohorts,
  group_type_mapping: { '0': 'company' },
  property_matching_version: version,
})
const response = (version?: number, status = 200) => ({
  status,
  json: async () => envelope(version),
  text: async () => '',
  headers: { get: () => 'etag' },
})
const pollers: FeatureFlagsPoller[] = []
function poller(
  fetch = vi.fn(async () => response()),
  cacheProvider?: ConstructorParameters<typeof FeatureFlagsPoller>[0]['cacheProvider']
) {
  const instance = new FeatureFlagsPoller({
    pollingInterval: 60000,
    personalApiKey: 'personal',
    projectApiKey: 'project',
    host: 'https://example.com',
    fetch,
    cacheProvider,
  })
  pollers.push(instance)
  return instance
}
afterEach(async () => {
  await Promise.all(pollers.splice(0).map((instance) => instance.stopPoller()))
})

describe('versioned definitions in the Node poller', () => {
  test('public simple and full-result APIs observe version-only reloads without remote fallback', async () => {
    let version: number | undefined = 1
    const fetch = vi.fn(async (_url: string) => response(version))
    const client = new PostHog('project', { personalApiKey: 'personal', host: 'https://example.com', fetch })
    const ctx = context()
    const options = {
      groups: ctx.groups,
      personProperties: ctx.personProperties,
      groupProperties: ctx.groupProperties,
      onlyEvaluateLocally: true,
      sendFeatureFlagEvents: false,
    }
    try {
      for (version of [1, 2, 1, 2, undefined]) {
        await client.reloadFeatureFlags()
        for (const { key } of flags) {
          expect(await client.getFeatureFlag(key, 'user', options)).toBe(version !== 2)
          expect((await client.getFeatureFlagResult(key, 'user', options))?.enabled).toBe(version !== 2)
        }
      }
      expect(fetch.mock.calls.every(([url]) => url.includes('/flags/definitions'))).toBe(true)
    } finally {
      await client.shutdown()
    }
  })

  test.each([undefined, 1, 2, 3])(
    'HTTP version %s reaches person, group, recursive cohorts and dependencies',
    async (version) => {
      const instance = poller(vi.fn(async () => response(version)))
      const ctx = context()
      for (const { key } of flags) {
        expect(
          await instance.getFeatureFlag(key, ctx.distinctId, ctx.groups, ctx.personProperties, ctx.groupProperties)
        ).toBe(version !== 2)
      }
      const all = await instance.getAllFlagsAndPayloads(ctx)
      expect(all.fallbackToFlags).toBe(false)
      expect(all.response).toEqual(Object.fromEntries(flags.map(({ key }) => [key, version !== 2])))
    }
  )

  test.each([undefined, 1, 2, 3])('six rows and negation through Node definitions version %s', async (version) => {
    const rows: [FlagProperty['value'], unknown, boolean, boolean][] = [
      [false, 'banana', true, false],
      [false, 0, true, false],
      [['true', 'false'], 'true', false, true],
      [['true', 'false'], 'pro', true, false],
      [[], true, true, true],
      [[], [], true, true],
    ]
    const rowFlags = rows.flatMap(([value], index) =>
      ['exact', 'is_not'].map((operator) => flag(`${index}-${operator}`, [{ key: 'value', value, operator }]))
    )
    const instance = poller(
      vi.fn(async () => ({ ...response(version), json: async () => ({ ...envelope(version), flags: rowFlags }) }))
    )
    for (let index = 0; index < rows.length; index++) {
      const [, actual, legacy, explicit] = rows[index]
      const expected = version === 2 ? explicit : legacy
      expect(await instance.getFeatureFlag(`${index}-exact`, 'user', {}, { value: actual })).toBe(expected)
      expect(await instance.getFeatureFlag(`${index}-is_not`, 'user', {}, { value: actual })).toBe(!expected)
    }
  })

  test('version-only reloads replace dependency results, and omission resets to legacy', async () => {
    let version: number | undefined = 1
    const instance = poller(vi.fn(async () => response(version)))
    const ctx = context()
    for (version of [1, 2, 1, 2, undefined]) {
      await instance.loadFeatureFlags(true)
      const all = await instance.getAllFlagsAndPayloads(ctx)
      expect(all.response.dependent).toBe(version !== 2)
      expect(all.response.person).toBe(version !== 2)
      expect(all.fallbackToFlags).toBe(false)
      ctx.evaluationCache = all.response
    }
  })

  test('cache provider round trip retains version; old cached data resets to legacy', async () => {
    let stored: FlagDefinitionCacheData | undefined
    let shouldFetch = true
    const cache = {
      shouldFetchFlagDefinitions: () => shouldFetch,
      getFlagDefinitions: () => stored,
      onFlagDefinitionsReceived: vi.fn((data: FlagDefinitionCacheData) => {
        stored = JSON.parse(JSON.stringify(data))
      }),
      shutdown: vi.fn(),
    }
    const fetch = vi.fn(async () => response(2))
    const writer = poller(fetch, cache)
    await writer.loadFeatureFlags()
    expect(stored).toHaveProperty('propertyMatchingVersion', 2)
    shouldFetch = false
    const reader = poller(fetch, cache)
    expect(await reader.getFeatureFlag('person', 'user', {}, { value: 'banana' })).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
    for (const version of [1, 2, undefined]) {
      stored = { ...stored!, propertyMatchingVersion: version }
      if (version === undefined) delete stored.propertyMatchingVersion
      await reader.loadFeatureFlags(true)
      expect(await reader.getFeatureFlag('person', 'user', {}, { value: 'banana' })).toBe(version !== 2)
    }
  })

  test.each(['empty', 'failed'])('%s cache reads preserve the loaded snapshot/version', async (kind) => {
    let shouldFetch = true
    const fetch = vi.fn(async () => response(2))
    const instance = poller(fetch, {
      shouldFetchFlagDefinitions: () => shouldFetch,
      getFlagDefinitions: () => {
        if (kind === 'failed') throw new Error('cache unavailable')
        return undefined
      },
      onFlagDefinitionsReceived: vi.fn(),
      shutdown: vi.fn(),
    })
    await instance.loadFeatureFlags()
    shouldFetch = false
    await instance.loadFeatureFlags(true)
    expect(await instance.getFeatureFlag('person', 'user', {}, { value: 'banana' })).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('304, HTTP failure and cache-store failure preserve the loaded snapshot/version', async () => {
    const fetch = vi.fn(async () => response(2))
    const instance = poller(fetch, {
      shouldFetchFlagDefinitions: () => true,
      getFlagDefinitions: () => undefined,
      onFlagDefinitionsReceived: () => {
        throw new Error('cache unavailable')
      },
      shutdown: vi.fn(),
    })
    await instance.loadFeatureFlags()
    for (const status of [304, 500]) {
      fetch.mockImplementation(async () => response(undefined, status))
      await instance.loadFeatureFlags(true)
      expect(await instance.getFeatureFlag('person', 'user', {}, { value: 'banana' })).toBe(false)
    }
  })

  test('an in-flight evaluation keeps its definitions/version across a reload', async () => {
    const fetch = vi.fn(async () => response(1))
    const instance = poller(fetch)
    await instance.loadFeatureFlags()
    const original = instance.isConditionMatch.bind(instance)
    let resume!: () => void
    const paused = new Promise<void>((resolve) => {
      resume = resolve
    })
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    vi.spyOn(instance, 'isConditionMatch').mockImplementationOnce(async (...args) => {
      entered()
      await paused
      return original(...args)
    })
    const pending = instance.getFeatureFlag('cohort', 'user', {}, { value: 'banana' })
    await started
    fetch.mockImplementation(async () => response(2))
    await instance.loadFeatureFlags(true)
    resume()
    expect(await pending).toBe(true)
    expect(await instance.getFeatureFlag('cohort', 'user', {}, { value: 'banana' })).toBe(false)
  })
})
