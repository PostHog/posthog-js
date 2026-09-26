/* oxlint-disable no-console, compat/compat -- Node.js CLI drives installed Playwright browsers. */
// Usage: node scripts/check-logs-version-skew.mjs /path/to/extracted-published-cores
// Each version directory contains package/dist/array.js from its published npm tarball.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const fixtures = process.argv[2]
assert(fixtures, 'Supply the directory containing extracted published cores')
const methods = {
    '1.410.4': 'le',
    '1.410.10': 'de',
    '1.418.3': 'he',
    '1.418.10': 'ui',
    '1.418.14': 'ci',
    '1.419.2': 'vi',
    '1.420.0': 'captureConsoleLog',
    '1.434.0': 'captureConsoleLog',
    current: 'captureConsoleLog',
}
const cores = new Map(
    await Promise.all(
        Object.keys(methods).map(async (version) => [
            version,
            await readFile(
                version === 'current' ? 'dist/array.js' : resolve(fixtures, version, 'package/dist/array.js')
            ),
        ])
    )
)
const bundle = await readFile('dist/logs.js')
const config = { supportedCompression: [], hasFeatureFlags: false, sessionRecording: false, surveys: false }
const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost')
    const send = (body, type = 'application/json') => {
        response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
        response.end(body)
    }
    if (url.pathname === '/') {
        send(
            `<!doctype html><html><body><script>
            window.errors=[]; addEventListener('error', e=>errors.push(e.message));
            addEventListener('unhandledrejection', e=>errors.push(String(e.reason)));
            window.posthog=[];posthog._i=[];
            window._POSTHOG_REMOTE_CONFIG={ph_test_logs_skew:{config:${JSON.stringify(config)}}};
            </script><script src="/core.js?version=${url.searchParams.get('version')}"></script><script>
            posthog.init('ph_test_logs_skew',{
                api_host:location.origin,ui_host:location.origin,asset_host:location.origin,
                capture_pageview:false,capture_pageleave:false,autocapture:false,
                disable_session_recording:true,disable_surveys:true,persistence:'memory',
                logs:{captureConsoleLogs:false},person_profiles:'never'
            });</script></body></html>`,
            'text/html'
        )
    } else if (url.pathname === '/core.js') {
        send(cores.get(url.searchParams.get('version')), 'application/javascript')
    } else if (url.pathname === '/bundle.js') {
        send(bundle, 'application/javascript')
    } else if (url.pathname.endsWith('/config.js')) {
        send(
            `window._POSTHOG_REMOTE_CONFIG={ph_test_logs_skew:{config:${JSON.stringify(config)}}}`,
            'application/javascript'
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
const browser = await chromium.launch()
try {
    for (const [version, method] of Object.entries(methods)) {
        const context = await browser.newContext()
        const external = []
        await context.route('**/*', (route) => {
            if (route.request().url().startsWith(`${origin}/`)) return route.continue()
            external.push(route.request().url())
            return route.abort()
        })
        try {
            const page = await context.newPage()
            await page.goto(`${origin}/?version=${version}`)
            await page.addScriptTag({ url: `${origin}/bundle.js` })
            const result = await page.evaluate(
                ({ method, current }) => {
                    const host = window.posthog
                    const logs = host.logs
                    if (!logs || typeof logs[method] !== 'function') return { missing: method }
                    const calls = []
                    let setup = 0
                    let dispose = 0
                    logs[method] = (options) => calls.push(options)
                    logs.setup = () => {
                        setup++
                    }
                    logs.dispose = () => {
                        dispose++
                        stop()
                    }
                    const original = console.warn
                    const stop = window.__PosthogExtensions__.logs.initializeLogs(host)
                    console.warn('version-skew-captured')
                    host.opt_out_capturing()
                    console.warn('version-skew-denied')
                    host.opt_in_capturing()
                    console.warn('version-skew-resumed')
                    const bodiesBeforeShutdown = calls.map((call) => call.body)
                    if (current) {
                        void host.shutdown()
                        console.warn('version-skew-shutdown')
                    }
                    stop()
                    console.warn('version-skew-after-cleanup')
                    return {
                        bodies: calls.map((call) => call.body),
                        bodiesBeforeShutdown,
                        sameLogs: host.logs === logs,
                        restored: console.warn === original,
                        setup,
                        dispose,
                        errors: window.errors,
                    }
                },
                { method, current: version === 'current' }
            )
            assert(!result.missing, `${version}: published console capture method is missing (${result.missing})`)
            assert.deepEqual(
                result.bodies,
                ['"version-skew-captured"', '"version-skew-resumed"'],
                `${version}: console routing`
            )
            assert.deepEqual(result.errors, [], `${version}: page errors`)
            assert.deepEqual(external, [], `${version}: external requests`)
            assert.equal(result.sameLogs, true)
            assert.equal(result.restored, true)
            assert.equal(result.setup, 0)
            assert.equal(result.dispose, version === 'current' ? 1 : 0)
            console.log(
                `PASS ${version}: historical host routing, consent, teardown, host ownership${version === 'current' ? ', shutdown' : ''}`
            )
        } finally {
            await context.close()
        }
    }
} finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
}
