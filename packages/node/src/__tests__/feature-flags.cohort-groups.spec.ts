import { PostHog } from '@/entrypoints/index.node'
import { anyFlagsCall, apiImplementation } from './utils'

const mockedFetch = vi.spyOn(globalThis, 'fetch')
const matching = { key: 'plan', type: 'person', operator: 'exact', value: 'paid' }
const nonmatching = { ...matching, value: 'free' }

function localFlags(group: object, operator = 'in', negation = false) {
  return {
    flags: [
      {
        id: 1,
        key: 'cohort-flag',
        active: true,
        filters: {
          groups: [{ properties: [{ key: 'id', type: 'cohort', value: 'outer', operator }] }],
        },
      },
    ],
    cohorts: {
      outer: negation
        ? { type: 'AND', values: [{ key: 'id', type: 'cohort', value: 'inner', negation: true }] }
        : group,
      inner: group,
    },
  }
}

describe('local cohort group types', () => {
  let posthog: PostHog

  vi.useFakeTimers()

  afterEach(async () => {
    await posthog.shutdown()
  })

  it.each(
    [
      { name: 'empty XOR', group: { type: 'XOR', values: [] } },
      { name: 'XOR without values', group: { type: 'XOR' } },
      { name: 'matching XOR', group: { type: 'XOR', values: [matching] } },
      { name: 'nonmatching XOR', group: { type: 'XOR', values: [nonmatching] } },
      { name: 'nested XOR', group: { type: 'AND', values: [{ type: 'XOR', values: [nonmatching] }] } },
      { name: 'missing type', group: { values: [matching] } },
    ].flatMap(({ name, group }) =>
      [
        { operator: 'in', negation: false },
        { operator: 'not_in', negation: false },
        { operator: 'in', negation: true },
      ].map((reference) => ({ name, group, ...reference }))
    )
  )('defers $name with $operator and negation=$negation to the server', async ({ group, operator, negation }) => {
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: localFlags(group, operator, negation),
        decideFlags: { 'cohort-flag': 'server-result' },
      })
    )
    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetchRetryCount: 0,
    })
    const options = { personProperties: { plan: 'paid' } }

    expect(
      await posthog.getFeatureFlag('cohort-flag', 'user', { ...options, onlyEvaluateLocally: true })
    ).toBeUndefined()
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
    expect(await posthog.getFeatureFlag('cohort-flag', 'user', options)).toBe('server-result')
    expect(mockedFetch.mock.calls.filter(([url]) => url === anyFlagsCall[0])).toHaveLength(1)
  })

  it.each([
    { name: 'canonical empty group', group: {}, expected: true },
    { name: 'empty AND', group: { type: 'AND', values: [] }, expected: true },
    { name: 'empty OR', group: { type: 'OR', values: [] }, expected: false },
    { name: 'empty property alias', group: { type: 'property', values: [] }, expected: true },
    { name: 'matching AND', group: { type: 'AND', values: [matching] }, expected: true },
    { name: 'nonmatching AND', group: { type: 'AND', values: [matching, nonmatching] }, expected: false },
    { name: 'matching OR', group: { type: 'OR', values: [nonmatching, matching] }, expected: true },
    { name: 'nonmatching OR', group: { type: 'OR', values: [nonmatching] }, expected: false },
    { name: 'matching property alias', group: { type: 'property', values: [matching] }, expected: true },
    {
      name: 'nonmatching property alias',
      group: { type: 'property', values: [matching, nonmatching] },
      expected: false,
    },
    {
      name: 'nested property alias',
      group: {
        type: 'property',
        values: [
          { type: 'AND', values: [matching] },
          { type: 'OR', values: [nonmatching] },
        ],
      },
      expected: false,
    },
  ])('evaluates $name locally', async ({ group, expected }) => {
    mockedFetch.mockImplementation(apiImplementation({ localFlags: localFlags(group) }))
    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetchRetryCount: 0,
    })

    expect(
      await posthog.getFeatureFlag('cohort-flag', 'user', {
        personProperties: { plan: 'paid' },
        onlyEvaluateLocally: true,
      })
    ).toBe(expected)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })
})
