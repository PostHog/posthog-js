import { BrowserContext, Page, Route } from '@playwright/test'
import { expect, test } from './utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from './utils/setup'

const POST_URL = '/__posthog_fetch_post_body_test'
const POST_BODY = 'some string'
const ORIGINAL_HEADER = 'original-header-value'

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
