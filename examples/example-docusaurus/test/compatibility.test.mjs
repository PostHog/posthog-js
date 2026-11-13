import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import puppeteer from 'puppeteer-core'

const cwd = fileURLToPath(new URL('..', import.meta.url))
const executablePath =
    process.env.BRAVE_EXECUTABLE ||
    (process.platform === 'darwin' ? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' : 'brave-browser')
const assetDirectory = fileURLToPath(new URL('../../../packages/browser/dist/', import.meta.url))

async function listen(server) {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    return `http://127.0.0.1:${server.address().port}`
}

async function waitUntil(check, description, timeout = 30000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
        if (await check()) return
        await delay(100)
    }
    throw new Error(`Timed out waiting for ${description}`)
}

function docusaurus(args, env) {
    const child = spawn(process.execPath, ['node_modules/@docusaurus/core/bin/docusaurus.mjs', ...args], {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (data) => {
        output += data
    })
    child.stderr.on('data', (data) => {
        output += data
    })
    return { child, output: () => output }
}

async function stop(child) {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
}

function decodeEvents(body) {
    let parsed
    try {
        parsed = JSON.parse(body)
    } catch {
        parsed = { data: new URLSearchParams(body).get('data') }
    }
    if (typeof parsed.data === 'string') {
        parsed = JSON.parse(Buffer.from(parsed.data, 'base64').toString())
    }
    return parsed.batch || (Array.isArray(parsed) ? parsed : [parsed])
}

await test('Docusaurus compatibility with the real PostHog SDK', async (t) => {
    const events = []
    const ingestionErrors = []
    const assets = new Map()
    const api = createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Headers', '*')
        if (req.method === 'OPTIONS') return res.end()
        const url = new URL(req.url, 'http://localhost')
        try {
            if (url.pathname.endsWith('/config.js')) {
                res.statusCode = 404
                return res.end()
            }
            if (url.pathname.endsWith('/config')) {
                res.setHeader('Content-Type', 'application/json')
                return res.end(JSON.stringify({ autocapture_opt_out: false }))
            }
            if (url.pathname.startsWith('/static/')) {
                if (!assets.has(url.pathname)) {
                    assets.set(
                        url.pathname,
                        await readFile(path.join(assetDirectory, path.basename(url.pathname)), 'utf8')
                    )
                }
                res.setHeader('Content-Type', 'application/javascript')
                return res.end(assets.get(url.pathname))
            }
            if (url.pathname === '/e/' || url.pathname === '/i/v0/e/') {
                let body = ''
                for await (const chunk of req) body += chunk
                events.push(...decodeEvents(body))
            }
            res.setHeader('Content-Type', 'application/json')
            res.end(
                JSON.stringify(
                    url.pathname.startsWith('/flags')
                        ? { featureFlags: {}, featureFlagPayloads: {}, sessionRecording: false, surveys: [] }
                        : { status: 1 }
                )
            )
        } catch (error) {
            ingestionErrors.push(error.message)
            res.statusCode = 500
            res.end()
        }
    })
    const apiUrl = await listen(api)
    t.after(() => {
        api.closeAllConnections()
        return new Promise((resolve) => api.close(resolve))
    })
    const env = { POSTHOG_TEST_API_HOST: apiUrl }
    const build = docusaurus(['build'], env)
    const [code] = await once(build.child, 'exit')
    assert.equal(code, 0, build.output())

    const userDataDir = await mkdtemp(path.join(tmpdir(), 'posthog-docusaurus-brave-'))
    const browser = await puppeteer.launch({ executablePath, userDataDir, headless: true })
    t.after(async () => {
        await browser.close()
        await rm(userDataDir, { recursive: true, force: true })
    })
    const browserErrors = []
    async function newPage(context = browser) {
        const page = await context.newPage()
        page.on('pageerror', (error) => browserErrors.push(error.message))
        await page.setRequestInterception(true)
        page.on('request', (req) => {
            const url = new URL(req.url())
            if (url.hostname === '127.0.0.1' || url.protocol === 'data:') req.continue()
            else req.abort()
        })
        return page
    }
    const page = await newPage()

    async function startSite(args, extraEnv = {}) {
        const reservation = createServer()
        const siteUrl = await listen(reservation)
        const port = reservation.address().port
        await new Promise((resolve) => reservation.close(resolve))
        const process = docusaurus([...args, '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
            ...env,
            ...extraEnv,
        })
        t.after(() => stop(process.child))
        await waitUntil(
            async () => {
                assert.equal(process.child.exitCode, null, process.output())
                try {
                    return (await fetch(siteUrl)).ok
                } catch {
                    return false
                }
            },
            'Docusaurus server',
            90000
        )
        return { ...process, siteUrl }
    }

    const production = await startSite(['serve'])
    await page.goto(production.siteUrl, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => window.posthog?.__loaded)
    await waitUntil(() => events.some((event) => event.event === '$pageview'), 'initial pageview')
    console.log('SDK version:', await page.evaluate(() => window.posthog.version))

    await t.test('production SSR, hydration and SDK initialization', async () => {
        const html = await (await fetch(production.siteUrl)).text()
        assert.match(html, /<h1>PostHog compatibility sample<\/h1>/)
        assert.equal(await page.$eval('h1', (element) => element.textContent), 'PostHog compatibility sample')
        assert.deepEqual(browserErrors, [])
        assert.deepEqual(ingestionErrors, [])
        assert.equal(await page.evaluate(() => window.posthog.config.token), 'phc_docusaurus_local_test')
        assert.equal(await page.evaluate(() => window.posthog.config.api_host), apiUrl)
    })

    await t.test('one initial pageview', () => {
        const pageviews = events.filter((event) => event.event === '$pageview')
        assert.equal(pageviews.length, 1, JSON.stringify(pageviews.map((event) => event.properties.$current_url)))
    })

    await t.test('custom capture and button autocapture reach ingestion', async () => {
        await page.locator('button').click()
        await waitUntil(() => events.some((event) => event.event === 'sample_button_clicked'), 'custom event')
        await waitUntil(() => events.some((event) => event.event === '$autocapture'), 'autocapture')
    })

    await t.test('client-side navigation captures one pageview with the new URL', async () => {
        const before = events.filter((event) => event.event === '$pageview').length
        await page.evaluate(() => {
            window.__navigationSentinel = true
        })
        await page.locator('a[href="/second"]').click()
        await page.waitForFunction(
            () => location.pathname === '/second' && document.querySelector('h1')?.textContent === 'Second page'
        )
        await waitUntil(
            () => events.filter((event) => event.event === '$pageview').length > before,
            'navigation pageview'
        )
        await delay(500)
        assert.equal(
            await page.evaluate(() => window.__navigationSentinel),
            true,
            'navigation must not reload the document'
        )
        const pageviews = events.filter((event) => event.event === '$pageview').slice(before)
        assert.equal(pageviews.length, 1)
        assert.equal(new URL(pageviews[0].properties.$current_url).pathname, '/second')
    })
    await t.test('default pageleave capture is preserved on unload', async () => {
        const before = events.length
        await page.goto('about:blank', { waitUntil: 'networkidle0' })
        await delay(500)
        const pageleaves = events.slice(before).filter((event) => event.event === '$pageleave')
        assert.equal(pageleaves.length, 1)
        assert.equal(new URL(pageleaves[0].properties.$current_url).pathname, '/second')
    })
    await stop(production.child)

    await t.test('development is disabled by default', async () => {
        const dev = await startSite(['start'], { POSTHOG_ENABLE_IN_DEVELOPMENT: 'false' })
        await page.goto(dev.siteUrl, { waitUntil: 'networkidle0' })
        assert.equal(await page.evaluate(() => typeof window.posthog), 'undefined')
        assert.equal(
            events.filter(
                (event) => event.event === '$pageview' && event.properties.$current_url.startsWith(dev.siteUrl)
            ).length,
            0
        )
        await stop(dev.child)
    })

    await t.test('development can be explicitly enabled', async () => {
        const dev = await startSite(['start'], { POSTHOG_ENABLE_IN_DEVELOPMENT: 'true' })
        const before = events.length
        await page.goto(dev.siteUrl, { waitUntil: 'networkidle0' })
        await page.waitForFunction(() => window.posthog?.__loaded)
        await waitUntil(() => events.slice(before).some((event) => event.event === '$pageview'), 'development pageview')
        await stop(dev.child)
    })

    await t.test('opting in captures the landing pageview without navigation', async () => {
        const consentBuild = docusaurus(['build'], { ...env, POSTHOG_TEST_OPT_OUT: 'true' })
        const [code] = await once(consentBuild.child, 'exit')
        assert.equal(code, 0, consentBuild.output())
        const consent = await startSite(['serve'], { POSTHOG_TEST_OPT_OUT: 'true' })
        const context = await browser.createBrowserContext()
        try {
            const consentPage = await newPage(context)
            await consentPage.goto(consent.siteUrl, { waitUntil: 'networkidle0' })
            await consentPage.waitForFunction(() => window.posthog?.__loaded)
            assert.equal(await consentPage.evaluate(() => posthog.config.opt_out_capturing_by_default), true)
            assert.equal(await consentPage.evaluate(() => posthog.has_opted_out_capturing()), true)
            const landingPageviews = () =>
                events.filter(
                    (event) => event.event === '$pageview' && event.properties.$current_url === consent.siteUrl + '/'
                )
            assert.equal(landingPageviews().length, 0)
            await consentPage.evaluate(() => {
                window.__consentSentinel = true
                posthog.opt_in_capturing()
            })
            await consentPage.waitForNetworkIdle({ idleTime: 500 })
            assert.equal(await consentPage.evaluate(() => posthog.has_opted_out_capturing()), false)
            assert.equal(await consentPage.evaluate(() => window.__consentSentinel), true)
            assert.equal(consentPage.url(), consent.siteUrl + '/')
            assert.equal(landingPageviews().length, 1)
        } finally {
            await context.close()
            await stop(consent.child)
        }
    })

    assert.deepEqual(browserErrors, [])
    assert.deepEqual(ingestionErrors, [])
})
