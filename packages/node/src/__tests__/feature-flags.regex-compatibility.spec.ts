import { PostHog } from '@/entrypoints/index.node'
import { anyFlagsCall, apiImplementation } from './utils'

const mockedFetch = vi.spyOn(globalThis, 'fetch')

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
