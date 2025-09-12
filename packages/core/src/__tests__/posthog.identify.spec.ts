import {
  parseBody,
  waitForPromises,
  createTestClient,
  PostHogCoreTestClient,
  PostHogCoreTestClientMocks,
} from '@/testing'
import { PostHogPersistedProperty } from '@/types'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  jest.useFakeTimers()
  jest.setSystemTime(new Date('2022-01-01'))

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 })
  })

  describe('identify', () => {
    // Identify also triggers a subsequent flags call so we should expect 2 calls
    it('should send an $identify event', async () => {
      posthog.identify('id-1', { foo: 'bar' })
      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      const batchCall = mocks.fetch.mock.calls[1]
      expect(batchCall[0]).toEqual('https://us.i.posthog.com/batch/')
      expect(parseBody(batchCall)).toMatchObject({
        api_key: 'TEST_API_KEY',
        batch: [
          {
            event: '$identify',
            distinct_id: posthog.getDistinctId(),
            library: 'posthog-core-tests',
            library_version: '2.0.0-alpha',
            properties: {
              $lib: 'posthog-core-tests',
              $lib_version: '2.0.0-alpha',
              $anon_distinct_id: expect.any(String),
              $session_id: expect.any(String),
              $set: {
                foo: 'bar',
              },
            },
            timestamp: expect.any(String),
            uuid: expect.any(String),
            type: 'identify',
          },
        ],
        sent_at: expect.any(String),
      })
    })

    it('should send an $identify with $set and $set_once event', async () => {
      posthog.identify('id-1', {
        $set: {
          foo: 'bar',
        },
        $set_once: {
          vip: true,
        },
      })
      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      const batchCall = mocks.fetch.mock.calls[1]
      expect(batchCall[0]).toEqual('https://us.i.posthog.com/batch/')
      expect(parseBody(batchCall)).toMatchObject({
        api_key: 'TEST_API_KEY',
        batch: [
          {
            event: '$identify',
            distinct_id: posthog.getDistinctId(),
            library: 'posthog-core-tests',
            library_version: '2.0.0-alpha',
            properties: {
              $lib: 'posthog-core-tests',
              $lib_version: '2.0.0-alpha',
              $anon_distinct_id: expect.any(String),
              $session_id: expect.any(String),
              $set: {
                foo: 'bar',
              },
              $set_once: {
                vip: true,
              },
            },
            timestamp: expect.any(String),
            uuid: expect.any(String),
            type: 'identify',
          },
        ],
        sent_at: expect.any(String),
      })
    })

    it('should send an $identify with $set_once event', async () => {
      posthog.identify('id-1', {
        foo: 'bar',
        $set_once: {
          vip: true,
        },
      })
      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      const batchCall = mocks.fetch.mock.calls[1]
      expect(batchCall[0]).toEqual('https://us.i.posthog.com/batch/')
      expect(parseBody(batchCall)).toMatchObject({
        api_key: 'TEST_API_KEY',
        batch: [
          {
            event: '$identify',
            distinct_id: posthog.getDistinctId(),
            library: 'posthog-core-tests',
            library_version: '2.0.0-alpha',
            properties: {
              $lib: 'posthog-core-tests',
              $lib_version: '2.0.0-alpha',
              $anon_distinct_id: expect.any(String),
              $session_id: expect.any(String),
              $set: {
                foo: 'bar',
              },
              $set_once: {
                vip: true,
              },
            },
            timestamp: expect.any(String),
            uuid: expect.any(String),
            type: 'identify',
          },
        ],
        sent_at: expect.any(String),
      })
    })

    it('should include anonymous ID if set', async () => {
      posthog.identify('id-1', { foo: 'bar' })
      await waitForPromises()

      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      const batchCall = mocks.fetch.mock.calls[1]
      expect(batchCall[0]).toEqual('https://us.i.posthog.com/batch/')
      expect(parseBody(batchCall)).toMatchObject({
        batch: [
          {
            distinct_id: posthog.getDistinctId(),
            properties: {
              $anon_distinct_id: expect.any(String),
            },
          },
        ],
      })
    })

    it('should update distinctId if different', () => {
      const distinctId = posthog.getDistinctId()
      posthog.identify('id-1', { foo: 'bar' })

      expect(mocks.storage.setItem).toHaveBeenCalledWith('anonymous_id', distinctId)
      expect(mocks.storage.setItem).toHaveBeenCalledWith('distinct_id', 'id-1')
    })

    it('should use existing distinctId from storage', async () => {
      mocks.storage.setItem(PostHogPersistedProperty.AnonymousId, 'my-old-value')
      mocks.storage.setItem.mockClear()
      posthog.identify('id-1', { foo: 'bar' })
      await waitForPromises()

      // One call exists for the queueing, one for persisting distinct id
      expect(mocks.storage.setItem).toHaveBeenCalledWith('distinct_id', 'id-1')
      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      const batchCall = mocks.fetch.mock.calls[1]
      expect(batchCall[0]).toEqual('https://us.i.posthog.com/batch/')
      expect(parseBody(batchCall)).toMatchObject({
        batch: [
          {
            distinct_id: 'id-1',
            properties: {
              $anon_distinct_id: 'my-old-value',
            },
          },
        ],
      })
    })

    it('should not update stored properties if distinct_id the same', () => {
      mocks.storage.setItem(PostHogPersistedProperty.DistinctId, 'id-1')
      mocks.storage.setItem.mockClear()
      posthog.identify('id-1', { foo: 'bar' })
      expect(mocks.storage.setItem).not.toHaveBeenCalledWith('distinct_id', 'id-1')
    })
  })
})
