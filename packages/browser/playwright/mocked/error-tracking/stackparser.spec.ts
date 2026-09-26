import { expect } from '../utils/posthog-playwright-test-base'
import { test } from '../../fixtures'

test.describe('ErrorTracking stackparser', () => {
    test.use({ url: '/playground/cypress/index.html' })

    test('should parse frames in all browsers', async ({ posthog, page, events, browserName }) => {
        await posthog.init()
        await page.click('[data-cy-exception-button]')
        const exception = await events.waitForEvent('$exception')
        expect(exception.properties.$exception_list[0].stacktrace.frames).toHaveLength(1)
        const [frame] = exception.properties.$exception_list[0].stacktrace.frames
        expect(frame.filename).toContain('/playground/cypress/index.html')
        expect(frame.function).toBe(browserName === 'chromium' ? 'HTMLButtonElement.onclick' : 'onclick')
        expect(frame.lineno).toBeGreaterThan(0)
        expect(frame.colno).toBeGreaterThan(0)
    })
})
