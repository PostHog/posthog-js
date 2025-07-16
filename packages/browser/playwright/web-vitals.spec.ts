import { expect, test } from './fixtures'

test.describe('Web Vitals', () => {
    test.use({
        posthogOptions: {
            capture_performance: {
                web_vitals: true,
            },
        },
        flagsOverrides: {
            capturePerformance: true,
        },
        url: '/playground/cypress/index.html',
    })
    test('captures web vitals events when enabled', async ({ posthog, events }) => {
        await posthog.init()

        // Wait for web vitals events to be captured
        await events.waitForEvent('$web_vitals')

        const webVitalsEvents = events.filterByName('$web_vitals')
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

    test('does not capture web vitals when disabled', async ({ page, posthog, events }) => {
        await posthog.init({
            capture_performance: {
                web_vitals: false,
            },
        })

        // Wait a bit to ensure no web vitals events are captured
        await page.waitForTimeout(5000)

        const webVitalsEvents = events.filterByName('$web_vitals')
        expect(webVitalsEvents.length).toBe(0)
    })
})
