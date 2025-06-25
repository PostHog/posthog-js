import { waitForPromises } from './test-utils/test-utils'
import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from './test-utils/PostHogCoreTestClient'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let mocks: PostHogCoreTestClientMocks

  jest.useFakeTimers()
  jest.setSystemTime(new Date('2022-01-01'))

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 10 })
  })

  describe('on', () => {
    it('should listen to various events', () => {
      const mock = jest.fn()
      const mockOther = jest.fn()
      posthog.on('identify', mock)
      posthog.on('identify', mockOther)

      posthog.identify('user-1')
      expect(mock).toHaveBeenCalledTimes(1)
      expect(mockOther).toHaveBeenCalledTimes(1)
      expect(mock.mock.lastCall[0]).toMatchObject({ type: 'identify' })
    })

    it('should unsubscribe when called', () => {
      const mock = jest.fn()
      const unsubscribe = posthog.on('identify', mock)

      posthog.identify('user-1')
      expect(mock).toHaveBeenCalledTimes(1)
      posthog.identify('user-1')
      expect(mock).toHaveBeenCalledTimes(2)
      unsubscribe()
      posthog.identify('user-1')
      expect(mock).toHaveBeenCalledTimes(2)
    })

    it('should subscribe to flush events', async () => {
      const mock = jest.fn()
      posthog.on('flush', mock)
      posthog.capture('event')
      expect(mock).toHaveBeenCalledTimes(0)
      jest.runOnlyPendingTimers()
      await waitForPromises()
      expect(mock).toHaveBeenCalledTimes(1)
    })
  })
})
