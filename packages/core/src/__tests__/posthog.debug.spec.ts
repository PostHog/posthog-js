import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    ;[posthog] = createTestClient('TEST_API_KEY', {})
  })

  describe('debug', () => {
    it('should log emitted events when enabled', () => {
      posthog.capture('test-event1')
      expect(logSpy).toHaveBeenCalledTimes(0)

      posthog.debug()
      posthog.capture('test-event1')
      expect(logSpy).toHaveBeenCalledTimes(1)
      expect(logSpy).toHaveBeenCalledWith(
        '[PostHog]',
        'capture',
        expect.objectContaining({
          event: 'test-event1',
        })
      )

      logSpy.mockReset()
      posthog.debug(false)
      posthog.capture('test-event1')
      expect(logSpy).toHaveBeenCalledTimes(0)
    })
  })
})
