import { expect } from '../utils/posthog-playwright-test-base'
import { test } from '../../fixtures'

test.describe('ErrorTracking stackparser', () => {
    test.use({ url: '/playground/cypress/index.html' })

    test('should parse frames in all browsers', async ({ posthog, events, browserName }) => {
        await posthog.init()
        await posthog.evaluate((ph) => {
            return ph.captureException(new Error('test error'))
        })
        const exception = await events.waitForEvent('$exception')
        if (browserName === 'chromium') {
            // webkit produces: "at unknown (http://localhost:2345/playground/cypress/index.html:1:0)"
            expect(exception.properties.$exception_list[0].stacktrace.frames).toHaveLength(3)
        }
    })
})
