import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

const startOptions = {
    options: {
        session_recording: {
            compress_events: false,
        },
    },
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: './playground/cypress/index.html',
}

test.describe('Session recording - held epoch', () => {
    test.beforeEach(async ({ page, context }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(startOptions, page, context)
            },
        })
        await waitForSessionRecordingToStart(page)
        await page.expectCapturedEventsToBe(['$pageview'])
        await page.resetCapturedEvents()
    })

    test('names the hold on captured events while nothing is uploaded, and stops naming it after interaction', async ({
        page,
    }) => {
        await page.evaluate(() => (window as WindowWithPostHog).posthog?.capture('before_interaction'))

        const heldEvents = await page.capturedEvents()
        expect(heldEvents.filter((e) => e.event === '$snapshot')).toHaveLength(0)
        const held = heldEvents.find((e) => e.event === 'before_interaction')
        expect(held?.properties.$recording_status).toEqual('active')
        expect(held?.properties.$sdk_debug_replay_flush_hold_reason).toEqual('no_interaction_since_recording_started')

        await page.resetCapturedEvents()
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('hello posthog!')
            },
        })
        await page.evaluate(() => (window as WindowWithPostHog).posthog?.capture('after_interaction'))

        const shippedEvents = await page.capturedEvents()
        expect(shippedEvents.filter((e) => e.event === '$snapshot').length).toBeGreaterThan(0)
        const shipped = shippedEvents.find((e) => e.event === 'after_interaction')
        expect(shipped?.properties.$recording_status).toEqual('active')
        expect(shipped?.properties.$sdk_debug_replay_flush_hold_reason).toBeUndefined()
    })
})
