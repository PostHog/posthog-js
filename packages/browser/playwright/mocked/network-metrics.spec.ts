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
    Object.fromEntries(dataPoint.attributes.map((a) => [a.key, a.value.stringValue]))

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
                method: 'GET',
                host: 'localhost',
                path: '/__network_metrics_test/orders/:id',
                status_class: '2xx',
            },
        ])
    })
})
