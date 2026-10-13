import { test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import { assertThatRecordingStarted, pollUntilEventCaptured } from '../utils/event-capture-utils'

test.beforeEach(async ({ page }) => {
    await page.clock.install()
})

const startOptions = {
    options: {
        session_recording: {
            // not the default but makes for easier test assertions
            compress_events: false,
        },
        opt_out_capturing_by_default: true,
    },
    flagsResponseOverrides: {
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
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
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
    })

    test('respects sampling when overriding linked flag', async ({ page }) => {
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.startSessionRecording({ linked_flag: true })
        })
        await page.locator('[data-cy-input]').type('hello posthog!')
        // A linked-flag override must not release zero-sampled replay.
        await page.clock.runFor(4500)
        // no new events
        await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])
        await page.resetCapturedEvents()

        // Releasing only sampling proves the earlier linked-flag override took effect.
        await page.evaluate(() => (window as WindowWithPostHog).posthog!.startSessionRecording({ sampling: true }))
        await page.locator('[data-cy-input]').type('sampling alone releases the linked override')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })

    test('all-controls override releases a fresh recording gated by both sampling and linked flag', async ({
        page,
    }) => {
        await page.resetCapturedEvents()
        await page.locator('[data-cy-input]').type('fresh session remains gated')
        await page.clock.runFor(4500)
        await page.expectCapturedEventsToBe([])

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
