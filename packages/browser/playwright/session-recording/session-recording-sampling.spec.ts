import { expect, test } from '../fixtures'

test.describe('Session recording - sampling', () => {
    test.use({
        url: './playground/cypress/index.html',
        posthogOptions: {
            session_recording: {},
        },
        flagsOverrides: {
            sessionRecording: {
                endpoint: '/ses/',
                sampleRate: '0',
            },
            capturePerformance: true,
            autocapture_opt_out: true,
        },
    })

    test.beforeEach(async ({ page, posthog, events }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/recorder.js*'],
            action: async () => {
                await posthog.init()
                await events.waitForEvent('$pageview')
            },
        })

        events.expectMatchList(['$pageview'])
        events.clear()
    })

    test('does not capture events when sampling is set to 0', async ({ page, events }) => {
        await page.locator('[data-cy-input]').fill('hello posthog!')
        // because it doesn't make sense to wait for a snapshot event that won't happen
        await page.waitForTimeout(250)

        events.expectMatchList([])
    })

    test('can override sampling when starting session recording', async ({ page, posthog, events }) => {
        await posthog.evaluate((ph) => {
            ph.startSessionRecording({ sampling: true })
            ph.capture('test_registered_property')
        })
        events.expectMatchList(['test_registered_property'])
        expect(events.first()!['properties']['$session_recording_start_reason']).toEqual('sampling_overridden')

        // sampling override survives a page refresh
        events.clear()
        await page.reloadIdle()

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/recorder.js*'],
            action: async () => {
                await page.reloadIdle()
                await posthog.init()
                await page.waitForLoadState('networkidle')
            },
        })
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').fill('hello posthog!')
            },
        })

        const afterReloadCapturedEvents = events.all()
        const lastCaptured = afterReloadCapturedEvents[afterReloadCapturedEvents.length - 1]
        expect(lastCaptured['event']).toEqual('$snapshot')
    })
})
