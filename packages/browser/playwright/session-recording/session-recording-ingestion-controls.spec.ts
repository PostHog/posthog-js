import { test, WindowWithPostHog } from '../fixtures'

const startOptions = {
    posthogOptions: {
        session_recording: {},
        opt_out_capturing_by_default: true,
    },
    flagsOverrides: {
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
    test.use(startOptions)

    test.beforeEach(async ({ posthog, events }) => {
        await posthog.init()
        await posthog.waitForLoaded()
        events.expectMatchList([])
        events.clear()
    })

    test('respects sampling when overriding linked flag', async ({ page, posthog, events }) => {
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

        events.expectMatchList(['$opt_in', '$pageview'])

        await posthog.evaluate((ph) => {
            ph.startSessionRecording({ linked_flag: true })
        })
        await page.locator('[data-cy-input]').fill('hello posthog!')
        // there's nothing to wait for... so, just wait a bit
        await page.waitForTimeout(250)
        // no new events
        events.expectMatchList(['$opt_in', '$pageview'])
        events.clear()

        await posthog.evaluate((ph) => {
            ph.startSessionRecording(true)
        })
        await page.locator('[data-cy-input]').fill('hello posthog!')
        await events.waitForEvent('$snapshot')
        events.expectRecordingStarted()
    })
})
