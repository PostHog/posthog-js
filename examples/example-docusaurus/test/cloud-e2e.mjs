import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const sample = fileURLToPath(new URL('..', import.meta.url))
const plugin = fileURLToPath(import.meta.resolve('posthog-docusaurus'))
const apiKey = process.env.POSTHOG_API_KEY
const apiHost = process.env.POSTHOG_API_HOST
if (!apiKey || !apiHost) throw new Error('Set POSTHOG_API_KEY and POSTHOG_API_HOST for the authorized project.')
const executablePath = process.env.BRAVE_EXECUTABLE || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
const runId = `posthoge2e-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`
const outputPath = process.env.POSTHOG_E2E_REPORT || path.join(tmpdir(), `${runId}.json`)
const temporary = await mkdtemp(path.join(tmpdir(), 'posthoge2e-docusaurus-'))
const children = []
let browser
let activePage
const report = { runId, start: new Date().toISOString(), apiHost, eventBudget: 25, versions: {}, cases: [] }
const redact = (text) => String(text).replace(/ph[cx]_[A-Za-z0-9]+/g, '[REDACTED]')

async function waitUntil(check, label, timeout = 30000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
        if (await check()) return
        await delay(100)
    }
    throw new Error(`Timed out: ${label}`)
}

async function stop(child) {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
}

