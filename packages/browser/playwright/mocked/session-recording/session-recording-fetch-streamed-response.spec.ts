import { test, expect } from '../utils/fetch-echo-server'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

test.use({ ignoreHTTPSErrors: true })

// BODY_READ_TIMEOUT_MS in network-plugin.ts
const BODY_READ_TIMEOUT_MS = 500

for (const earlyResponse of [false, true]) {
    test(`streamed response timing and recorded body, early fetch response ${earlyResponse}`, async ({
        page,
        context,
        echoServer,
    }) => {
        const url = `${echoServer.url}/stream/open`
        await start(
            {
                url: '/playground/cypress/index.html',
                options: {
                    strict_script_versioning: false,
                    __preview_replay_early_fetch_response: earlyResponse,
                    session_recording: { compress_events: false },
                },
                flagsResponseOverrides: {
                    sessionRecording: { endpoint: '/ses/', networkPayloadCapture: { recordBody: true } },
                    autocapture_opt_out: true,
                },
            },
            page,
            context
        )
        await waitForSessionRecordingToStart(page)

        const result = await page.evaluate(
            async ({ url, releaseUrl }) => {
                const decoder = new TextDecoder()
                const startedAt = performance.now()
                const response = await fetch(url)
                const reader = response.body!.getReader()
                const first = decoder.decode((await reader.read()).value)
                const firstLineMs = performance.now() - startedAt
                await fetch(releaseUrl, { method: 'POST' })
                let rest = ''
                for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
                    rest += decoder.decode(chunk.value)
                }
                return { first, rest, firstLineMs }
            },
            { url, releaseUrl: `${echoServer.url}/stream/release` }
        )

        expect(result.first).toBe('{"fast":1}\n')
        expect(result.rest).toBe('{"slow":2}\n')
        if (earlyResponse) {
            expect(result.firstLineMs).toBeLessThan(BODY_READ_TIMEOUT_MS)
        } else {
            // By default the wrapper holds the response until the body read gives up.
            expect(result.firstLineMs).toBeGreaterThanOrEqual(BODY_READ_TIMEOUT_MS)
        }

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
                        .map((request) => request.responseBody)
                },
                { timeout: 15_000 }
            )
            .toEqual([earlyResponse ? '{"fast":1}\n{"slow":2}\n' : '[SessionReplay] Timeout while trying to read body'])
    })
}
