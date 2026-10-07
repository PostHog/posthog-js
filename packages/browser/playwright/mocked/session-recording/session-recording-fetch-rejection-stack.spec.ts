import { expect, test } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

test('preserves the application call site when a recorded fetch rejects', async ({ page, context, browserName }) => {
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
    // Failed requests do not produce Resource Timing entries, so allow the recorder's timing lookup
    // to exhaust before generating activity that flushes the resulting network event.
    await page.waitForTimeout(3000)
    await page.waitingForNetworkCausedBy({
        urlPatternsToWaitFor: ['**/ses/*'],
        action: () => page.locator('[data-cy-input]').fill('activity'),
    })
    await expect
        .poll(
            async () => {
                const snapshots = (await page.capturedEvents()).filter((event) => event.event === '$snapshot')
                const requests = snapshots
                    .flatMap((event) => event.properties.$snapshot_data)
                    .filter((event) => event.type === 6 && event.data.plugin === 'rrweb/network@1')
                    .flatMap((event) => event.data.payload.requests)
                return requests.find((request) => request.name === failedUrl)?.requestBody
            },
            { timeout: 10_000 }
        )
        .toBe('order=123')
    // Firefox and WebKit expose an empty stack for the same rejected native fetch without Replay installed.
    if (browserName === 'chromium') {
        expect(stack).toContain('submitOrderFromApplication')
    }
})
