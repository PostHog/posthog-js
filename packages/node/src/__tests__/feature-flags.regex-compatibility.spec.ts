import type { PostHogFeatureFlag, FlagProperty, PropertyGroup } from '@/types'
import { PostHog } from '@/entrypoints/index.node'
import { anyFlagsCall, apiImplementation } from './utils'

const mockedFetch = vi.spyOn(globalThis, 'fetch')

function variantFlag(filters: PostHogFeatureFlag['filters']): PostHogFeatureFlag {
  return {
    id: 1,
    name: 'regex-variant',
    key: 'regex-variant',
    active: true,
    deleted: false,
    rollout_percentage: null,
    ensure_experience_continuity: false,
    experiment_set: [],
    filters,
  }
}

describe('local regex compatibility', () => {
  let posthog: PostHog

  vi.useFakeTimers()

  afterEach(async () => {
    await posthog.shutdown()
  })

  it.each(['regex', 'not_regex'])(
    'defers incompatible %s matching to the server unless local-only',
    async (operator) => {
      mockedFetch.mockImplementation(
        apiImplementation({
          localFlags: {
            flags: [
              {
                id: 1,
                key: 'regex-flag',
                active: true,
                filters: {
                  groups: [
                    {
                      properties: [{ key: 'plan', type: 'person', operator, value: '^\\p{L}+$' }],
                      rollout_percentage: 100,
                    },
                  ],
                },
              },
            ],
          },
          decideFlags: { 'regex-flag': operator === 'regex' },
        })
      )
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        fetchRetryCount: 0,
      })

      const personProperties = { plan: 'é' }
      expect(
        await posthog.getFeatureFlag('regex-flag', 'user', { personProperties, onlyEvaluateLocally: true })
      ).toBeUndefined()
      expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)

      expect(await posthog.getFeatureFlag('regex-flag', 'user', { personProperties })).toBe(operator === 'regex')
      const flagsCalls = mockedFetch.mock.calls.filter(([url]) => url === 'http://example.com/flags/?v=2')
      expect(flagsCalls).toHaveLength(1)
      expect(JSON.parse(flagsCalls[0][1]?.body as string).person_properties).toEqual({ plan: 'é' })
    }
  )

  it.each(['regex', 'not_regex'])('preserves an earlier deferred %s variant before a catch-all', async (operator) => {
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: {
          flags: [
            {
              id: 1,
              key: 'regex-variant',
              active: true,
              filters: {
                groups: [
                  {
                    properties: [
                      { key: 'name', type: 'person', operator, value: operator === 'regex' ? '.*' : '^never$' },
                    ],
                    variant: 'a',
                  },
                  { properties: [], variant: 'b' },
                ],
                multivariate: {
                  variants: [
                    { key: 'a', rollout_percentage: 50 },
                    { key: 'b', rollout_percentage: 50 },
                  ],
                },
              },
            },
          ],
        },
        decideFlags: { 'regex-variant': 'a' },
      })
    )
    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetchRetryCount: 0,
    })
    const personProperties = { name: 'café' }
    expect
      .soft(await posthog.getFeatureFlag('regex-variant', 'user', { personProperties, onlyEvaluateLocally: true }))
      .toBeUndefined()
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
    expect.soft(await posthog.getFeatureFlag('regex-variant', 'user', { personProperties })).toBe('a')
    expect(mockedFetch.mock.calls.filter(([url]) => url === 'http://example.com/flags/?v=2')).toHaveLength(1)
  })

  const regexProperty = { key: 'name', type: 'person', operator: 'regex', value: '.*' }
  const variants = [
    { key: 'a', rollout_percentage: 100 },
    { key: 'b', rollout_percentage: 0 },
  ]

  it.each([
    {
      name: 'definitive regex miss',
      first: { ...regexProperty, value: '^never$' },
      properties: { name: 'ascii' },
      multivariate: true,
      later: 'b',
      expected: 'b',
    },
    {
      name: 'generic missing property',
      first: { ...regexProperty, key: 'missing', operator: 'exact' },
      properties: { name: 'café' },
      multivariate: true,
      later: 'b',
      expected: 'b',
    },
    {
      name: 'missing regex context',
      first: { ...regexProperty, key: 'missing' },
      properties: { name: 'café' },
      multivariate: true,
      later: 'b',
      expected: 'b',
    },
    {
      name: 'independent Boolean match',
      first: regexProperty,
      properties: { name: 'café' },
      multivariate: false,
      later: undefined,
      expected: true,
    },
    {
      name: 'same variant match',
      first: regexProperty,
      properties: { name: 'café' },
      multivariate: true,
      later: 'a',
      expected: 'a',
    },
    {
      name: 'definitive first match',
      first: regexProperty,
      properties: { name: 'ascii' },
      multivariate: true,
      later: 'b',
      expected: 'a',
    },
    {
      name: 'shared-invalid regex',
      first: { ...regexProperty, value: '[' },
      properties: { name: 'ascii' },
      multivariate: true,
      later: 'b',
      expected: 'b',
    },
  ])('keeps $name local', async ({ first, properties, multivariate, later, expected }) => {
    const filters = {
      groups: [
        { properties: [first], variant: multivariate ? 'a' : undefined },
        { properties: [], variant: later },
      ],
      multivariate: multivariate ? { variants } : undefined,
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: { flags: [variantFlag(filters)] } }))
    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetchRetryCount: 0,
    })
    expect(
      await posthog.getFeatureFlag('regex-variant', 'user', { personProperties: properties, onlyEvaluateLocally: true })
    ).toBe(expected)
    expect(await posthog.getFeatureFlag('regex-variant', 'user', { personProperties: properties })).toBe(expected)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it.each(['cohort', 'nested cohort', 'dependency'])(
    'preserves deferred regex variant identity through %s',
    async (source) => {
      const cohorts: Record<string, PropertyGroup> = {
        inner: { type: 'AND', values: [regexProperty, { key: 'missing', value: 'x' }] },
        outer: { type: 'AND', values: [{ type: 'OR', values: [{ key: 'cohort', type: 'cohort', value: 'inner' }] }] },
      }
      const first: FlagProperty =
        source === 'dependency'
          ? { key: 'dependency', type: 'flag', value: true, dependency_chain: ['dependency'] }
          : { key: 'cohort', type: 'cohort', value: source === 'cohort' ? 'inner' : 'outer' }
      const filters = {
        groups: [
          { properties: [first], variant: 'a' },
          { properties: [], variant: 'b' },
        ],
        multivariate: { variants },
      }
      const dependency = { ...variantFlag({ groups: [{ properties: [regexProperty] }] }), key: 'dependency' }
      mockedFetch.mockImplementation(
        apiImplementation({
          localFlags: { flags: [variantFlag(filters), dependency], cohorts },
          decideFlags: { 'regex-variant': 'a' },
        })
      )
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        fetchRetryCount: 0,
      })
      const personProperties = { name: 'café' }
      expect(
        await posthog.getFeatureFlag('regex-variant', 'user', { personProperties, onlyEvaluateLocally: true })
      ).toBeUndefined()
      const flags = await posthog.evaluateFlags('user', { personProperties, onlyEvaluateLocally: true })
      expect(flags.unresolvedFlags['regex-variant']).toBe(
        source === 'dependency' ? 'unresolved_dependency' : 'unsupported_definition'
      )
      expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
      expect(await posthog.getFeatureFlag('regex-variant', 'user', { personProperties })).toBe('a')
      expect(mockedFetch.mock.calls.filter(([url]) => url === 'http://example.com/flags/?v=2')).toHaveLength(1)
    }
  )

  it.each([
    { type: 'AND' as const, value: 'no', expected: 'b' },
    { type: 'OR' as const, value: 'yes', expected: 'a' },
  ])('keeps an independently decisive $type cohort local', async ({ type, value, expected }) => {
    const cohorts: Record<string, PropertyGroup> = {
      decisive: { type, values: [regexProperty, { key: 'control', value, operator: 'exact' }] },
    }
    const filters = {
      groups: [
        { properties: [{ key: 'cohort', type: 'cohort', value: 'decisive' }], variant: 'a' },
        { properties: [], variant: 'b' },
      ],
      multivariate: { variants },
    }
    const properties = { name: 'café', control: 'yes' }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: { flags: [variantFlag(filters)], cohorts } }))
    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetchRetryCount: 0,
    })
    expect(
      await posthog.getFeatureFlag('regex-variant', 'user', { personProperties: properties, onlyEvaluateLocally: true })
    ).toBe(expected)
    expect(await posthog.getFeatureFlag('regex-variant', 'user', { personProperties: properties })).toBe(expected)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('keeps portable ASCII regex matching local', async () => {
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: {
          flags: [
            {
              id: 1,
              key: 'regex-flag',
              active: true,
              filters: {
                groups: [
                  {
                    properties: [{ key: 'plan', type: 'person', operator: 'regex', value: '^[a-z]+$' }],
                    rollout_percentage: 100,
                  },
                ],
              },
            },
          ],
        },
      })
    )
    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetchRetryCount: 0,
    })

    expect(await posthog.getFeatureFlag('regex-flag', 'user', { personProperties: { plan: 'pro' } })).toBe(true)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })
})
