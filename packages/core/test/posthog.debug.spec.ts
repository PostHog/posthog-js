import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from './test-utils/PostHogCoreTestClient'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let mocks: PostHogCoreTestClientMocks

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', {})
  })

  describe('debug', () => {
    it('should log emitted events when enabled', () => {
      const spy = jest.spyOn(console, 'log')

      posthog.capture('test-event1')
      expect(spy).toHaveBeenCalledTimes(0)

      posthog.debug()
      posthog.capture('test-event1')
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith(
        'PostHog Debug',
        'capture',
        expect.objectContaining({
          event: 'test-event1',
        })
      )

      spy.mockReset()
      posthog.debug(false)
      posthog.capture('test-event1')
      expect(spy).toHaveBeenCalledTimes(0)
    })
  })
})
