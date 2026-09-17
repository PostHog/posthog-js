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

const attributesOf = (dataPoint: OtlpHistogramDataPoint): Record<string, string | undefined> =>
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
        await context.route('**/__network_metrics_test/body/**', async (route: Route) => {
            await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
        })

        await start(
            {
                options: { metrics: { network: true }, disable_compression: true },
                url: '/playground/cypress/index.html',
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
            // WebKit currently rejects ReadableStream uploads before fetch reaches the network.
            // Chromium and Firefox exercise it below; all body types accepted by WebKit still
            // pass through the same downstream Request wrapper here.
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
    })
})
