import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const startOptions = {
    options: {
        session_recording: {
            // not the default but makes for easier test assertions
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
    let replayRequests: string[]

    test.beforeEach(async ({ page, context }) => {
        replayRequests = []
        page.on('request', (request) => {
            if (new URL(request.url()).pathname.startsWith('/ses/')) replayRequests.push(request.url())
        })
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(sampleZeroStartOptions, page, context)
            },
        })
        await expect
            .poll(() => page.evaluate(() => (window as WindowWithPostHog).posthog?.sessionRecording?.status))
            .toBe('disabled')

        await page.expectCapturedEventsToBe(['$pageview'])
        await page.resetCapturedEvents()
    })

    test('does not capture events when sampling is set to 0', async ({ page }) => {
        await page.locator('[data-cy-input]').fill('hello posthog!')
        // Observe beyond the recorder's 2-second flush interval.
        await page.waitForTimeout(2500)

        await page.expectCapturedEventsToBe([])
        expect(replayRequests).toEqual([])
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

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').fill('record before reload')
            },
        })
        expect((await page.capturedEvents()).some((event) => event.event === '$snapshot')).toBe(true)

        // sampling override survives a page refresh
        await page.resetCapturedEvents()
        await page.reload()

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
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
