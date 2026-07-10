import { delay, waitForPromises, createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'
import { PostHogPersistedProperty } from '@/types'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  describe('flush', () => {
    beforeEach(() => {
      jest.useFakeTimers()
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 5,
        fetchRetryCount: 3,
        fetchRetryDelay: 100,
        preloadFeatureFlags: false,
      })
    })

    it("doesn't fail when queue is empty", async () => {
      jest.useRealTimers()
      await expect(posthog.flush()).resolves.not.toThrow()
      expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('flush messages once called', async () => {
      const successfulMessages: any[] = []

      mocks.fetch.mockImplementation(async (_, options) => {
        const batch = JSON.parse((options.body || '') as string).batch

        successfulMessages.push(...batch)
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve({ status: 'ok' }),
        })
      })

      posthog.capture('test-event-1')
      posthog.capture('test-event-2')
      posthog.capture('test-event-3')
      expect(mocks.fetch).not.toHaveBeenCalled()
      await expect(posthog.flush()).resolves.not.toThrow()
      expect(mocks.fetch).toHaveBeenCalled()
      expect(successfulMessages).toMatchObject([
        { event: 'test-event-1' },
        { event: 'test-event-2' },
        { event: 'test-event-3' },
      ])
    })

    it('waits for pending promises that enqueue events before flushing', async () => {
      const successfulMessages: any[] = []
      let resolvePending!: () => void

      mocks.fetch.mockImplementation(async (_, options) => {
        const batch = JSON.parse((options.body || '') as string).batch

        successfulMessages.push(...batch)
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve({ status: 'ok' }),
        })
      })

      posthog.addPendingPromise(
        new Promise<void>((resolve) => {
          resolvePending = resolve
        }).then(() => {
          posthog.capture('pending-event')
        })
      )

      const flushPromise = posthog.flushWithPendingPromises()
      await waitForPromises()
      expect(mocks.fetch).not.toHaveBeenCalled()

      resolvePending()
      await expect(flushPromise).resolves.not.toThrow()
      expect(successfulMessages).toMatchObject([{ event: 'pending-event' }])
    })

    it('does not wait for unrelated pending promises added after flush starts', async () => {
      const successfulMessages: any[] = []
      let resolvePending!: () => void

      mocks.fetch.mockImplementation(async (_, options) => {
        const batch = JSON.parse((options.body || '') as string).batch

        successfulMessages.push(...batch)
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve({ status: 'ok' }),
        })
      })

      posthog.capture('queued-event')
      posthog.addPendingPromise(
        new Promise<void>((resolve) => {
          resolvePending = resolve
        })
      )

      const flushPromise = posthog.flushWithPendingPromises()
      posthog.addPendingPromise(new Promise<void>(() => {}))
      resolvePending()

      await expect(flushPromise).resolves.not.toThrow()
      expect(successfulMessages).toMatchObject([{ event: 'queued-event' }])
    })

    it('flushes queued events even if a pending promise rejects', async () => {
      const successfulMessages: any[] = []

      mocks.fetch.mockImplementation(async (_, options) => {
        const batch = JSON.parse((options.body || '') as string).batch

        successfulMessages.push(...batch)
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve({ status: 'ok' }),
        })
      })

      posthog.capture('queued-event')
      posthog.addPendingPromise(Promise.reject(new Error('pending failure')))

      await expect(posthog.flushWithPendingPromises()).resolves.not.toThrow()
      expect(successfulMessages).toMatchObject([{ event: 'queued-event' }])
    })

    it('regular flush does not wait for pending promises', async () => {
      const successfulMessages: any[] = []

      mocks.fetch.mockImplementation(async (_, options) => {
        const batch = JSON.parse((options.body || '') as string).batch

        successfulMessages.push(...batch)
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve({ status: 'ok' }),
        })
      })

      posthog.capture('queued-event')
      posthog.addPendingPromise(new Promise<void>(() => {}))

      await expect(posthog.flush()).resolves.not.toThrow()
      expect(successfulMessages).toMatchObject([{ event: 'queued-event' }])
    })

    it.each([
      ['with ReadableStream body', { cancel: jest.fn().mockResolvedValue(undefined) }, true],
      ['with null body', null, false],
    ])('consumes response body after flush (%s)', async (_label, body, expectCancel) => {
      const cancelFn = body?.cancel

      mocks.fetch.mockImplementation(async () => {
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve({ status: 'ok' }),
          body,
        })
      })

      posthog.capture('test-event-1')
      jest.useRealTimers()
      await expect(posthog.flush()).resolves.not.toThrow()

      if (expectCancel) {
        expect(cancelFn).toHaveBeenCalledTimes(1)
      }
    })

    it.each([400, 401, 403])('responds with an error without retries with %s error', async (status) => {
      mocks.fetch.mockImplementation(() => {
        return Promise.resolve({
          status: status,
          text: async () => 'err',
          json: async () => ({ status: 'err' }),
        })
      })
      posthog.capture('test-event-1')

      jest.useRealTimers()
      await expect(posthog.flush()).rejects.toHaveProperty('name', 'PostHogFetchHttpError')
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    })

    it.each([408, 429, 500])('responds with an error after retries with %s error', async (status) => {
      mocks.fetch.mockImplementation(() => {
        return Promise.resolve({
          status: status,
          text: async () => 'err',
          json: async () => ({ status: 'err' }),
        })
      })
      posthog.capture('test-event-1')

      const time = Date.now()
      jest.useRealTimers()
      await expect(posthog.flush()).rejects.toHaveProperty('name', 'PostHogFetchHttpError')
      expect(mocks.fetch).toHaveBeenCalledTimes(4)
      expect(Date.now() - time).toBeGreaterThan(300)
      expect(Date.now() - time).toBeLessThan(500)
    })

    it('responds with an error after retries with network error ', async () => {
      mocks.fetch.mockImplementation(() => {
        return Promise.reject(new Error('network problems'))
      })
      posthog.capture('test-event-1')

      const time = Date.now()
      jest.useRealTimers()
      await expect(posthog.flush()).rejects.toHaveProperty('name', 'PostHogFetchNetworkError')
      expect(mocks.fetch).toHaveBeenCalledTimes(4)
      expect(Date.now() - time).toBeGreaterThan(300)
      expect(Date.now() - time).toBeLessThan(500)
    })

    it('skips when client is disabled', async () => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 2 })

      posthog.capture('test-event-1')
      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(0)
      posthog.capture('test-event-2')
      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      posthog.optOut()
      posthog.capture('test-event-3')
      posthog.capture('test-event-4')
      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    })

    it('does not get stuck in a loop when new events are added while flushing', async () => {
      jest.useRealTimers()
      mocks.fetch.mockImplementation(async () => {
        posthog.capture('another-event')
        await delay(10)
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve({ status: 'ok' }),
        })
      })

      posthog.capture('test-event-1')
      await posthog.flush()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    })

    it('coalesces flush calls made while a flush is already queued', async () => {
      jest.useRealTimers()
      let resolveFetch!: () => void
      mocks.fetch.mockImplementation(async () => {
        await new Promise<void>((resolve) => (resolveFetch = resolve))
        return {
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve({ status: 'ok' }),
        }
      })

      posthog.capture('test-event-1')
      const inFlight = posthog.flush()
      await waitForPromises() // let the first flush start its fetch

      const queued = posthog.flush()
      const coalesced = posthog.flush()

      expect(coalesced).toBe(queued)
      expect(queued).not.toBe(inFlight)

      resolveFetch()
      await expect(inFlight).resolves.not.toThrow()
      await expect(queued).resolves.not.toThrow()
      // the follow-up found an empty queue, so only one fetch happened
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    })

    it('sends events captured during an in-flight flush via the coalesced follow-up', async () => {
      jest.useRealTimers()
      const batches: any[][] = []
      let resolveFirstFetch!: () => void
      mocks.fetch.mockImplementation(async (_, options) => {
        batches.push(JSON.parse((options.body || '') as string).batch)
        if (batches.length === 1) {
          await new Promise<void>((resolve) => (resolveFirstFetch = resolve))
        }
        return {
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve({ status: 'ok' }),
        }
      })

      posthog.capture('first')
      const inFlight = posthog.flush()
      await waitForPromises() // first flush has read the queue and is mid-fetch

      posthog.capture('second')
      const followUp = posthog.flush()
      posthog.capture('third')
      expect(posthog.flush()).toBe(followUp)

      resolveFirstFetch()
      await Promise.all([inFlight, followUp])

      expect(batches[0]).toMatchObject([{ event: 'first' }])
      expect(batches[1]).toMatchObject([{ event: 'second' }, { event: 'third' }])
    })

    it('does not chain one flush per capture while flushes fail', async () => {
      jest.useRealTimers()
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 2,
        fetchRetryCount: 0,
        preloadFeatureFlags: false,
      })
      mocks.fetch.mockImplementation(() => Promise.reject(new Error('network down')))

      for (let i = 0; i < 20; i++) {
        posthog.capture(`offline-event-${i}`)
      }
      await delay(50) // let the flush chain settle

      // all 20 captures coalesced into a single flush — not one flush per capture
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Queue)).toHaveLength(20)

      // coalescing doesn't leave flushing permanently stuck
      posthog.capture('offline-event-20')
      await delay(50)
      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Queue)).toHaveLength(21)
    })

    it('should flush all events even if larger than batch size', async () => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 10 })

      const successfulMessages: any[] = []

      mocks.fetch.mockImplementation(async (_, options) => {
        const batch = JSON.parse((options.body || '') as string).batch

        successfulMessages.push(...batch)
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve({ status: 'ok' }),
        })
      })

      posthog['maxBatchSize'] = 2 // a bit contrived because usually maxBatchSize >= flushAt
      posthog.capture('test-event-1')
      posthog.capture('test-event-2')
      posthog.capture('test-event-3')
      posthog.capture('test-event-4')
      await expect(posthog.flush()).resolves.not.toThrow()
      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      expect(successfulMessages).toMatchObject([
        { event: 'test-event-1' },
        { event: 'test-event-2' },
        { event: 'test-event-3' },
        { event: 'test-event-4' },
      ])
    })

    it('should reduce the batch size without dropping events if received 413', async () => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 10 })
      const successfulMessages: any[] = []

      mocks.fetch.mockImplementation(async (_, options) => {
        const batch = JSON.parse((options.body || '') as string).batch

        if (batch.length > 1) {
          return Promise.resolve({
            status: 413,
            text: () => Promise.resolve('Content Too Large'),
            json: () => Promise.resolve({ status: 'Content Too Large' }),
          })
        } else {
          successfulMessages.push(...batch)
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () => Promise.resolve({ status: 'ok' }),
          })
        }
      })

      posthog.capture('test-event-1')
      posthog.capture('test-event-2')
      posthog.capture('test-event-3')
      posthog.capture('test-event-4')
      await expect(posthog.flush()).resolves.not.toThrow()
      expect(successfulMessages).toMatchObject([
        { event: 'test-event-1' },
        { event: 'test-event-2' },
        { event: 'test-event-3' },
        { event: 'test-event-4' },
      ])
      expect(mocks.fetch).toHaveBeenCalledTimes(6) // 2 failures with size 4 then 2, then 4 successes with size 1
    })

    it('should treat a 413 at batchSize 1 as a regular error', async () => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 10 })

      mocks.fetch.mockImplementation(async () => {
        return Promise.resolve({
          status: 413,
          text: () => Promise.resolve('Content Too Large'),
          json: () => Promise.resolve({ status: 'Content Too Large' }),
        })
      })

      posthog.capture('test-event-1')
      await expect(posthog.flush()).rejects.toHaveProperty('name', 'PostHogFetchHttpError')
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    })

    it('should stop at first error', async () => {
      jest.useRealTimers()
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 10, fetchRetryDelay: 1 })
      posthog['maxBatchSize'] = 1 // a bit contrived because usually maxBatchSize >= flushAt
      const successfulMessages: any[] = []

      mocks.fetch.mockImplementation(async (_, options) => {
        const batch = JSON.parse((options.body || '') as string).batch

        if (batch.some((msg: any) => msg.event.includes('cursed'))) {
          return Promise.resolve({
            status: 500,
            text: () => Promise.resolve('Cursed'),
            json: () => Promise.resolve({ status: 'Cursed' }),
          })
        } else {
          successfulMessages.push(...batch)
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () => Promise.resolve({ status: 'ok' }),
          })
        }
      })

      posthog.capture('test-event-1')
      posthog.capture('cursed-event-2')
      posthog.capture('test-event-3')

      await expect(posthog.flush()).rejects.toHaveProperty('name', 'PostHogFetchHttpError')
      expect(successfulMessages).toMatchObject([{ event: 'test-event-1' }])
      expect(mocks.storage.getItem(PostHogPersistedProperty.Queue)).toMatchObject([
        { message: { event: 'test-event-3' } },
      ])
    })
  })
})
