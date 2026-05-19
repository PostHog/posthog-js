import { test, expect } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'
import { Page, BrowserContext, Request } from '@playwright/test'
import { csrfHeaderCases } from '../../../src/__tests__/extensions/replay/external/test_data/header-cases'
import { readFileSync } from 'fs'
import { resolve as resolvePath } from 'path'

// axios is NOT a dep of posthog-js — the bundle is vendored as a test
// fixture so we can exercise the reporter's exact runtime (axios ^0.18,
// which uses the XMLHttpRequest adapter in the browser). Vendoring keeps
// axios out of package.json and the production lockfile.
const axiosBundleSrc = readFileSync(
    resolvePath(__dirname, 'test_fixtures/axios-0.18.1.min.js'),
    'utf8'
)

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
        csrfHeaders,
    }: { method: 'fetch' | 'xhr' | 'axios'; csrfHeaders: ReadonlyArray<readonly [string, string]> }
): Promise<Record<string, string>> {
    // CORS-compliant response so the browser's preflight succeeds and
    // the actual POST is sent (otherwise we'd only ever capture the
    // OPTIONS preflight, which never carries the custom CSRF header).
    await context.route(`**/${DOMAIN}/**`, (route) => {
        void route.fulfill({
            status: 200,
            contentType: 'text/plain',
            body: 'ok',
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
                'Access-Control-Allow-Headers': '*',
            },
        })
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

    // Wait for the actual POST (not the OPTIONS preflight) and read its
    // headers directly. Replaces a sleep-based assertion and tolerates a
    // small race where the request fires before any handler binds.
    const requestPromise = page.waitForRequest(
        (req) => req.url().startsWith(`https://${DOMAIN}`) && req.method() === 'POST'
    )

    // Set ALL csrf headers on the single probe request — one round-trip
    // exercises every header at once, keeping cross-browser fan-out
    // affordable while still catching a regression on any individual
    // header name.
    const headerEntries = csrfHeaders.map(([h, v]) => [h, v] as [string, string])

    if (method === 'fetch') {
        await page.evaluate(
            ({ d, entries }) =>
                fetch(`https://${d}/api/internal/surveys`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        ...Object.fromEntries(entries),
                    },
                    body: JSON.stringify({ name: 'Untitled' }),
                }),
            { d: DOMAIN, entries: headerEntries }
        )
    } else if (method === 'xhr') {
        await page.evaluate(
            ({ d, entries }) =>
                new Promise<void>((resolve) => {
                    const xhr = new XMLHttpRequest()
                    xhr.open('POST', `https://${d}/api/internal/surveys`)
                    xhr.setRequestHeader('content-type', 'application/json')
                    for (const [h, v] of entries) xhr.setRequestHeader(h, v)
                    xhr.onloadend = () => resolve()
                    xhr.send(JSON.stringify({ name: 'Untitled' }))
                }),
            { d: DOMAIN, entries: headerEntries }
        )
    } else {
        // axios 0.18: UMD bundle exposes window.axios. Internally it
        // uses the XMLHttpRequest adapter — the prototype.open patch
        // installed by PostHog should still see all setRequestHeader
        // calls axios makes on the request instance.
        await page.addScriptTag({ content: axiosBundleSrc })
        await page.waitForFunction(() => typeof (window as any).axios !== 'undefined')
        await page.evaluate(
            async ({ d, entries }) => {
                const axios = (window as any).axios
                await axios.post(
                    `https://${d}/api/internal/surveys`,
                    { name: 'Untitled' },
                    { headers: { 'content-type': 'application/json', ...Object.fromEntries(entries) } }
                )
            },
            { d: DOMAIN, entries: headerEntries }
        )
    }

    const request = await requestPromise
    return request.headers()
}

test.describe('CSRF headers survive PostHog network wrappers', () => {
    for (const scenario of scenarios) {
        for (const method of ['fetch', 'xhr', 'axios'] as const) {
            test(`${scenario.name} | ${method} | all CSRF headers reach the server unchanged`, async ({
                page,
                context,
            }) => {
                const headers = await captureRequestHeaders(page, context, scenario, {
                    method,
                    csrfHeaders: csrfHeaderCases,
                })

                // Playwright lowercases header names in request.headers(),
                // so look up case-insensitively in case the shared fixture
                // is ever extended with capitalised header names.
                for (const [header, value] of csrfHeaderCases) {
                    const found = Object.entries(headers).find(
                        ([k]) => k.toLowerCase() === header.toLowerCase()
                    )
                    expect(found?.[1], `${header} should be ${value}, got ${found?.[1]}`).toBe(value)
                }
            })
        }
    }
})
