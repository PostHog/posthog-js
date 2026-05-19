import { test, expect } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import { Page, BrowserContext, Request } from '@playwright/test'

// Reproduces the user report that PostHog network recording strips CSRF
// headers from the actual outgoing request. The fix invariant: enabling
// session recording network capture (and/or tracing-headers, both of which
// wrap fetch/XHR) must NEVER cause user-supplied request headers to go
// missing from what the browser actually sends to the server.

const DOMAIN = 'example.com'

type Scenario = {
    name: string
    flagsResponseOverrides: Parameters<typeof start>[0]['flagsResponseOverrides']
    options: Parameters<typeof start>[0]['options']
}

const scenarios: Scenario[] = [
    {
        name: 'network recording only',
        flagsResponseOverrides: {
            sessionRecording: {
                endpoint: '/ses/',
                networkPayloadCapture: { recordBody: true, recordHeaders: true },
            },
            capturePerformance: true,
            autocapture_opt_out: true,
        },
        options: {
            session_recording: { compress_events: false },
        },
    },
    {
        name: 'tracing headers only',
        flagsResponseOverrides: {
            sessionRecording: undefined,
            capturePerformance: true,
            autocapture_opt_out: true,
        },
        options: {
            __add_tracing_headers: [DOMAIN],
        },
    },
    {
        name: 'double wrap: network recording + tracing headers',
        flagsResponseOverrides: {
            sessionRecording: {
                endpoint: '/ses/',
                networkPayloadCapture: { recordBody: true, recordHeaders: true },
            },
            capturePerformance: true,
            autocapture_opt_out: true,
        },
        options: {
            __add_tracing_headers: [DOMAIN],
            session_recording: { compress_events: false },
        },
    },
]

async function captureRequestHeaders(
    page: Page,
    context: BrowserContext,
    scenario: Scenario,
    {
        method,
        csrfHeader,
        csrfValue,
    }: { method: 'fetch' | 'xhr'; csrfHeader: string; csrfValue: string }
): Promise<Record<string, string>> {
    let capturedHeaders: Record<string, string> = {}

    page.on('request', (request: Request) => {
        if (request.url().startsWith(`https://${DOMAIN}`)) {
            capturedHeaders = request.headers()
        }
    })

    await context.route(`**/${DOMAIN}/**`, (route) => {
        void route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
    })
    await context.route(`https://${DOMAIN}/`, (route) => {
        void route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
    })

    await start(
        {
            options: scenario.options,
            flagsResponseOverrides: scenario.flagsResponseOverrides,
            url: '/playground/cypress/index.html',
        },
        page,
        context
    )

    await page.waitForFunction(() => (window as any).posthog?.__loaded === true)

    if (method === 'fetch') {
        await page.evaluate(
            ({ d, header, value }) =>
                fetch(`https://${d}/api/internal/surveys`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        [header]: value,
                    },
                    body: JSON.stringify({ name: 'Untitled' }),
                }),
            { d: DOMAIN, header: csrfHeader, value: csrfValue }
        )
    } else {
        await page.evaluate(
            ({ d, header, value }) =>
                new Promise<void>((resolve) => {
                    const xhr = new XMLHttpRequest()
                    xhr.open('POST', `https://${d}/api/internal/surveys`)
                    xhr.setRequestHeader('content-type', 'application/json')
                    xhr.setRequestHeader(header, value)
                    xhr.onloadend = () => resolve()
                    xhr.send(JSON.stringify({ name: 'Untitled' }))
                }),
            { d: DOMAIN, header: csrfHeader, value: csrfValue }
        )
    }

    await page.waitForTimeout(500)
    return capturedHeaders
}

test.describe('CSRF headers survive PostHog network wrappers', () => {
    const csrfHeaders = [
        { header: 'x-csrf-token', value: 'r_lIDFH3NdoomvNNKK5SWHg3KFOpWvnARWDvvi_TbwY' },
        { header: 'x-csrftoken', value: 'django-style-csrf' },
        { header: 'x-xsrf-token', value: 'angular-style-xsrf' },
    ]

    for (const scenario of scenarios) {
        for (const method of ['fetch', 'xhr'] as const) {
            for (const { header, value } of csrfHeaders) {
                test(`${scenario.name} | ${method} | ${header} reaches the server unchanged`, async ({
                    page,
                    context,
                }) => {
                    const headers = await captureRequestHeaders(page, context, scenario, {
                        method,
                        csrfHeader: header,
                        csrfValue: value,
                    })

                    expect(headers[header]).toBe(value)
                })
            }
        }
    }
})
