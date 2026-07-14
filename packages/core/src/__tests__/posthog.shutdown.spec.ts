import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  describe('shutdown', () => {
    beforeEach(() => {
      jest.useRealTimers()
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 10,
        preloadFeatureFlags: false,
      })
    })

    it('flush messsages once called', async () => {
      for (let i = 0; i < 5; i++) {
        posthog.capture('test-event')
      }

      await posthog.shutdown()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    })

    it('respects timeout', async () => {
      mocks.fetch.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        console.log('FETCH RETURNED')
        return {
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve({ status: 'ok' }),
        }
      })

      posthog.capture('test-event')

      await posthog
        .shutdown(100)
        .then(() => {
          throw new Error('Should not resolve')
        })
        .catch((e) => {
          expect(e).toEqual('Timeout while shutting down PostHog. Some events may not have been sent.')
        })
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    })

    it('does not spin forever if flush resolves without draining the queue', async () => {
      const flush = jest.fn(() => Promise.resolve())
      posthog.flush = flush
      posthog.capture('test-event')

      await posthog.shutdown(100)

      expect(flush).toHaveBeenCalledTimes(1)
      expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('drains events captured during the shutdown flush even if they reuse a uuid', async () => {
      const uuid = 'f6d64d99-0e4f-4d95-b202-a2160d17b788'
      const batches: any[][] = []
      let recaptured = false
      mocks.fetch.mockImplementation(async (_, options) => {
        batches.push(JSON.parse((options.body || '') as string).batch)
        if (!recaptured) {
          recaptured = true
          posthog.capture('second-event', undefined, { uuid })
        }
        return {
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve({ status: 'ok' }),
        }
      })

      posthog.capture('first-event', undefined, { uuid })
      await posthog.shutdown()

      expect(batches.flat()).toMatchObject([{ event: 'first-event' }, { event: 'second-event' }])
    })

    it('return the same promise if called multiple times in parallel', async () => {
      mocks.fetch.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        return {
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve({ status: 'ok' }),
        }
      })

      posthog.capture('test-event')

      const p1 = posthog.shutdown(100)
      const p2 = posthog.shutdown(100)
      expect(p1).toEqual(p2)
      await Promise.allSettled([p1, p2])
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    })

    it('can handle being called multiple times in series (discouraged but some users will do this)', async () => {
      mocks.fetch.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        console.log('FETCH RETURNED')
        return {
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve({ status: 'ok' }),
        }
      })

      posthog.capture('test-event')
      await posthog.shutdown()

      posthog.capture('test-event')
      await posthog.shutdown()

      expect(mocks.fetch).toHaveBeenCalledTimes(2)
    })
  })
})
