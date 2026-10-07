import { BrowserContext, Page, Route } from '@playwright/test'
import { expect, test } from './utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from './utils/setup'

const POST_URL = '/__posthog_fetch_post_body_test'
const POST_BODY = 'some string'
const ORIGINAL_HEADER = 'original-header-value'
const HEADERLESS_RESPONSE_URL = '/__posthog_headerless_response_test'
const BODY_MATRIX_URL = '/__posthog_replay_fetch_body_test'

async function mockPostEndpoint(context: BrowserContext) {
    let capturedRequest: { headers: Record<string, string>; body: string | null } | undefined

    await context.route(`**${POST_URL}`, async (route: Route) => {
        capturedRequest = {
            headers: route.request().headers(),
            body: route.request().postData(),
        }
        await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
    })

    return () => capturedRequest
}

async function postStringBody(page: Page) {
    return page.evaluate(
        async ({
            postUrl,
            postBody,
            originalHeader,
        }: {
            postUrl: string
            postBody: string
            originalHeader: string
        }) => {
            try {
                const response = await fetch(postUrl, {
                    method: 'POST',
                    body: postBody,
                    headers: { 'x-original-header': originalHeader },
                })
                return {
                    ok: true,
                    status: response.status,
                    text: await response.text(),
                    shape: (window as any).__fetchShape,
                }
            } catch (e) {
                return {
                    ok: false,
                    name: (e as Error).name,
                    message: (e as Error).message,
                    shape: (window as any).__fetchShape,
                }
            }
        },
        { postUrl: POST_URL, postBody: POST_BODY, originalHeader: ORIGINAL_HEADER }
    )
}

async function installRequestBodyForwardingFetchWrapper(page: Page) {
    await page.addInitScript(() => {
        const nativeFetch = window.fetch

        window.fetch = (url, init) => {
            ;(window as any).__fetchShape = {
                isRequest: url instanceof Request,
                hasInit: init !== undefined,
                bodyType: url instanceof Request ? Object.prototype.toString.call(url.body) : undefined,
            }

            // This mimics fetch wrappers/interceptors that rebuild init from a Request.
            // If PostHog passes a newly-created Request downstream, this forwards request.body
            // as a ReadableStream and WebKit throws "ReadableStream uploading is not supported".
            if (url instanceof Request) {
                return nativeFetch(url, { ...init, body: url.body })
            }

            return nativeFetch(url, init)
        }
    })
}

async function installRequestForwardingFetchWrapper(page: Page) {
    await page.addInitScript((bodyMatrixUrl) => {
        const nativeFetch = window.fetch
        ;(window as any).__forwardedRequestBodies = {}
        ;(window as any).__requestForwardingWrapperInputs = []

        window.fetch = function (this: Window, input: RequestInfo | URL, init?: RequestInit) {
            const inputUrl = input instanceof Request ? input.url : String(input)
            const path = new URL(inputUrl, window.location.href).pathname
            if (path.startsWith(`${bodyMatrixUrl}/`)) {
                const bodyType = path.slice(bodyMatrixUrl.length + 1)
                const forwardedRequest = new Request(input, init)
                ;(window as any).__requestForwardingWrapperInputs.push({
                    bodyType,
                    receivedRequest: input instanceof Request,
                })
                ;(window as any).__forwardedRequestBodies[bodyType] = forwardedRequest.clone().text()
                return nativeFetch.call(this, forwardedRequest)
            }
            return nativeFetch.call(this, input, init)
        }
    }, BODY_MATRIX_URL)
}

async function installHeaderlessResponseFetchWrapper(page: Page) {
    await page.addInitScript((headerlessResponseUrl) => {
        const nativeFetch = window.fetch

        window.fetch = (url, init) => {
            const requestUrl = url instanceof Request ? url.url : url.toString()
            if (new URL(requestUrl, window.location.href).pathname === headerlessResponseUrl) {
                const responseWithoutHeaders = Response.error()
                Object.defineProperty(responseWithoutHeaders, 'headers', { value: undefined })
                Reflect.set(window, '__headerlessResponse', responseWithoutHeaders)
                return Promise.resolve(responseWithoutHeaders)
            }
            return nativeFetch(url, init)
        }
    }, HEADERLESS_RESPONSE_URL)
}

