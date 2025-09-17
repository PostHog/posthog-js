import { expect } from '../utils/posthog-playwright-test-base'
import { test } from '../../fixtures'

test.describe('ErrorTracking stackparser', () => {
    test.use({ url: '/playground/cypress/index.html' })

    test('should parse frames in all browsers', async ({ posthog, events }) => {
        await posthog.init()
        await posthog.evaluate((ph) => {
            return ph.captureException(new Error('test error'))
        })
        const exception = await events.waitForEvent('$exception')
        expect(exception.properties.$exception_list[0].stacktrace.frames).toHaveLength(3)
    })
})
