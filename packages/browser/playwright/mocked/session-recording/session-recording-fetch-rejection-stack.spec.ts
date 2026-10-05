import { expect, test } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

test('preserves the application call site when a recorded fetch rejects', async ({ page, context }) => {
    const failedUrl = 'https://rejected-fetch.test/checkout'
    await page.route(failedUrl, (route) => route.abort('failed'))

    await start(
        {
            url: '/playground/cypress/index.html',
            options: { session_recording: { compress_events: false } },
            flagsResponseOverrides: {
                sessionRecording: {
                    endpoint: '/ses/',
                    networkPayloadCapture: { recordBody: true },
                },
                capturePerformance: true,
                autocapture_opt_out: true,
            },
        },
        page,
        context
    )
    await waitForSessionRecordingToStart(page)

    await page.evaluate(() => {
        const sessionReplayWrappedFetch = window.fetch
        ;(window as any).applicationFetchWrapperCalls = 0
        window.fetch = function applicationFetchWrapper(input, init) {
            ;(window as any).applicationFetchWrapperCalls++
            return sessionReplayWrappedFetch.call(window, input, init)
        }
    })

    const stack = await page.evaluate(async (url) => {
        async function submitOrderFromApplication() {
            return await window.fetch(url, { method: 'POST', body: 'order=123' })
        }

        try {
            await submitOrderFromApplication()
            return 'fetch unexpectedly resolved'
        } catch (error) {
            return error instanceof Error ? (error.stack ?? '') : String(error)
        }
    }, failedUrl)

    expect(await page.evaluate(() => (window as any).applicationFetchWrapperCalls)).toBe(1)
    expect(stack).toContain('submitOrderFromApplication')
})
