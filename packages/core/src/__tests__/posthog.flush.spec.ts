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

    it.each([400, 500])('responds with an error after retries with %s error', async (status) => {
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
