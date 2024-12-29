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
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: './playground/cypress/index.html',
}

test.describe('Session recording - linked flags', () => {
    test.beforeEach(async ({ page, context }) => {
        await start(startOptions, page, context)
        await page.expectCapturedEventsToBe([])
        await page.resetCapturedEvents()
    })

    test('can opt in and override linked flag', async ({ page }) => {
        await page.waitingForNetworkCausedBy(['**/recorder.js*'], async () => {
            await page.evaluate(() => {
                const ph = (window as WindowWithPostHog).posthog
                ph?.opt_in_capturing()
                // starting does not begin recording because of the linked flag
                ph?.startSessionRecording()
            })
        })
        await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])

        await page.resetCapturedEvents()

        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.startSessionRecording({ linked_flag: true })
        })
        await page.locator('[data-cy-input]').type('hello posthog!')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })
})
