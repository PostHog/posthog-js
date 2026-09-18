import type { FlagDefinitionCacheData, FlagDefinitionCacheInput, FlagDefinitionCacheProvider } from '../exports'
import { PostHog } from '../entrypoints/index.node'
import type { PostHogFeatureFlag } from '../types'
import { apiImplementation, waitForPromises } from './utils'

const groupMapping = { '0': 'company' }
const flag: PostHogFeatureFlag = {
  id: 55,
  name: 'Group flag',
  key: 'group-flag',
  active: true,
  deleted: false,
  rollout_percentage: null,
  ensure_experience_continuity: false,
  experiment_set: [],
  has_experiment: false,
  filters: {
    aggregation_group_type_index: 0,
    groups: [
      { rollout_percentage: 100, properties: [{ key: 'plan', value: 'pro', operator: 'exact', type: 'group' }] },
    ],
  },
}
const definitions = { flags: [flag], cohorts: {} }

const readCases: { name: string; data: FlagDefinitionCacheInput; minimal: boolean }[] = [
  {
    name: 'snake_case',
    data: { ...definitions, group_type_mapping: groupMapping, minimal_flag_called_events: true },
    minimal: true,
  },
  {
    name: 'legacy camelCase',
    data: { ...definitions, groupTypeMapping: groupMapping, minimalFlagCalledEvents: true },
    minimal: true,
  },
  {
    name: 'snake_case mapping with a legacy event gate',
    data: { ...definitions, group_type_mapping: groupMapping, minimalFlagCalledEvents: true },
    minimal: true,
  },
  {
    name: 'snake_case false overrides legacy true',
    data: {
      ...definitions,
      group_type_mapping: groupMapping,
      groupTypeMapping: { '0': 'incorrect-group' },
      minimal_flag_called_events: false,
      minimalFlagCalledEvents: true,
    },
    minimal: false,
  },
  {
    name: 'snake_case true overrides legacy false',
    data: {
      ...definitions,
      group_type_mapping: groupMapping,
      groupTypeMapping: { '0': 'incorrect-group' },
      minimal_flag_called_events: true,
      minimalFlagCalledEvents: false,
    },
    minimal: true,
  },
  {
    name: 'missing event gate',
    data: { ...definitions, group_type_mapping: groupMapping },
    minimal: false,
  },
]

describe('Flag definition cache formats', () => {
  let client: PostHog
  const fetchMock = vi.spyOn(globalThis, 'fetch')

  beforeEach(() => {
    fetchMock.mockReset().mockImplementation(apiImplementation({ localFlags: { flags: [] } }))
  })

  afterEach(async () => {
    await client?.shutdown()
  })

  describe.each(['sync', 'async'] as const)('%s cache reads', (mode) => {
    it.each(readCases)('evaluates groups and applies the event gate for $name', async ({ data, minimal }) => {
      const provider: FlagDefinitionCacheProvider<FlagDefinitionCacheInput> = {
        getFlagDefinitions: () => (mode === 'async' ? Promise.resolve(data) : data),
        shouldFetchFlagDefinitions: () => false,
        onFlagDefinitionsReceived: vi.fn(),
        shutdown: vi.fn(),
      }
      client = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: provider,
        fetchRetryCount: 0,
        flushAt: 100,
        flushInterval: 0,
      })
      client.register({ super_prop: 'retained-on-full-events' })
      const captured: any[] = []
      client.on('capture', (message) => captured.push(message))

      expect(
        await client.getFeatureFlag('group-flag', 'person', {
          groups: { company: 'acme' },
          groupProperties: { company: { plan: 'pro' } },
          onlyEvaluateLocally: true,
        })
      ).toBe(true)
      await waitForPromises()

      const event = captured.find((message) => message.event === '$feature_flag_called')
      expect(event).toBeDefined()
      expect(event.properties.locally_evaluated).toBe(true)
      expect(event.properties.super_prop).toBe(minimal ? undefined : 'retained-on-full-events')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(provider.onFlagDefinitionsReceived).not.toHaveBeenCalled()
    })
  })

  it('prefers an empty snake_case group mapping over a populated legacy mapping', async () => {
    client = new PostHog('TEST_API_KEY', {
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      flagDefinitionCacheProvider: {
        getFlagDefinitions: () => ({ ...definitions, group_type_mapping: {}, groupTypeMapping: groupMapping }),
        shouldFetchFlagDefinitions: () => false,
        onFlagDefinitionsReceived: vi.fn(),
        shutdown: vi.fn(),
      },
    })

    expect(
      await client.getFeatureFlag('group-flag', 'person', {
        groups: { company: 'acme' },
        groupProperties: { company: { plan: 'pro' } },
        onlyEvaluateLocally: true,
        sendFeatureFlagEvents: false,
      })
    ).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([true, false, undefined])(
    'publishes JSON readable by snake_case and legacy readers (gate=%s)',
    async (gate) => {
      fetchMock.mockImplementation(
        apiImplementation({
          localFlags: {
            ...definitions,
            group_type_mapping: groupMapping,
            ...(gate === undefined ? {} : { minimal_flag_called_events: gate }),
          },
        })
      )
      let serialized = ''
      const provider: FlagDefinitionCacheProvider = {
        getFlagDefinitions: () => undefined,
        shouldFetchFlagDefinitions: () => true,
        onFlagDefinitionsReceived: (data: FlagDefinitionCacheData) => {
          // Existing provider implementations can still access the required camelCase mapping.
          expect(Object.keys(data.groupTypeMapping)).toEqual(['0'])
          expect(data.group_type_mapping).toBe(data.groupTypeMapping)
          serialized = JSON.stringify(data)
        },
        shutdown: vi.fn(),
      }
      client = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: provider,
      })
      await client.reloadFeatureFlags()

      expect(JSON.parse(serialized)).toEqual({
        ...definitions,
        group_type_mapping: groupMapping,
        minimal_flag_called_events: gate === true,
        groupTypeMapping: groupMapping,
        minimalFlagCalledEvents: gate === true,
      })
    }
  )
})