function launch(args, env) {
    const child = spawn(
        process.execPath,
        [path.join(sample, 'node_modules/@docusaurus/core/bin/docusaurus.mjs'), ...args],
        {
            cwd: temporary,
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    )
    children.push(child)
    let output = ''
    child.stdout.on('data', (chunk) => {
        output += chunk
    })
    child.stderr.on('data', (chunk) => {
        output += chunk
    })
    return { child, logs: () => redact(output) }
}

async function startSite(command, env) {
    const reservation = createServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    const port = reservation.address().port
    await new Promise((resolve) => reservation.close(resolve))
    const server = launch([command, '--host', '127.0.0.1', '--port', String(port), '--no-open'], env)
    const origin = `http://127.0.0.1:${port}`
    await waitUntil(
        async () => {
            if (server.child.exitCode !== null) throw new Error(server.logs())
            try {
                return (await fetch(origin)).ok
            } catch {
                return false
            }
        },
        'site startup',
        90000
    )
    return { ...server, origin }
}

function decode(body) {
    let parsed
    try {
        parsed = JSON.parse(body)
    } catch {
        parsed = { data: new URLSearchParams(body).get('data') }
    }
    if (typeof parsed.data === 'string') parsed = JSON.parse(Buffer.from(parsed.data, 'base64').toString())
    return parsed.batch || (Array.isArray(parsed) ? parsed : [parsed])
}

try {
    await symlink(path.join(sample, 'node_modules'), path.join(temporary, 'node_modules'))
    await mkdir(path.join(temporary, 'src/pages'), { recursive: true })
    await writeFile(
        path.join(temporary, 'package.json'),
        JSON.stringify({ name: 'posthoge2e-cloud-sample', private: true })
    )
    await writeFile(
        path.join(temporary, 'docusaurus.config.js'),
        `module.exports = {
    title: "PostHog Cloud E2E", url: "https://example.com", baseUrl: "/",
    presets: [["classic", { docs: false, blog: false }]],
    plugins: [[${JSON.stringify(plugin)}, {
      apiKey: process.env.POSTHOG_API_KEY, appUrl: process.env.POSTHOG_API_HOST,
      enableInDevelopment: process.env.E2E_DEV_ENABLED === "true",
      opt_out_useragent_filter: true, disable_compression: true, request_batching: false,
      capture_pageleave: false, capture_exceptions: false,
      disable_session_recording: true, disable_surveys: true,
      disable_conversations: true, disable_product_tours: true,
    }]],
  };`
    )
    await writeFile(
        path.join(temporary, 'src/pages/index.jsx'),
        `import React from "react";
import Link from "@docusaurus/Link";
import { useLocation } from "@docusaurus/router";
export default function Home() {
  const location = useLocation();
  return <main><h1>PostHog Cloud E2E</h1>
    <Link to={"/second" + location.search}>posthoge2e second page</Link>
    <button data-attr="posthoge2e-custom" onClick={() => window.posthog?.capture("posthoge2e_custom", { e2e_action: "button_clicked" })}>posthoge2e custom button</button>
  </main>;
}`
    )
    await writeFile(
        path.join(temporary, 'src/pages/second.jsx'),
        `import React from "react";
export default function Second() { return <main><h1>posthoge2e second page</h1></main>; }`
    )

    const profile = path.join(temporary, 'brave-profile')
    await mkdir(path.join(profile, 'Default'), { recursive: true })
    // Shields otherwise blocks the real SDK once its tracker lists load.
    await writeFile(
        path.join(profile, 'Default/Preferences'),
        JSON.stringify({
            profile: { default_content_setting_values: { braveShields: 2 } },
        })
    )
    report.overrides = {
        shieldsDisabledInTemporaryProfile: true,
        automationUserAgentAllowed: true,
        compression: false,
        batching: false,
        pageleave: false,
        replay: false,
        surveys: false,
        exceptionAutocapture: false,
        conversations: false,
        productTours: false,
    }
    browser = await puppeteer.launch({ executablePath, userDataDir: profile, headless: true })
    report.versions.brave = execFileSync(executablePath, ['--version'], { encoding: 'utf8' }).trim()
    report.versions.browser = await browser.version()
    report.versions.node = process.version
    for (const name of ['@docusaurus/core', 'react', 'react-dom']) {
        const { readFile } = await import('node:fs/promises')
        report.versions[name] = JSON.parse(
            await readFile(path.join(sample, 'node_modules', name, 'package.json'))
        ).version
    }

    const scenarios = [
        { id: 'production-default', production: true, enabled: true },
        { id: 'development-disabled', production: false, enabled: false },
        { id: 'development-enabled', production: false, enabled: true },
    ]
    for (const scenario of scenarios.filter(
        (item) => !process.env.POSTHOG_E2E_CASES || process.env.POSTHOG_E2E_CASES.split(',').includes(item.id)
    )) {
        const env = { E2E_DEV_ENABLED: String(!scenario.production && scenario.enabled) }
        if (scenario.production) {
            const build = launch(['build'], env)
            const [code] = await once(build.child, 'exit')
            if (code !== 0) throw new Error(build.logs())
        }
        const server = await startSite(scenario.production ? 'serve' : 'start', env)
        const context = await browser.createBrowserContext()
        const page = await context.newPage()
        activePage = page
        const result = {
            ...scenario,
            start: new Date().toISOString(),
            events: [],
            requests: [],
            errors: [],
            networkErrors: [],
        }
        page.on('requestfailed', (request) => {
            const url = new URL(request.url())
            result.networkErrors.push({
                host: url.hostname,
                path: redact(url.pathname),
                error: request.failure()?.errorText,
            })
        })
        report.cases.push(result)
        const pending = new Map()
        page.on('pageerror', (error) => result.errors.push(redact(error.message)))
        page.on('request', (request) => {
            const url = new URL(request.url())
            if (
                url.origin !== new URL(apiHost).origin ||
                request.method() !== 'POST' ||
                !['/e/', '/i/v0/e/'].includes(url.pathname)
            )
                return
            const entry = { path: url.pathname, status: null }
            result.requests.push(entry)
            pending.set(request, entry)
            try {
                for (const event of decode(request.postData())) {
                    const properties = event.properties || {}
                    result.events.push({
                        uuid: event.uuid,
                        event: event.event,
                        timestamp: event.timestamp,
                        distinctId: properties.distinct_id,
                        url: properties.$current_url,
                        pathname: properties.$pathname,
                        run: properties.e2e_run_id,
                        case: properties.e2e_case,
                        lib: properties.$lib,
                        version: properties.$lib_version,
                        action: properties.e2e_action,
                        eventType: properties.$event_type,
                        elementText: properties.$el_text,
                    })
                }
            } catch (error) {
                result.errors.push(`Decode: ${redact(error.message)}`)
            }
        })
        page.on('response', (response) => {
            const entry = pending.get(response.request())
            if (entry) entry.status = response.status()
        })
        const query = new URLSearchParams({ e2e_run_id: runId, e2e_case: scenario.id })
        if (scenario.production)
            result.ssr = (await (await fetch(server.origin)).text()).includes('<h1>PostHog Cloud E2E</h1>')
        await page.goto(`${server.origin}/?${query}`, { waitUntil: 'networkidle0' })
        if (scenario.enabled) {
            await page.waitForFunction(() => window.posthog?.__loaded)
            result.sdk = await page.evaluate(
                ({ runId, caseId }) => {
                    window.posthog.register({ e2e_run_id: runId, e2e_case: caseId, e2e_synthetic: true })
                    return {
                        version: posthog.version,
                        distinctId: posthog.get_distinct_id(),
                        autocaptureEnabled: posthog.autocapture?.isEnabled,
                    }
                },
                { runId, caseId: scenario.id }
            )
            await waitUntil(() => result.events.some((event) => event.event === '$pageview'), 'initial pageview')
            await page.locator('button').click()
            await waitUntil(() => result.events.some((event) => event.event === 'posthoge2e_custom'), 'custom capture')
        } else {
            result.sdkAbsent = await page.evaluate(() => typeof window.posthog === 'undefined')
            await page.locator('button').click()
        }
        await page.evaluate(() => {
            window.__posthoge2eSentinel = true
        })
        await page.locator('a[href^="/second"]').click()
        await page.waitForFunction(
            () =>
                location.pathname === '/second' &&
                document.querySelector('h1')?.textContent === 'posthoge2e second page'
        )
        result.spa = await page.evaluate(() => window.__posthoge2eSentinel === true)
        result.destination = page.url()
        if (scenario.enabled)
            await waitUntil(
                () => result.events.some((event) => event.event === '$pageview' && event.pathname === '/second'),
                'SPA pageview'
            )
        await delay(1500)
        await waitUntil(() => result.requests.every((request) => request.status !== null), 'ingestion responses')
        result.end = new Date().toISOString()
        result.counts = Object.fromEntries(
            ['$pageview', '$autocapture', 'posthoge2e_custom'].map((name) => [
                name,
                result.events.filter((event) => event.event === name).length,
            ])
        )
        result.initialPageviews = result.events.filter(
            (event) => event.event === '$pageview' && event.pathname === '/'
        ).length
        result.navigationPageviews = result.events.filter(
            (event) => event.event === '$pageview' && event.pathname === '/second'
        ).length
        console.log(
            JSON.stringify({
                case: scenario.id,
                initialPageviews: result.initialPageviews,
                navigationPageviews: result.navigationPageviews,
                counts: result.counts,
                errors: result.errors,
                ssr: result.ssr,
                spa: result.spa,
                sdkAbsent: result.sdkAbsent,
            })
        )
        await context.close()
        await stop(server.child)
        if (report.cases.reduce((sum, item) => sum + item.events.length, 0) > report.eventBudget)
            throw new Error('Event budget exceeded')
    }
} catch (error) {
    report.error = redact(error.stack)
    if (activePage && !activePage.isClosed()) {
        report.lastSDKState = await activePage.evaluate(() => ({
            type: typeof window.posthog,
            loaded: window.posthog?.__loaded,
            scriptHosts: [...document.scripts].filter((s) => s.src).map((s) => new URL(s.src).hostname),
        }))
    }
    process.exitCode = 1
} finally {
    for (const child of children) await stop(child)
    if (browser) await browser.close()
    await rm(temporary, { recursive: true, force: true })
    report.end = new Date().toISOString()
    await writeFile(outputPath, JSON.stringify(report, null, 2), { mode: 0o600 })
    console.log(
        JSON.stringify({
            report: outputPath,
            runId,
            start: report.start,
            end: report.end,
            versions: report.versions,
            error: report.error,
        })
    )
}
