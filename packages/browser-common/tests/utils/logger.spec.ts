// @vitest-environment jsdom
import { createLogger } from '../../src/utils/logger'

describe('logger', () => {
    // debug mode is off here, so these tests prove the message is visible anyway
    let errorSpy: vi.SpyInstance

    beforeEach(() => {
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        errorSpy.mockRestore()
    })

    describe('uninitializedWarning', () => {
        it('logs even when debug mode is off', () => {
            const logger = createLogger('[Test]')

            logger.error('a normal error')
            expect(errorSpy).not.toHaveBeenCalled()

            logger.uninitializedWarning('posthog.capture')
            expect(errorSpy).toHaveBeenCalledWith(
                '[PostHog.js] [Test]',
                'You must initialize PostHog before calling posthog.capture'
            )
        })

        it('logs only once per method', () => {
            const logger = createLogger('[Test]')

            logger.uninitializedWarning('posthog.capture')
            logger.uninitializedWarning('posthog.capture')
            logger.uninitializedWarning('posthog.identify')

            expect(errorSpy).toHaveBeenCalledTimes(2)
        })
    })
})
