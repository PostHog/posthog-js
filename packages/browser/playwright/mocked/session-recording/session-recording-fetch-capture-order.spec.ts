import { test, expect } from '../utils/fetch-echo-server'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

test.use({ ignoreHTTPSErrors: true })

for (const streamNetworkBody of [false, true]) {
    for (const failure of ['reject', 'throw', 'abort'] as const) {
        test(`preserves ${failure} during pending request capture, streaming ${streamNetworkBody}`, async ({
            page,
            context,
            echoServer,
        }) => {
            const url = `${echoServer.url}/timing/${failure}`
            await start(
                {
                    url: '/playground/cypress/index.html',
                    options: {
                        strict_script_versioning: false,
                        session_recording: { compress_events: false, streamNetworkBody },
                    },
                    flagsResponseOverrides: {
                        sessionRecording: { endpoint: '/ses/', networkPayloadCapture: { recordBody: true } },
                        autocapture_opt_out: true,
                    },
                    runBeforePostHogInit: (pg) =>
                        pg.evaluate(
                            ({ url, failure }) => {
                                const win = window as any
                                const nativeFetch = window.fetch.bind(window)
                                win.downstreamCalls = 0
                                win.sentinelError = new TypeError('downstream wrapper failure')
                                win.unhandledFetchErrors = []
                                // oxlint-disable-next-line posthog-js/no-add-event-listener
                                window.addEventListener('unhandledrejection', (event) =>
                                    win.unhandledFetchErrors.push(String(event.reason))
                                )
                                window.fetch = (input, init) => {
                                    if ((input instanceof Request ? input.url : String(input)) !== url)
                                        return nativeFetch(input, init)
                                    win.downstreamCalls++
                                    if (failure === 'abort') return nativeFetch(input, init)
                                    // Consume the forwarded Request immediately, as native fetch or an interceptor would.
                                    win.downstreamBody = new Request(input, init).text()
                                    if (failure === 'throw') throw win.sentinelError
                                    return Promise.reject(win.sentinelError)
                                }
                            },
                            { url, failure }
                        ),
                },
                page,
                context
            )
            await waitForSessionRecordingToStart(page)

            const result = await page.evaluate(
                async ({ url, failure }) => {
                    const win = window as any
                    const originalClone = Request.prototype.clone
                    let release!: () => void
                    const gate = new Promise<void>((resolve) => {
                        release = resolve
                    })
                    let captureStarted = false
                    Request.prototype.clone = function () {
                        const clone = originalClone.call(this)
                        if (this.url === url) {
                            const text = clone.text.bind(clone)
                            clone.text = () => {
                                captureStarted = true
                                return gate.then(text)
                            }
                            // Firefox does not expose Request.body; Replay falls back to clone.text().
                            if (clone.body) {
                                const getReader = clone.body.getReader.bind(clone.body)
                                clone.body.getReader = (() => {
                                    const reader = getReader()
                                    const read = reader.read.bind(reader)
                                    reader.read = () => {
                                        captureStarted = true
                                        return gate.then(read)
                                    }
                                    return reader
                                }) as typeof getReader
                            }
                        }
                        return clone
                    }
                    try {
                        const controller = new AbortController()
                        const request = new Request(url, {
                            method: 'POST',
                            body: 'pending request body',
                            signal: controller.signal,
                        })
                        let settled = false
                        const pending = fetch(request)
                            .then(
                                () => ({ name: 'unexpected success', sameError: false }),
                                (error) => ({ name: error.name, sameError: error === win.sentinelError })
                            )
                            .then((result) => {
                                settled = true
                                return result
                            })
                        const delegatedSynchronously = win.downstreamCalls === 1
                        const captureStartedSynchronously = captureStarted
                        if (failure === 'abort') controller.abort()
                        // Cross task boundaries while capture is blocked so an unobserved rejection would
                        // reach unhandledrejection. No arbitrary sleep to wait for capture or network I/O.
                        await new Promise((resolve) => setTimeout(resolve, 0))
                        await new Promise((resolve) => setTimeout(resolve, 0))
                        const pendingBeforeRelease = !settled
                        const errorsBeforeRelease = [...win.unhandledFetchErrors]
                        release()
                        const outcome = await pending
                        await new Promise((resolve) => setTimeout(resolve, 0))
                        return {
                            outcome,
                            delegatedSynchronously,
                            captureStartedSynchronously,
                            pendingBeforeRelease,
                            errorsBeforeRelease,
                            errorsAfterRelease: win.unhandledFetchErrors,
                            downstreamCalls: win.downstreamCalls,
                            downstreamBody: failure === 'abort' ? null : await win.downstreamBody,
                        }
                    } finally {
                        release()
                        Request.prototype.clone = originalClone
                    }
                },
                { url, failure }
            )
            expect(result).toEqual({
                outcome: { name: failure === 'abort' ? 'AbortError' : 'TypeError', sameError: failure !== 'abort' },
                delegatedSynchronously: true,
                captureStartedSynchronously: true,
                pendingBeforeRelease: true,
                errorsBeforeRelease: [],
                errorsAfterRelease: [],
                downstreamCalls: 1,
                downstreamBody: failure === 'abort' ? null : 'pending request body',
            })
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
                            .map((request) => request.requestBody)
                    },
                    { timeout: 15_000 }
                )
                .toEqual(['pending request body'])
            expect(echoServer.uploads.length).toBeLessThanOrEqual(failure === 'abort' ? 1 : 0)
        })
    }

    test(`preserves abort after streaming upload bytes reach the server, streaming capture ${streamNetworkBody}`, async ({
        page,
        context,
        echoServer,
        browserName,
    }) => {
        test.skip(
            browserName !== 'chromium',
            'Only Chromium supports native streaming request uploads in these browser projects'
        )
        await start(
            {
                url: '/playground/cypress/index.html',
                options: {
                    strict_script_versioning: false,
                    session_recording: { compress_events: false, streamNetworkBody },
                },
                flagsResponseOverrides: {
                    sessionRecording: { endpoint: '/ses/', networkPayloadCapture: { recordBody: true } },
                },
                runBeforePostHogInit: (pg) =>
                    pg.evaluate(() => {
                        const win = window as any
                        win.controlFetch = window.fetch.bind(window)
                        win.unhandledFetchErrors = []
                        // oxlint-disable-next-line posthog-js/no-add-event-listener
                        window.addEventListener('unhandledrejection', (event) =>
                            win.unhandledFetchErrors.push(String(event.reason))
                        )
                    }),
            },
            page,
            context
        )
        await waitForSessionRecordingToStart(page)
        for (const mode of ['control', 'replay']) {
            const path = `/upload-abort/${mode}`
            await page.evaluate(
                ({ url, mode }) => {
                    const win = window as any
                    const controller = new AbortController()
                    const body = new ReadableStream({
                        start(stream) {
                            stream.enqueue(new TextEncoder().encode('partial upload'))
                            // Leave the upload open until AbortController terminates it.
                        },
                    })
                    const request = new Request(url, {
                        method: 'POST',
                        body,
                        duplex: 'half',
                        signal: controller.signal,
                    } as RequestInit)
                    const send: typeof fetch = mode === 'control' ? win.controlFetch : window.fetch
                    win.uploadResult = send(request).then(
                        () => 'unexpected success',
                        (error) => error.name
                    )
                    win.abortUpload = () => controller.abort()
                },
                { url: `${echoServer.url}${path}`, mode }
            )
            try {
                // Proves this abort happens during a real upload, not before dispatch or after a mock response.
                await expect.poll(() => echoServer.receivedBytes.get(path)).toBe(Buffer.byteLength('partial upload'))
            } finally {
                await page.evaluate(() => (window as any).abortUpload())
            }
            expect(await page.evaluate(() => (window as any).uploadResult)).toBe('AbortError')
        }
        expect(
            await page.evaluate(async () => {
                await new Promise((resolve) => setTimeout(resolve, 0))
                return (window as any).unhandledFetchErrors
            })
        ).toEqual([])
    })
}
