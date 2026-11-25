import { test, expect } from '../utils/fetch-echo-server'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

test.use({ ignoreHTTPSErrors: true })

// BODY_READ_TIMEOUT_MS in network-plugin.ts
const BODY_READ_TIMEOUT_MS = 500

for (const earlyResponse of [false, true]) {
    for (const streamNetworkBody of [false, true]) {
        test(`streamed response timing and recorded body, early fetch response ${earlyResponse}, streamNetworkBody ${streamNetworkBody}`, async ({
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
                        session_recording: { compress_events: false, streamNetworkBody },
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
                    let text = ''
                    while (!text.includes('\n')) {
                        const chunk = await reader.read()
                        if (chunk.done) {
                            break
                        }
                        text += decoder.decode(chunk.value, { stream: true })
                    }
                    const firstLineMs = performance.now() - startedAt
                    const first = text
                    await fetch(releaseUrl, { method: 'POST' })
                    let rest = ''
                    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
                        rest += decoder.decode(chunk.value, { stream: true })
                    }
                    rest += decoder.decode()
                    return { first, rest, firstLineMs }
                },
                { url, releaseUrl: `${echoServer.url}/stream/release` }
            )

            expect(result.first).toBe('{"fast":1}\n')
            expect(result.rest).toBe('{"slow":2}\n')
            if (earlyResponse) {
                expect(result.firstLineMs).toBeLessThan(BODY_READ_TIMEOUT_MS)
            } else {
                // By default the wrapper holds the response until the body read gives up. Browser timers can fire early.
                expect(result.firstLineMs).toBeGreaterThanOrEqual(BODY_READ_TIMEOUT_MS - 25)
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
                .toEqual([
                    earlyResponse ? '{"fast":1}\n{"slow":2}\n' : '[SessionReplay] Timeout while trying to read body',
                ])
        })
    }
}
