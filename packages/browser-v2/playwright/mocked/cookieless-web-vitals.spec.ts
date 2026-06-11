import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { pollUntilEventCaptured } from './utils/event-capture-utils'

const startOptions = {
    options: {
        cookielessMode: 'always' as const,
        capturePerformance: {
            web_vitals: true,
        },
    },
    flagsResponseOverrides: {
        capturePerformance: true,
    },
    url: '/playground/cypress/index.html',
}

test.describe('Web Vitals in cookieless mode', () => {
    test('captures web vitals without session or window ids when cookieless', async ({ page, context }) => {
        await start(startOptions, page, context)

        await pollUntilEventCaptured(page, '$web_vitals')

        const webVitalsEvents = (await page.capturedEvents()).filter((event) => event.event === '$web_vitals')
        expect(webVitalsEvents.length).toBeGreaterThan(0)

        const webVitalsEvent = webVitalsEvents[0]
        expect(webVitalsEvent.properties).toMatchObject({
            $current_url: expect.any(String),
            $cookielessMode: true,
            $web_vitals_FCP_value: expect.any(Number),
        })

        expect(webVitalsEvent.properties.$session_id).toBeUndefined()
        expect(webVitalsEvent.properties.$window_id).toBeUndefined()
        expect(webVitalsEvent.properties.distinct_id).toBe('$posthog_cookieless')

        expect(webVitalsEvent.properties.$web_vitals_FCP_event).toMatchObject({
            name: 'FCP',
            value: expect.any(Number),
            $current_url: expect.any(String),
            timestamp: expect.any(Number),
        })

        expect(webVitalsEvent.properties.$web_vitals_FCP_event.$session_id).toBeUndefined()
        expect(webVitalsEvent.properties.$web_vitals_FCP_event.$window_id).toBeUndefined()
    })

    test('does not capture web vitals when cookieless but vitals disabled', async ({ page, context }) => {
        await start(
            {
                ...startOptions,
                options: {
                    cookielessMode: 'always' as const,
                    capturePerformance: {
                        web_vitals: false,
                    },
                },
            },
            page,
            context
        )

        await page.waitForTimeout(5000)

        const webVitalsEvents = (await page.capturedEvents()).filter((event) => event.event === '$web_vitals')
        expect(webVitalsEvents.length).toBe(0)
    })
})
