import { expect, test } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

// the project turns network payload capture on, the client decides per test
const startOptions = (clientOptions: Record<string, any>) => ({
    url: '/playground/cypress/index.html',
    options: {
        ...clientOptions,
        session_recording: { compress_events: false, ...clientOptions.session_recording },
    },
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
            networkPayloadCapture: { recordBody: true, recordHeaders: true },
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
})

const snapshotEvents = async (page: any) =>
    (await page.capturedEvents())
        .filter((event: any) => event.event === '$snapshot')
        .flatMap((event: any) => event.properties.$snapshot_data)

const networkRequests = async (page: any) =>
    (await snapshotEvents(page))
        .filter((event: any) => event.type === 6 && event.data.plugin === 'rrweb/network@1')
        .flatMap((event: any) => event.data.payload.requests)

test.describe('session recording network capture when the project enables payload capture', () => {
    test('records network requests when the client does not decide', async ({ page, context }) => {
        await start(startOptions({}), page, context)
        await waitForSessionRecordingToStart(page)
        await page.locator('[data-cy-fetch-call-button]').click()

        await expect
            .poll(async () => (await networkRequests(page)).some((r: any) => r.name?.includes('example.com')), {
                timeout: 10000,
            })
            .toBe(true)
    })

    test('records no network requests when the client disables headers, body and timing', async ({ page, context }) => {
        await start(
            startOptions({
                session_recording: { recordHeaders: false, recordBody: false },
                capture_performance: false,
            }),
            page,
            context
        )
        await waitForSessionRecordingToStart(page)
        await page.locator('[data-cy-fetch-call-button]').click()
        await page.locator('[data-cy-input]').fill('activity')

        // wait for the input mutation, so a recorded fetch would have been flushed by then
        await expect
            .poll(
                async () =>
                    (await snapshotEvents(page)).some((event: any) => event.type === 3 && event.data.source === 5),
                { timeout: 10000 }
            )
            .toBe(true)

        expect(await networkRequests(page)).toEqual([])
    })
})
