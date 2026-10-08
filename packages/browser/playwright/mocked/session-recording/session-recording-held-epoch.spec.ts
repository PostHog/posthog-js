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

    test('reports the hold in debug properties while nothing is uploaded, and clears it after interaction', async ({
        page,
    }) => {
        const debugProperties = () =>
            page.evaluate(() => (window as WindowWithPostHog).posthog?.sessionRecording?.sdkDebugProperties)

        const heldEvents = await page.capturedEvents()
        expect(heldEvents.filter((e) => e.event === '$snapshot')).toHaveLength(0)
        const held = await debugProperties()
        expect(held?.$recording_status).toEqual('active')
        expect(held?.$sdk_debug_replay_flush_hold_reason).toEqual('no_interaction_since_recording_started')

        await page.resetCapturedEvents()
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('hello posthog!')
            },
        })

        const shippedEvents = await page.capturedEvents()
        expect(shippedEvents.filter((e) => e.event === '$snapshot').length).toBeGreaterThan(0)
        const shipped = await debugProperties()
        expect(shipped?.$recording_status).toEqual('active')
        expect(shipped?.$sdk_debug_replay_flush_hold_reason).toBeUndefined()
    })
})
