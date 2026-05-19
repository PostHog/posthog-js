import { test, expect } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'
import { Page, BrowserContext, Request } from '@playwright/test'
import { csrfHeaderCases } from '../../../src/__tests__/extensions/replay/external/header-cases'

// Reproduces the user report that PostHog network recording strips CSRF
// headers from the actual outgoing request. The fix invariant: enabling
// session recording network capture (and/or tracing-headers, both of which
// wrap fetch/XHR) must NEVER cause user-supplied request headers to go
// missing from what the browser actually sends to the server.

// __add_tracing_headers matches by exact hostname (entrypoints/tracing-headers.ts
// addTracingHeaders). The URL path is irrelevant for that match — a flake here
// almost certainly means the wrapper readiness wait fired too early, not the URL.
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
    await context.route(`**/${DOMAIN}/**`, (route) => {
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

    // Wait for whichever wrappers this scenario enables to actually be
    // installed before triggering the request. Without this the test
    // could fire its fetch/XHR before the patch lands and pass trivially
    // (false negative — no wrapper ever ran).
    if (scenario.options?.__add_tracing_headers) {
        await page.waitForFunction(
            () => !!(window as any).__PosthogExtensions__?.tracingHeadersPatchFns
        )
    }
    if (scenario.flagsResponseOverrides?.sessionRecording) {
        await waitForSessionRecordingToStart(page)
    }

    // Wait for the actual outgoing request and read its headers from the
    // request object directly. Replaces a sleep-based assertion and
    // tolerates a small race where the request fires before the
    // page.on('request') handler binds.
    const requestPromise = page.waitForRequest((req) => req.url().startsWith(`https://${DOMAIN}`))

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

    const request = await requestPromise
    return request.headers()
}

test.describe('CSRF headers survive PostHog network wrappers', () => {
    for (const scenario of scenarios) {
        for (const method of ['fetch', 'xhr'] as const) {
            for (const [header, value] of csrfHeaderCases) {
                test(`${scenario.name} | ${method} | ${header} reaches the server unchanged`, async ({
                    page,
                    context,
                }) => {
                    const headers = await captureRequestHeaders(page, context, scenario, {
                        method,
                        csrfHeader: header,
                        csrfValue: value,
                    })

                    // Playwright lowercases header names in request.headers(),
                    // so look up case-insensitively in case the shared fixture
                    // is ever extended with capitalised header names.
                    const found = Object.entries(headers).find(
                        ([k]) => k.toLowerCase() === header.toLowerCase()
                    )
                    expect(found?.[1]).toBe(value)
                })
            }
        }
    }
})
