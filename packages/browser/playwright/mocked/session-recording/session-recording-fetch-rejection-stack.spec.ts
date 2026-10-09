import { expect, test } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

for (const syncFetch of [false, true]) {
    test(`uses opt-in application stack attribution when a recorded fetch rejects, sync fetch ${syncFetch}`, async ({
        page,
        context,
        browserName,
    }) => {
        const failedUrl = 'https://rejected-fetch.test/checkout'
        await page.route(failedUrl, (route) => route.abort('failed'))

        await start(
            {
                url: '/playground/cypress/index.html',
                options: { __preview_replay_sync_fetch: syncFetch, session_recording: { compress_events: false } },
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
        let flushAttempt = 0
        await expect
            .poll(
                async () => {
                    // Failed requests do not produce Resource Timing entries. Keep generating activity so the
                    // network event is flushed as soon as the recorder's timing lookup finishes.
                    await page.locator('[data-cy-input]').fill(`activity-${flushAttempt++}`)
                    const snapshots = (await page.capturedEvents()).filter((event) => event.event === '$snapshot')
                    const requests = snapshots
                        .flatMap((event) => event.properties.$snapshot_data)
                        .filter((event) => event.type === 6 && event.data.plugin === 'rrweb/network@1')
                        .flatMap((event) => event.data.payload.requests)
                    return requests.find((request) => request.name === failedUrl)?.requestBody
                },
                { timeout: 10_000, intervals: [250, 500, 1_000] }
            )
            .toBe('order=123')
        // Firefox and WebKit expose an empty stack for the same rejected native fetch without Replay installed.
        // Without explicit opt-in, even a newly built core and recorder retain the legacy ordering.
        if (browserName === 'chromium') {
            expect(stack.includes('submitOrderFromApplication')).toBe(syncFetch)
        }
    })
}
