import {
  createTestClient,
  PostHogCoreTestClient,
  PostHogCoreTestClientMocks,
  parseBody,
  waitForPromises,
} from '@/testing'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2022-01-01'))
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 })
  })

  describe('groups', () => {
    it('should store groups as persisted props', () => {
      const groups = { posthog: 'team-1', other: 'key-2' }
      posthog.groups(groups)

      expect(mocks.storage.setItem).toHaveBeenCalledWith('props', {
        $groups: groups,
      })
    })
  })

  describe('group', () => {
    it('should store group as persisted props', () => {
      const groups = { posthog: 'team-1' }
      posthog.groups(groups)
      posthog.group('other', 'foo')
      posthog.group('posthog', 'team-2')

      expect(mocks.storage.setItem).toHaveBeenCalledWith('props', {
        $groups: {
          posthog: 'team-2',
          other: 'foo',
        },
      })
    })

    it('should call groupIdentify if including props', async () => {
      posthog.group('other', 'team', { foo: 'bar' })
      await waitForPromises()

      expect(mocks.fetch).toHaveBeenCalledTimes(2) // 1 for flags, 1 for groupIdentify
      const batchCall = mocks.fetch.mock.calls[1]
      expect(batchCall[0]).toEqual('https://us.i.posthog.com/batch/')
      expect(parseBody(batchCall)).toMatchObject({
        batch: [
          {
            event: '$groupidentify',
            distinct_id: posthog.getDistinctId(),
            properties: {
              $group_type: 'other',
              $group_key: 'team',
              $group_set: { foo: 'bar' },
            },
            type: 'capture',
          },
        ],
      })
    })
  })

  describe('groupIdentify', () => {
    it('should identify group', async () => {
      posthog.groupIdentify('posthog', 'team-1', { analytics: true })
      await waitForPromises()

      expect(parseBody(mocks.fetch.mock.calls[0])).toMatchObject({
        api_key: 'TEST_API_KEY',
        batch: [
          {
            event: '$groupidentify',
            distinct_id: posthog.getDistinctId(),
            library: 'posthog-core-tests',
            library_version: '2.0.0-alpha',
            properties: {
              $lib: 'posthog-core-tests',
              $lib_version: '2.0.0-alpha',
              $group_type: 'posthog',
              $group_key: 'team-1',
              $group_set: { analytics: true },
            },
            timestamp: '2022-01-01T00:00:00.000Z',
            type: 'capture',
          },
        ],
      })
    })
  })
})
