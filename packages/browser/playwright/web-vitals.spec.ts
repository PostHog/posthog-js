import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { pollUntilEventCaptured } from './utils/event-capture-utils'

const startOptions = {
    options: {
        capture_performance: {
            web_vitals: true,
        },
    },
    flagsResponseOverrides: {
        capturePerformance: true,
    },
    url: '/playground/cypress/index.html',
}

test.describe('Web Vitals', () => {
    test('captures web vitals events when enabled', async ({ page, context }) => {
        await start(startOptions, page, context)

        // Wait for web vitals events to be captured
        await pollUntilEventCaptured(page, '$web_vitals')

        const webVitalsEvents = (await page.capturedEvents()).filter((event) => event.event === '$web_vitals')
        expect(webVitalsEvents.length).toBeGreaterThan(0)

        const webVitalsEvent = webVitalsEvents[0]
        // will always get the FCP event on this bot browser but not necessarily the others
        expect(webVitalsEvent.properties).toMatchObject({
            $current_url: expect.any(String),
            $session_id: expect.any(String),
            $window_id: expect.any(String),
            $web_vitals_FCP_value: expect.any(Number),
        })

        expect(webVitalsEvent.properties.$web_vitals_FCP_event).toMatchObject({
            name: 'FCP',
            value: expect.any(Number),
            $current_url: expect.any(String),
            $session_id: expect.any(String),
            $window_id: expect.any(String),
            timestamp: expect.any(Number),
        })
    })

    test('does not capture web vitals when disabled', async ({ page, context }) => {
        await start(
            {
                ...startOptions,
                options: {
                    capture_performance: {
                        web_vitals: false,
                    },
                },
            },
            page,
            context
        )

        // Wait a bit to ensure no web vitals events are captured
        await page.waitForTimeout(5000)

        const webVitalsEvents = (await page.capturedEvents()).filter((event) => event.event === '$web_vitals')
        expect(webVitalsEvents.length).toBe(0)
    })
})
