import { BrowserContext, Route } from '@playwright/test'
import { OtlpHistogramDataPoint, OtlpMetricsPayload } from '@posthog/types'
import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

const CUSTOMER_URL = '/__network_metrics_test/orders/12345'

function captureMetricsPayloads(context: BrowserContext) {
    const payloads: OtlpMetricsPayload[] = []
    void context.route('**/i/v1/metrics*', async (route: Route) => {
        payloads.push(route.request().postDataJSON())
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    return payloads
}

const attributesOf = (dataPoint: OtlpHistogramDataPoint): Record<string, string | number | undefined> =>
    Object.fromEntries(dataPoint.attributes.map((a) => [a.key, a.value.stringValue ?? a.value.intValue]))

test.describe('network metrics', () => {
    test('records customer fetch and XHR durations without changing them, and skips its own requests', async ({
        page,
        context,
    }) => {
        await context.route(`**${CUSTOMER_URL}`, (route) =>
            route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
        )
        const metricsPayloads = captureMetricsPayloads(context)

        await start(
            {
                options: { metrics: { network: true }, disable_compression: true },
                url: '/playground/cypress/index.html',
            },
            page,
            context
        )

        const responses = await page.evaluate(async (url) => {
            const fetchResponse = await fetch(url)
            const fetchResult = { status: fetchResponse.status, text: await fetchResponse.text() }

            const xhrResult = await new Promise<{ status: number; text: string }>((resolve) => {
                const xhr = new XMLHttpRequest()
                xhr.onloadend = () => resolve({ status: xhr.status, text: xhr.responseText })
                xhr.open('GET', url)
                xhr.send()
            })

            const otherLoadEndListenersHaveRun = new Promise((resolve) => setTimeout(resolve, 0))
            await otherLoadEndListenersHaveRun
            await (window as any).posthog.metrics.flush()
            return { fetchResult, xhrResult }
        }, CUSTOMER_URL)

        expect(responses).toEqual({
            fetchResult: { status: 200, text: 'ok' },
            xhrResult: { status: 200, text: 'ok' },
        })

        await expect.poll(() => metricsPayloads.length).toBe(1)
        const metrics = metricsPayloads[0].resourceMetrics.flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics))
        const durations = metrics.filter((m) => m.name === 'http.client.request.duration')
        expect(durations).toHaveLength(1)

        const dataPoints = durations[0].histogram!.dataPoints
        expect(dataPoints.map((dp) => ({ count: dp.count, ...attributesOf(dp) }))).toEqual([
            {
                count: 2,
                'http.request.method': 'GET',
                'server.address': 'localhost',
                'server.port': expect.stringMatching(/^\d+$/),
                'url.scheme': 'http',
                'url.template': '/__network_metrics_test/orders/:id',
                'http.response.status_code': '200',
            },
        ])
    })

    test('preserves every supported fetch body through a downstream Request-forwarding wrapper', async ({
        page,
        context,
        browserName,
    }) => {
        const uploads: Array<{ path: string; method: string; contentType: string; body: string }> = []
        await context.route('**/__network_metrics_test/body/**', async (route: Route) => {
            const request = route.request()
            uploads.push({
                path: new URL(request.url()).pathname.split('/').pop()!,
                method: request.method(),
                contentType: request.headers()['content-type'] || '',
                body: request.postDataBuffer()?.toString('utf8') || '',
            })
            await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
        })

        await start(
            {
                options: { metrics: { network: true }, disable_compression: true },
                url: '/playground/cypress/index.html',
                runBeforePostHogInit: async (pg) => {
                    await pg.evaluate((checkStreamInput) => {
                        if (checkStreamInput) {
                            const body = new ReadableStream({
                                start(controller) {
                                    controller.enqueue(new TextEncoder().encode('stream body'))
                                    controller.close()
                                },
                            })
                            ;(window as any).__auditNativeStreamControl = new Request(location.href, {
                                method: 'POST',
                                body,
                                duplex: 'half',
                            } as RequestInit).text()
                        }
                        const nativeFetch = window.fetch
                        ;(window as any).__auditNativeBodies = {}
                        window.fetch = function (this: Window, input: RequestInfo | URL, init?: RequestInit) {
                            const url = input instanceof Request ? input.url : String(input)
                            if (/\/__network_metrics_test\/body\/(readable-stream|blob)$/.test(url)) {
                                // Protocol metadata omits streamed uploads and WebKit Blob bytes.
                                const copy = new Request(input instanceof Request ? input.clone() : input, init)
                                ;(window as any).__auditNativeBodies[url.split('/').pop()!] = copy.text()
                            }
                            return nativeFetch.call(this, input, init)
                        }
                    }, browserName !== 'webkit')
                },
            },
            page,
            context
        )

        const responses = await page.evaluate(async () => {
            const networkMetricsFetch = window.fetch
            window.fetch = function (this: Window, input: RequestInfo | URL, init?: RequestInit) {
                const forwardedRequest = new Request(input, init)
                return networkMetricsFetch.call(this, forwardedRequest)
            }

            const encoder = new TextEncoder()
            const stream = () =>
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode('stream body'))
                        controller.close()
                    },
                })
            const formData = new FormData()
            formData.set('field', 'form body')

            const requests: Array<{ path: string; init: RequestInit }> = [
                { path: 'string', init: { method: 'POST', body: 'string body' } },
                { path: 'form-data', init: { method: 'POST', body: formData } },
                { path: 'blob', init: { method: 'POST', body: new Blob(['blob body'], { type: 'text/plain' }) } },
                { path: 'array-buffer', init: { method: 'POST', body: encoder.encode('array buffer').buffer } },
                { path: 'url-search-params', init: { method: 'POST', body: new URLSearchParams('field=url params') } },
            ]
            // WebKit rejects stream uploads; Chromium streams while Firefox stringifies.
            // The pre-SDK native Request control independently verifies that distinction.
            if (navigator.userAgent.includes('Chrome') || navigator.userAgent.includes('Firefox')) {
                requests.push({
                    path: 'readable-stream',
                    init: { method: 'POST', body: stream(), duplex: 'half' } as RequestInit,
                })
            }

            const results: Array<{ path: string; status: number; text: string }> = []
            for (const { path, init } of requests) {
                const response = await fetch(`/__network_metrics_test/body/${path}`, init)
                results.push({ path, status: response.status, text: await response.text() })
            }
            return results
        })

        expect(responses).toEqual([
            { path: 'string', status: 200, text: 'ok' },
            { path: 'form-data', status: 200, text: 'ok' },
            { path: 'blob', status: 200, text: 'ok' },
            { path: 'array-buffer', status: 200, text: 'ok' },
            { path: 'url-search-params', status: 200, text: 'ok' },
            ...(browserName === 'webkit' ? [] : [{ path: 'readable-stream', status: 200, text: 'ok' }]),
        ])
        expect(uploads.map(({ path }) => path)).toEqual(responses.map(({ path }) => path))
        for (const upload of uploads) {
            expect(upload.method).toBe('POST')
            if (upload.path === 'form-data') {
                expect(upload.contentType).toMatch(/^multipart\/form-data; boundary=/)
                const decoded = await new Response(upload.body, {
                    headers: { 'content-type': upload.contentType },
                }).formData()
                expect(Array.from(decoded.entries())).toEqual([['field', 'form body']])
            } else if (upload.path === 'readable-stream') {
                const nativeBody = await page.evaluate(() => (window as any).__auditNativeStreamControl)
                expect(nativeBody).toBe(browserName === 'firefox' ? '[object ReadableStream]' : 'stream body')
                expect(await page.evaluate(() => (window as any).__auditNativeBodies['readable-stream'])).toBe(
                    nativeBody
                )
                if (browserName === 'firefox') expect(upload.body).toBe(nativeBody)
            } else if (upload.path === 'blob' && browserName === 'webkit') {
                expect(await page.evaluate(() => (window as any).__auditNativeBodies.blob)).toBe('blob body')
                expect(upload.contentType).toMatch(/^text\/plain/)
            } else {
                const expected: Record<string, string> = {
                    string: 'string body',
                    blob: 'blob body',
                    'array-buffer': 'array buffer',
                    'url-search-params': 'field=url+params',
                }
                expect(upload.body).toBe(expected[upload.path])
                if (upload.path === 'string' || upload.path === 'blob')
                    expect(upload.contentType).toMatch(/^text\/plain/)
                if (upload.path === 'url-search-params')
                    expect(upload.contentType).toMatch(/^application\/x-www-form-urlencoded/)
            }
        }
    })
})
