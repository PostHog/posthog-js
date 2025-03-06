import { test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import { assertThatRecordingStarted, pollUntilEventCaptured } from '../utils/event-capture-utils'

const startOptions = {
    options: {
        session_recording: {},
        opt_out_capturing_by_default: true,
    },
    decideResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
            // a flag that doesn't exist, can never be recorded
            linkedFlag: 'i am a flag that does not exist',
            // will never record a session with rate of 0
            sampleRate: '0',
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: './playground/cypress/index.html',
}

test.describe('Session recording - multiple ingestion controls', () => {
    test.beforeEach(async ({ page, context }) => {
        await start(startOptions, page, context)
        await page.expectCapturedEventsToBe([])
        await page.resetCapturedEvents()
    })

    test('respects sampling when overriding linked flag', async ({ page }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/recorder.js*'],
            action: async () => {
                await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog
                    ph?.opt_in_capturing()
                    // this won't start recording because of the linked flag and sample rate
                    ph?.startSessionRecording()
                })
            },
        })

        await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])

        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.startSessionRecording({ linked_flag: true })
        })
        await page.locator('[data-cy-input]').type('hello posthog!')
        // there's nothing to wait for... so, just wait a bit
        await page.waitForTimeout(250)
        // no new events
        await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])
        await page.resetCapturedEvents()

        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            // override all controls
            ph?.startSessionRecording(true)
        })
        await page.locator('[data-cy-input]').type('hello posthog!')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })
})