// Older Safari/WebKit versions can throw `NotSupportedError: ReadableStream uploading is not supported`
// when a wrapper turns a string body POST into a Request/ReadableStream upload.
test.describe('fetch wrappers preserve POST string bodies', () => {
    test('does not expose a POST string body as a Request ReadableStream when tracing headers are enabled', async ({
        page,
        context,
    }) => {
        const getCapturedRequest = await mockPostEndpoint(context)
        await installRequestBodyForwardingFetchWrapper(page)

        await start(
            {
                options: { tracing_headers: ['localhost'] },
                url: '/playground/cypress/index.html',
            },
            page,
            context
        )

        const result = await postStringBody(page)

        expect(result).toEqual({
            ok: true,
            status: 200,
            text: 'ok',
            shape: expect.objectContaining({ isRequest: false, hasInit: true }),
        })
        expect(getCapturedRequest()).toMatchObject({
            body: POST_BODY,
            headers: expect.objectContaining({
                'x-original-header': ORIGINAL_HEADER,
                'x-posthog-distinct-id': expect.any(String),
                'x-posthog-session-id': expect.any(String),
                'x-posthog-window-id': expect.any(String),
            }),
        })
    })

    test('does not expose a POST string body as a Request ReadableStream when recording request bodies', async ({
        page,
        context,
    }) => {
        const getCapturedRequest = await mockPostEndpoint(context)
        await installRequestBodyForwardingFetchWrapper(page)

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(
                    {
                        options: {
                            session_recording: {
                                compress_events: true,
                                recordBody: true,
                            },
                        },
                        flagsResponseOverrides: {
                            sessionRecording: { endpoint: '/ses/' },
                            capturePerformance: true,
                            autocapture_opt_out: true,
                        },
                        url: '/playground/cypress/index.html',
                    },
                    page,
                    context
                )
            },
        })
        await waitForSessionRecordingToStart(page)

        await expect(page.evaluate(() => (window.fetch as any).__posthog_wrapped__)).resolves.toBe(true)

        const result = await postStringBody(page)

        expect(result).toEqual({
            ok: true,
            status: 200,
            text: 'ok',
            shape: expect.objectContaining({ isRequest: false, hasInit: true }),
        })
        expect(getCapturedRequest()).toMatchObject({
            body: POST_BODY,
            headers: expect.objectContaining({ 'x-original-header': ORIGINAL_HEADER }),
        })
    })
})

