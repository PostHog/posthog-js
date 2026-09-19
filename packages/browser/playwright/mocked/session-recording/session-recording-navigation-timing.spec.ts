import { expect, test } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

// the recorder loads lazily, so it always starts after the document has loaded.
// the document navigation timing is complete by then, and a performance observer
// never replays a completed entry, so the recorder has to read the entry itself
test('captures the document navigation timing when recording starts after page load', async ({ page, context }) => {
    await start(
        {
            url: '/playground/cypress/index.html',
            options: { session_recording: { compress_events: false } },
            flagsResponseOverrides: {
                sessionRecording: {
                    endpoint: '/ses/',
                    networkPayloadCapture: { recordBody: true, recordHeaders: true },
                },
                capturePerformance: false,
                autocapture_opt_out: true,
            },
        },
        page,
        context
    )
    await waitForSessionRecordingToStart(page)
    await page.locator('[data-cy-input]').fill('activity')

    await expect
        .poll(
            async () =>
                (await page.capturedEvents())
                    .filter((event) => event.event === '$snapshot')
                    .flatMap((event) => event.properties.$snapshot_data)
                    .filter((event) => event.type === 6 && event.data.plugin === 'rrweb/network@1')
                    .flatMap((event) => event.data.payload.requests)
                    .filter((request) => request.entryType === 'navigation').length,
            { timeout: 10000 }
        )
        .toBeGreaterThan(0)
})
