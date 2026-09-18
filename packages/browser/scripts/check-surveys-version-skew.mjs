/* oxlint-disable no-console, compat/compat -- Node.js CLI reports results and drives installed Playwright browsers. */
// Usage: node scripts/check-surveys-version-skew.mjs /path/to/extracted-published-cores
// Each version directory must contain package/dist/array.js from its published npm tarball.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const fixtures = process.argv[2]
assert(fixtures, 'Supply the directory containing extracted published cores')
const versions = ['1.259.0', '1.300.0', '1.420.0', '1.434.0', 'current']
const cores = new Map(
    await Promise.all(
        versions.map(async (version) => [
            version,
            await readFile(
                version === 'current' ? 'dist/array.js' : resolve(fixtures, version, 'package/dist/array.js')
            ),
        ])
    )
)
const renderer = await readFile('dist/surveys.js')
const config = {
    surveys: true,
    hasFeatureFlags: true,
    supportedCompression: [],
    featureFlags: { 'skew-target': 'control' },
    featureFlagPayloads: {},
    sessionRecording: false,
    autocapture_opt_out: true,
}
let activeScenario
const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost')
    const referrer = new URL(request.headers.referer || 'http://localhost')
    const version = url.searchParams.get('core') || referrer.searchParams.get('core')
    const scenario = activeScenario
    const send = (body, type = 'application/json') => {
        response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
        response.end(body)
    }
    if (url.pathname === '/') {
        send(
            `<!doctype html><html><body><h1>Survey migration smoke</h1><script>
            window.errors=[]; window.events=[];
            addEventListener('error', e => errors.push(e.message));
            addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
            window.posthog=[];posthog._i=[];
            window._POSTHOG_REMOTE_CONFIG={ph_test_skew:{config:${JSON.stringify(config)}}};
            </script><script src="/core.js?core=${version}"></script><script>
            posthog.init('ph_test_skew',{
                api_host:location.origin,ui_host:location.origin,asset_host:location.origin,
                capture_pageview:false,capture_pageleave:false,autocapture:false,
                disable_session_recording:true,disable_surveys:false,advanced_enable_surveys:true,
                persistence:'memory',request_batching:false,person_profiles:'never',
                before_send:e=>{events.push(JSON.parse(JSON.stringify(e)));return e}
            });</script></body></html>`,
            'text/html'
        )
    } else if (url.pathname === '/core.js') {
        send(cores.get(version), 'application/javascript')
    } else if (url.pathname.endsWith('/surveys.js')) {
        send(renderer, 'application/javascript')
    } else if (url.pathname.endsWith('/config.js')) {
        send(
            `window._POSTHOG_REMOTE_CONFIG={ph_test_skew:{config:${JSON.stringify(config)}}}`,
            'application/javascript'
        )
    } else if (url.pathname.endsWith('/api/surveys/')) {
        send(
            JSON.stringify({
                surveys: [
                    {
                        id: 'skew-smoke',
                        name: 'Skew smoke',
                        type: 'popover',
                        start_date: '2025-01-01T00:00:00Z',
                        end_date: null,
                        questions: [{ type: 'open', question: 'Migration question', id: 'q1' }],
                        appearance: {
                            displayThankYouMessage: true,
                            thankYouMessageHeader: 'Thanks smoke',
                            submitButtonText: 'Submit',
                        },
                        ...(scenario === 'targeted'
                            ? { linked_flag_key: 'skew-target', conditions: { linkedFlagVariant: 'control' } }
                            : {}),
                    },
                ],
            })
        )
    } else if (url.pathname.endsWith('.js')) {
        send('', 'application/javascript')
    } else {
        request.resume()
        send(JSON.stringify(config))
    }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] })
try {
    for (const version of versions) {
        for (const scenario of ['basic', 'targeted']) {
            activeScenario = scenario
            const context = await browser.newContext({
                userAgent:
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            })
            const external = []
            await context.route('**/*', (route) => {
                if (route.request().url().startsWith(`${origin}/`)) return route.continue()
                external.push(route.request().url())
                return route.abort()
            })
            const page = await context.newPage()
            // Match an ordinary Chrome visit, including Client Hints (not HeadlessChrome).
            const cdp = await context.newCDPSession(page)
            await cdp.send('Network.setUserAgentOverride', {
                userAgent: await page.evaluate(() => navigator.userAgent),
            })
            try {
                await page.goto(`${origin}/?core=${version}&scenario=${scenario}`)
                await page.getByRole('textbox', { name: 'Migration question' }).fill('Migration answer')
                await page.getByRole('button', { name: 'Submit survey' }).click()
                await page.getByRole('heading', { name: 'Thanks smoke' }).waitFor()
                const { events, errors, scripts } = await page.evaluate(() => ({
                    events: window.events,
                    errors: window.errors,
                    scripts: Array.from(document.scripts).map((script) => script.src),
                }))
                assert.deepEqual(errors, [])
                assert.deepEqual(external, [])
                assert(
                    scripts.some((src) => src.includes('/surveys.js')),
                    'Renderer must load dynamically'
                )
                assert(
                    events.some((event) => event.event === 'survey shown'),
                    JSON.stringify({
                        version,
                        scenario,
                        events,
                        info: await page.evaluate(() => ({
                            ua: navigator.userAgent,
                            brands: navigator.userAgentData?.brands,
                            webdriver: navigator.webdriver,
                            capture: posthog.is_capturing?.(),
                        })),
                    })
                )
                assert(
                    events.some(
                        (event) =>
                            event.event === 'survey sent' && event.properties.$survey_response_q1 === 'Migration answer'
                    )
                )
                if (scenario === 'targeted')
                    assert(
                        events.some((event) => event.event === '$feature_flag_called'),
                        JSON.stringify({
                            version,
                            scenario,
                            cached: await page.evaluate(() => new Promise((resolve) => posthog.getSurveys(resolve))),
                            events: events.map((e) => ({ event: e.event, properties: e.properties })),
                        })
                    )
                console.log(
                    `PASS ${version} ${scenario}: dynamic display, submission, thank-you, no page errors or external requests`
                )
            } finally {
                await context.close()
            }
        }
    }
} finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
}