test.describe('fetch wrappers preserve every request body type', () => {
    test('forwards bodies through another Request-building wrapper without changing caller arguments', async ({
        page,
        context,
        browserName,
    }) => {
        const uploads: Array<{ bodyType: string; method: string; contentType: string; body: string }> = []
        await context.route(`**${BODY_MATRIX_URL}/**`, async (route: Route) => {
            const request = route.request()
            uploads.push({
                bodyType: new URL(request.url()).pathname.split('/').pop()!,
                method: request.method(),
                contentType: request.headers()['content-type'] || '',
                body: request.postDataBuffer()?.toString('utf8') || '',
            })
            await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
        })
        await installRequestForwardingFetchWrapper(page)

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(
                    {
                        options: { session_recording: { compress_events: false } },
                        flagsResponseOverrides: {
                            sessionRecording: {
                                endpoint: '/ses/',
                                networkPayloadCapture: { recordBody: true },
                            },
                            capturePerformance: true,
                            autocapture_opt_out: true,
                        },
                        url: '/playground/cypress/index.html',
                    },
                    page,
                    context
                )
            },
        })
        await waitForSessionRecordingToStart(page)

        const responses = await page.evaluate(async (bodyMatrixUrl) => {
            const encoder = new TextEncoder()
            const formData = new FormData()
            formData.set('field', 'form body')
            const requests: Array<{ bodyType: string; init: RequestInit }> = [
                { bodyType: 'string', init: { method: 'POST', body: 'string body' } },
                { bodyType: 'form-data', init: { method: 'POST', body: formData } },
                { bodyType: 'blob', init: { method: 'POST', body: new Blob(['blob body'], { type: 'text/plain' }) } },
                { bodyType: 'array-buffer', init: { method: 'POST', body: encoder.encode('array buffer').buffer } },
                {
                    bodyType: 'url-search-params',
                    init: { method: 'POST', body: new URLSearchParams('field=url params') },
                },
            ]
            // WebKit does not support ReadableStream request bodies. Chromium streams the bytes while
            // Firefox currently stringifies the stream; both native behaviours must survive wrapping.
            if (navigator.userAgent.includes('Chrome') || navigator.userAgent.includes('Firefox')) {
                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode('stream body'))
                        controller.close()
                    },
                })
                requests.push({
                    bodyType: 'readable-stream',
                    init: { method: 'POST', body: stream, duplex: 'half' } as RequestInit,
                })
            }

            return Promise.all(
                requests.map(async ({ bodyType, init }) => {
                    const response = await fetch(`${bodyMatrixUrl}/${bodyType}`, init)
                    return { bodyType, status: response.status, body: await response.text() }
                })
            )
        }, BODY_MATRIX_URL)

        const expectedBodyTypes = [
            'string',
            'form-data',
            'blob',
            'array-buffer',
            'url-search-params',
            ...(browserName === 'webkit' ? [] : ['readable-stream']),
        ]
        expect(responses).toEqual(expectedBodyTypes.map((bodyType) => ({ bodyType, status: 200, body: 'ok' })))
        expect(uploads.map(({ bodyType }) => bodyType).sort()).toEqual([...expectedBodyTypes].sort())
        expect(uploads.every(({ method }) => method === 'POST')).toBe(true)

        const wrapperInputs = await page.evaluate(() => (window as any).__requestForwardingWrapperInputs)
        expect(wrapperInputs).toEqual(expectedBodyTypes.map((bodyType) => ({ bodyType, receivedRequest: false })))
        const forwardedBodies = await page.evaluate(async () => {
            const bodies = (window as any).__forwardedRequestBodies as Record<string, Promise<string>>
            return Object.fromEntries(
                await Promise.all(Object.entries(bodies).map(async ([bodyType, body]) => [bodyType, await body]))
            )
        })
        expect(forwardedBodies).toMatchObject({
            string: 'string body',
            blob: 'blob body',
            'array-buffer': 'array buffer',
            'url-search-params': 'field=url+params',
            ...(browserName === 'webkit'
                ? {}
                : { 'readable-stream': browserName === 'firefox' ? '[object ReadableStream]' : 'stream body' }),
        })

        const expectedUploadBodies: Record<string, string> = {
            string: 'string body',
            blob: 'blob body',
            'array-buffer': 'array buffer',
            'url-search-params': 'field=url+params',
        }
        for (const upload of uploads) {
            // Playwright protocol metadata omits streamed upload bytes and WebKit Blob bytes. The cloned
            // Request assertions above verify those bodies at the last wrapper before native fetch.
            if (
                upload.bodyType !== 'form-data' &&
                upload.bodyType !== 'readable-stream' &&
                !(browserName === 'webkit' && upload.bodyType === 'blob')
            ) {
                expect(upload.body).toBe(expectedUploadBodies[upload.bodyType])
            }
        }

        const formDataUpload = uploads.find(({ bodyType }) => bodyType === 'form-data')!
        expect(formDataUpload.contentType).toMatch(/^multipart\/form-data; boundary=/)
        const decodedFormData = await new Response(formDataUpload.body, {
            headers: { 'content-type': formDataUpload.contentType },
        }).formData()
        expect(Array.from(decodedFormData.entries())).toEqual([['field', 'form body']])
    })
})

test.describe('fetch wrappers preserve downstream responses', () => {
    test('returns a response-like value without headers', async ({ page, context }) => {
        await installHeaderlessResponseFetchWrapper(page)

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(
                    {
                        options: {
                            session_recording: {
                                compress_events: true,
                                recordHeaders: true,
                            },
                        },
                        flagsResponseOverrides: {
                            sessionRecording: { endpoint: '/ses/' },
                            capturePerformance: true,
                            autocapture_opt_out: true,
                        },
                        url: '/playground/cypress/index.html',
                    },
                    page,
                    context
                )
            },
        })
        await waitForSessionRecordingToStart(page)

        const result = await page.evaluate(async (url) => {
            try {
                const response = await fetch(url)
                return {
                    ok: true,
                    status: response.status,
                    sameResponse: response === Reflect.get(window, '__headerlessResponse'),
                }
            } catch (error) {
                return { ok: false, message: (error as Error).message }
            }
        }, HEADERLESS_RESPONSE_URL)

        expect(result).toEqual({ ok: true, status: 0, sameResponse: true })
    })
})
