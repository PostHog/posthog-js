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

    describe('when the persisted id already matches the identify id while still anonymous', () => {
      // e.g. a non-identified bootstrap seeded the id as the anonymous id
      beforeEach(() => {
        ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
          flushAt: 1,
          bootstrap: { distinctId: 'user-123' },
        })
      })

      const batchEvents = (): any[] =>
        mocks.fetch.mock.calls.filter((c) => (c[0] as string).includes('/batch/')).flatMap((c) => parseBody(c).batch)
      const flagsCalls = (): any[] => mocks.fetch.mock.calls.filter((c) => (c[0] as string).includes('/flags/'))

      it('marks the user identified and captures one person-processed $set, not $identify', async () => {
        posthog.identify('user-123')
        await waitForPromises()

        const events = batchEvents()
        expect(events).toHaveLength(1)
        expect(events[0].event).toEqual('$set')
        expect(events[0].properties.$process_person_profile).toEqual(true)
        expect(events[0].properties.$is_identified).toEqual(true)
        expect(events.some((e) => e.event === '$identify')).toBe(false)
        expect(posthog.getPersistedProperty(PostHogPersistedProperty.PersonMode)).toEqual('identified')
      })

      it('does not reload feature flags on the transition when no properties are supplied', async () => {
        posthog.identify('user-123')
        await waitForPromises()

        expect(flagsCalls()).toHaveLength(0)
      })

      it('reloads feature flags on the transition when properties are supplied', async () => {
        posthog.identify('user-123', { email: 'john@example.com' })
        await waitForPromises()

        expect(flagsCalls()).toHaveLength(1)
      })

      it('does not emit a second $set on a repeated matching-id identify', async () => {
        posthog.identify('user-123', { email: 'john@example.com' })
        posthog.identify('user-123', { email: 'john@example.com' })
        await waitForPromises()

        expect(batchEvents().filter((e) => e.event === '$set')).toHaveLength(1)
      })

      it('fires the transition $set even when the same properties were already cached', async () => {
        // Populate the person-properties cache first, then identify with identical props: the
        // identity-state transition must still emit its $set (dedup cannot suppress it).
        posthog.setPersonProperties({ email: 'john@example.com' })
        await waitForPromises()
        expect(batchEvents().filter((e) => e.event === '$set')).toHaveLength(1)

        posthog.identify('user-123', { email: 'john@example.com' })
        await waitForPromises()

        expect(batchEvents().filter((e) => e.event === '$set')).toHaveLength(2)
        expect(posthog.getPersistedProperty(PostHogPersistedProperty.PersonMode)).toEqual('identified')
      })

      it('does not upgrade an anonymous user to identified on an argument-less identify()', async () => {
        posthog.identify()
        await waitForPromises()

        expect(batchEvents()).toHaveLength(0)
        expect(posthog.getPersistedProperty(PostHogPersistedProperty.PersonMode)).not.toEqual('identified')
      })
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

    it('should send $set event when distinct_id is the same but properties are different', async () => {
      // First identify with a new user
      posthog.identify('id-1', { foo: 'bar' })
      await waitForPromises()
      mocks.fetch.mockClear()

      // Second identify with the same user but different properties should send $set
      posthog.identify('id-1', { foo: 'baz' })
      await waitForPromises()

      expect(mocks.fetch).toHaveBeenCalled()
      const batchCall = mocks.fetch.mock.calls.find((call) => call[0].includes('/batch/'))
      expect(batchCall).toBeDefined()
      expect(parseBody(batchCall)).toMatchObject({
        batch: [
          {
            event: '$set',
            properties: {
              $set: { foo: 'baz' },
              $set_once: {},
            },
          },
        ],
      })
    })

    it('should not send event when distinct_id and properties are the same', async () => {
      // First identify
      posthog.identify('id-1', { foo: 'bar' })
      await waitForPromises()
      mocks.fetch.mockClear()

      // Second identify with exact same properties should be ignored
      posthog.identify('id-1', { foo: 'bar' })
      await waitForPromises()

      // Should not have made a batch call (only flags call)
      const batchCalls = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/'))
      expect(batchCalls.length).toBe(0)
    })

    it('should not send event when only distinct_id is provided (no properties)', async () => {
      // First identify
      posthog.identify('id-1')
      await waitForPromises()
      mocks.fetch.mockClear()

      // Second identify with no properties should not send anything
      posthog.identify('id-1')
      await waitForPromises()

      // Should not have made a batch call
      const batchCalls = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/'))
      expect(batchCalls.length).toBe(0)
    })
  })
})
