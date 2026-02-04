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

    it('should send $anon_distinct_id when identify is called during in-flight preload flags', async () => {
      // This test verifies the fix for the race condition where identify() calls
      // triggered during preloadFeatureFlags would drop the $anon_distinct_id.
      // See: https://github.com/PostHog/posthog-ios/issues/456

      let resolvePreloadRequest: () => void
      let preloadFlagsBody: any = null
      let identifyFlagsBody: any = null
      let flagsCallCount = 0

      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 }, (_mocks) => {
        _mocks.fetch.mockImplementation((url) => {
          if (url.includes('/flags/')) {
            flagsCallCount++
            const currentCall = flagsCallCount

            if (currentCall === 1) {
              // First flags call (preload) - delay to simulate network latency
              return new Promise((resolve) => {
                resolvePreloadRequest = () =>
                  resolve({
                    status: 200,
                    text: () => Promise.resolve('ok'),
                    json: () =>
                      Promise.resolve({
                        featureFlags: {},
                        featureFlagPayloads: {},
                      }),
                  })
              })
            } else if (currentCall === 2) {
              // Second flags call (from identify's pending reload)
              // This should include $anon_distinct_id
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () =>
                  Promise.resolve({
                    featureFlags: {},
                    featureFlagPayloads: {},
                  }),
              })
            }
          }

          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () => Promise.resolve({ status: 'ok' }),
          })
        })
      })

      // Start preload (simulates app init with preloadFeatureFlags: true)
      posthog.reloadFeatureFlags()
      await waitForPromises()

      // Get the anonymous ID before identify changes it
      const anonId = posthog.getDistinctId()

      // Now identify while preload is in flight
      posthog.identify('user-123', { name: 'Test User' })
      await waitForPromises()

      // At this point, first call is in flight, identify queued a pending reload
      expect(flagsCallCount).toBe(1)

      // Capture the first request body for comparison
      preloadFlagsBody = mocks.fetch.mock.calls.find((call: any) => call[0].includes('/flags/'))?.[1]?.body
      if (preloadFlagsBody) {
        preloadFlagsBody = JSON.parse(preloadFlagsBody)
      }

      // Complete the preload request
      resolvePreloadRequest!()
      await waitForPromises()

      // The pending reload from identify should now execute
      expect(flagsCallCount).toBe(2)

      // Find the second flags call and verify it contains $anon_distinct_id
      const flagsCalls = mocks.fetch.mock.calls.filter((call: any) => call[0].includes('/flags/'))
      expect(flagsCalls.length).toBe(2)

      identifyFlagsBody = JSON.parse(flagsCalls[1][1].body)

      // The second request (from identify) should include $anon_distinct_id
      // This is the key assertion - without the fix, this request would have been dropped
      expect(identifyFlagsBody.$anon_distinct_id).toBe(anonId)
      expect(identifyFlagsBody.distinct_id).toBe('user-123')
    })
  })
})
