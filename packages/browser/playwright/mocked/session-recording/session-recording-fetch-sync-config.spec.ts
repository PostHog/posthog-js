import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

for (const syncFetch of [undefined, false, true]) {
    test(`fetch delegation follows the private init option: ${String(syncFetch)}`, async ({
        page,
        context,
    }, testInfo) => {
        const url = 'https://fetch-sync-config.test/request'
        await page.route(url, (route) => route.fulfill({ contentType: 'text/plain', body: 'application response' }))
        await start(
            {
                url: '/playground/cypress/index.html',
                options: {
                    strict_script_versioning: false,
                    session_recording: { compress_events: false },
                    ...(syncFetch === undefined ? {} : { __preview_replay_sync_fetch: syncFetch }),
                },
                flagsResponseOverrides: {
                    sessionRecording: { endpoint: '/ses/', networkPayloadCapture: { recordBody: true } },
                    autocapture_opt_out: true,
                },
                runBeforePostHogInit: (pg) =>
                    pg.evaluate((url) => {
                        const win = window as any
                        const downstream = window.fetch.bind(window)
                        win.delegations = []
                        window.fetch = (input, init) => {
                            if ((input instanceof Request ? input.url : String(input)) === url) {
                                win.delegations.push(win.applicationStackActive)
                            }
                            return downstream(input, init)
                        }
                    }, url),
            },
            page,
            context
        )
        await waitForSessionRecordingToStart(page)
        expect(
            await page.evaluate(
                () => (window as WindowWithPostHog).posthog!.config.__preview_replay_sync_fetch === true
            )
        ).toBe(syncFetch === true)
        if (testInfo.project.name === 'chromium-legacy-replay-fetch') {
            expect(await page.evaluate(() => (window as WindowWithPostHog).posthog!.version)).toBe('1.360.0')
        }

        expect(
            await page.evaluate(async (url) => {
                const win = window as any
                win.applicationStackActive = true
                const pending = fetch(url, { method: 'POST', body: 'request bytes' })
                win.applicationStackActive = false
                return (await pending).text()
            }, url)
        ).toBe('application response')
        // A previously published recorder ignores the private option and retains legacy ordering.
        const legacyRecorder = testInfo.project.name === 'chromium-legacy-replay-recorder'
        expect(await page.evaluate(() => (window as any).delegations)).toEqual([syncFetch === true && !legacyRecorder])

        let attempt = 0
        await expect
            .poll(
                async () => {
                    await page.locator('[data-cy-input]').fill(`flush-${attempt++}`)
                    return (await page.capturedEvents())
                        .filter((event) => event.event === '$snapshot')
                        .flatMap((event) => event.properties.$snapshot_data)
                        .filter((event) => event.type === 6 && event.data.plugin === 'rrweb/network@1')
                        .flatMap((event) => event.data.payload.requests)
                        .filter((request) => request.name === url)
                        .map((request) => ({ requestBody: request.requestBody, responseBody: request.responseBody }))
                },
                { timeout: 15_000 }
            )
            .toEqual([{ requestBody: 'request bytes', responseBody: 'application response' }])
    })
}
