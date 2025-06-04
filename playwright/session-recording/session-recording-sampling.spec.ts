import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const startOptions = {
    options: {
        session_recording: {},
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

test.describe('Session recording - sampling', () => {
    const sampleZeroStartOptions = {
        ...startOptions,
        flagsResponseOverrides: {
            ...startOptions.flagsResponseOverrides,
            sessionRecording: {
                ...startOptions.flagsResponseOverrides.sessionRecording,
                sampleRate: '0',
            },
        },
    }
    test.beforeEach(async ({ page, context }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/recorder.js*'],
            action: async () => {
                await start(startOptions, page, context)
            },
        })

        await page.expectCapturedEventsToBe(['$pageview'])
        await page.resetCapturedEvents()
    })

    test('does not capture events when sampling is set to 0', async ({ page }) => {
        await page.locator('[data-cy-input]').fill('hello posthog!')
        // because it doesn't make sense to wait for a snapshot event that won't happen
        await page.waitForTimeout(250)

        await page.expectCapturedEventsToBe([])
    })

    test('can override sampling when starting session recording', async ({ page, context }) => {
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.startSessionRecording({ sampling: true })
            ph?.capture('test_registered_property')
        })
        await page.expectCapturedEventsToBe(['test_registered_property'])
        expect((await page.capturedEvents())[0]['properties']['$session_recording_start_reason']).toEqual(
            'sampling_overridden'
        )

        // sampling override survives a page refresh
        await page.resetCapturedEvents()
        await page.reload()

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/recorder.js*'],
            action: async () => {
                await start(
                    {
                        ...sampleZeroStartOptions,
                        type: 'reload',
                    },
                    page,
                    context
                )
            },
        })
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').fill('hello posthog!')
            },
        })

        const afterReloadCapturedEvents = await page.capturedEvents()
        const lastCaptured = afterReloadCapturedEvents[afterReloadCapturedEvents.length - 1]
        expect(lastCaptured['event']).toEqual('$snapshot')
    })
})
