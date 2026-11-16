import { test, expect, Upload } from '../utils/fetch-echo-server'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

// Applies only to the ephemeral localhost echo server's self-signed certificate.
test.use({ ignoreHTTPSErrors: true })

const wrappers = ['pass-through', 'headers', 'request', 'async'] as const
const bodyTypes = ['string', 'form-data', 'blob', 'array-buffer', 'url-search-params', 'request-input', 'stream']

async function decodeMultipart(body: Buffer | string, contentType: string) {
    const form = await new Response(typeof body === 'string' ? body : new Uint8Array(body), {
        headers: { 'Content-Type': contentType },
    }).formData()
    return Promise.all(
        Array.from(form.entries()).map(async ([name, value]) => [
            name,
            typeof value === 'string' ? value : { name: value.name, type: value.type, text: await value.text() },
        ])
    )
}

for (const syncFetch of [false, true]) {
    for (const wrapper of wrappers) {
        for (const order of ['before', 'after'] as const) {
            test(`real uploads with ${wrapper} wrapper installed ${order} Replay, sync fetch ${syncFetch}`, async ({
                page,
                context,
                echoServer,
                browserName,
            }) => {
                await page.addInitScript(
                    ({ wrapper, origin }) => {
                        const win = window as any
                        win.wrapperCalls = []
                        win.unhandledFetchErrors = []
                        // oxlint-disable-next-line posthog-js/no-add-event-listener
                        window.addEventListener('unhandledrejection', (event) =>
                            win.unhandledFetchErrors.push(String(event.reason))
                        )
                        const nativeFetch = window.fetch.bind(window)
                        const wrap =
                            (downstream: typeof fetch): typeof fetch =>
                            (input, init) => {
                                const url = input instanceof Request ? input.url : String(input)
                                if (!url.startsWith(origin)) return downstream(input, init)
                                win.wrapperCalls.push(url)
                                if (wrapper === 'request' || wrapper === 'headers') {
                                    const request = new Request(input, init)
                                    if (wrapper === 'headers') request.headers.set('x-test-wrapper', 'injected')
                                    return downstream(request)
                                }
                                if (wrapper === 'async') {
                                    // Deliberately yields before delegation and observes the response. Replay must not
                                    // worsen this wrapper's native behavior; it cannot repair its stack attribution.
                                    return Promise.resolve()
                                        .then(() => downstream(input, init))
                                        .then((response) => response)
                                }
                                return downstream(input, init)
                            }
                        win.controlFetch = wrap(nativeFetch)
                        win.installTestWrapper = () => {
                            window.fetch = wrap(window.fetch.bind(window))
                        }
                    },
                    { wrapper, origin: echoServer.url }
                )
                await start(
                    {
                        url: '/playground/cypress/index.html',
                        runBeforePostHogInit:
                            order === 'before'
                                ? (pg) => pg.evaluate(() => (window as any).installTestWrapper())
                                : undefined,
                        options: {
                            strict_script_versioning: false,
                            __preview_replay_sync_fetch: syncFetch,
                            session_recording: { compress_events: false },
                        },
                        flagsResponseOverrides: {
                            sessionRecording: {
                                endpoint: '/ses/',
                                networkPayloadCapture: { recordBody: true, recordHeaders: true },
                            },
                            autocapture_opt_out: true,
                        },
                    },
                    page,
                    context
                )
                await waitForSessionRecordingToStart(page)
                if (order === 'after') await page.evaluate(() => (window as any).installTestWrapper())

                const outcomes = await page.evaluate(
                    async ({ origin, bodyTypes }) => {
                        const outcomes: Record<
                            string,
                            Record<string, { status?: number; body?: string; error?: string }>
                        > = {}
                        for (const mode of ['control', 'replay']) {
                            outcomes[mode] = {}
                            const send: typeof fetch = mode === 'control' ? (window as any).controlFetch : window.fetch
                            for (const bodyType of bodyTypes) {
                                const url = `${origin}/${mode}/${bodyType}`
                                const encoder = new TextEncoder()
                                const init: RequestInit & { duplex?: string } = { method: 'POST' }
                                switch (bodyType) {
                                    case 'form-data': {
                                        const form = new FormData()
                                        form.append('field', 'form value')
                                        form.append(
                                            'attachment',
                                            new Blob(['file contents'], { type: 'text/plain' }),
                                            'example.txt'
                                        )
                                        init.body = form
                                        break
                                    }
                                    case 'blob':
                                        init.body = new Blob(['blob bytes'], { type: 'text/plain' })
                                        break
                                    case 'array-buffer':
                                        init.body = encoder.encode('buffer bytes').buffer
                                        init.headers = { 'Content-Type': 'text/plain' }
                                        break
                                    case 'url-search-params':
                                        init.body = new URLSearchParams({ field: 'url params' })
                                        break
                                    case 'stream':
                                        init.body = new ReadableStream({
                                            start(controller) {
                                                controller.enqueue(encoder.encode('stream bytes'))
                                                controller.close()
                                            },
                                        })
                                        init.duplex = 'half'
                                        init.headers = { 'Content-Type': 'text/plain' }
                                        break
                                    default:
                                        init.body = `${bodyType} bytes`
                                }
                                try {
                                    const response =
                                        bodyType === 'request-input'
                                            ? await send(new Request(url, init))
                                            : await send(url, init)
                                    outcomes[mode][bodyType] = { status: response.status, body: await response.text() }
                                } catch (error) {
                                    outcomes[mode][bodyType] = { error: (error as Error).name }
                                }
                            }
                        }
                        return outcomes
                    },
                    { origin: echoServer.url, bodyTypes }
                )

                expect(outcomes.replay).toEqual(outcomes.control)
                const successfulTypes = bodyTypes.filter((type) => !outcomes.control[type].error)
                // Only streaming uploads may be unsupported natively. Do not let a broken test server
                // pass merely because both control and Replay requests failed.
                for (const type of bodyTypes.filter((type) => type !== 'stream' || browserName === 'chromium')) {
                    expect(outcomes.control[type]).toEqual({ status: 200, body: 'echo response' })
                }
                const expectedText: Record<string, string> = {
                    string: 'string bytes',
                    blob: 'blob bytes',
                    'array-buffer': 'buffer bytes',
                    'url-search-params': 'field=url+params',
                    'request-input': 'request-input bytes',
                    stream: browserName === 'firefox' ? '[object ReadableStream]' : 'stream bytes',
                }
                const expectedForm = [
                    ['field', 'form value'],
                    ['attachment', { name: 'example.txt', type: 'text/plain', text: 'file contents' }],
                ]
                for (const mode of ['control', 'replay']) {
                    expect(echoServer.uploads.filter((upload) => upload.path.startsWith(`/${mode}/`))).toHaveLength(
                        successfulTypes.length
                    )
                    for (const type of successfulTypes) {
                        const uploads = echoServer.uploads.filter((upload) => upload.path === `/${mode}/${type}`)
                        expect(uploads).toHaveLength(1)
                        const upload: Upload = uploads[0]
                        expect(upload.method).toBe('POST')
                        expect(upload.headers['x-test-wrapper']).toBe(wrapper === 'headers' ? 'injected' : undefined)
                        if (type === 'form-data') {
                            expect(await decodeMultipart(upload.body, upload.headers['content-type'])).toEqual(
                                expectedForm
                            )
                        } else {
                            expect(upload.body.toString()).toBe(expectedText[type])
                        }
                    }
                }
                const calls = await page.evaluate(() => (window as any).wrapperCalls as string[])
                for (const mode of ['control', 'replay']) {
                    for (const type of bodyTypes)
                        expect(calls.filter((url) => url === `${echoServer.url}/${mode}/${type}`)).toHaveLength(1)
                }

                let attempt = 0
                await expect
                    .poll(
                        async () => {
                            await page.locator('[data-cy-input]').fill(`flush-${attempt++}`)
                            const recorded = (await page.capturedEvents())
                                .filter((event) => event.event === '$snapshot')
                                .flatMap((event) => event.properties.$snapshot_data)
                                .filter((event) => event.type === 6 && event.data.plugin === 'rrweb/network@1')
                                .flatMap((event) => event.data.payload.requests)
                            return recorded.filter((request) =>
                                successfulTypes.some((type) => request.name === `${echoServer.url}/replay/${type}`)
                            )
                        },
                        { timeout: 15_000 }
                    )
                    .toHaveLength(successfulTypes.length)

                const recorded = (await page.capturedEvents())
                    .filter((event) => event.event === '$snapshot')
                    .flatMap((event) => event.properties.$snapshot_data)
                    .filter((event) => event.type === 6 && event.data.plugin === 'rrweb/network@1')
                    .flatMap((event) => event.data.payload.requests)
                for (const type of successfulTypes) {
                    const request = recorded.find((request) => request.name === `${echoServer.url}/replay/${type}`)!
                    expect(request.responseBody).toBe('echo response')
                    if (type === 'form-data') {
                        expect(
                            await decodeMultipart(request.requestBody, request.requestHeaders['content-type'])
                        ).toEqual(expectedForm)
                    } else if (
                        type === 'stream' &&
                        !(order === 'after' && (wrapper === 'request' || wrapper === 'headers'))
                    ) {
                        // Replay deliberately does not read a caller-supplied init.body stream. An outer
                        // Request-building wrapper instead passes a Request, which Replay can clone.
                        expect(request.requestBody).toBeUndefined()
                    } else {
                        expect(request.requestBody).toBe(expectedText[type])
                    }
                }
                expect(await page.evaluate(() => (window as any).unhandledFetchErrors)).toEqual([])
            })
        }
    }
}
