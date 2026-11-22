import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { URL } from 'node:url'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { gunzipSync } from 'node:zlib'
import { chromium } from '@playwright/test'
import { bundleRevision } from './bundle.mjs'

const config = {
    token: 'phc_fixture',
    sessionRecording: { endpoint: '/s/' },
    hasFeatureFlags: false,
    supportedCompression: ['gzip-js'],
}
function pageHTML(number) {
    return `<!doctype html><p>fixture-document-${number}</p><script src="/sdk.js"></script>
    <script>posthog.init("phc_fixture",{api_host:location.origin,opt_out_useragent_filter:true,
    capture_pageview:false,autocapture:false,opt_out_capturing_by_default:true,loaded:p=>p.opt_in_capturing()})</script>`
}

async function snapshots(request) {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    let raw = Buffer.concat(chunks)
    if (raw[0] === 0x1f) raw = gunzipSync(raw)
    const events = [JSON.parse(raw.toString())].flat()
    return events.flatMap((event) =>
        (event.properties.$snapshot_data ?? [])
            .filter((snapshot) => snapshot.type === 2)
            .map((snapshot) => ({
                uuid: event.uuid,
                document:
                    typeof snapshot.data === 'string'
                        ? gunzipSync(Buffer.from(snapshot.data, 'latin1')).toString()
                        : JSON.stringify(snapshot.data),
            }))
    )
}

async function trial(browser, sdk) {
    let documentNumber = 0
    let recoverAt = Infinity
    const rejected = []
    const accepted = []
    const errors = []
    const server = createServer((request, response) => {
        async function handle() {
            const pathname = new URL(request.url, 'http://localhost').pathname
            if (pathname === '/') return response.end(pageHTML(++documentNumber))
            if (pathname === '/sdk.js') {
                response.setHeader('content-type', 'application/javascript')
                return response.end(sdk)
            }
            if (pathname === '/s/') {
                const events = await snapshots(request)
                response.statusCode = Date.now() < recoverAt ? 503 : 200
                const received = response.statusCode === 503 ? rejected : accepted
                received.push(...events)
            }
            response.setHeader('content-type', 'application/json')
            response.end(JSON.stringify(pathname.includes('/config') ? config : {}))
        }
        handle().catch((error) => {
            errors.push(error)
            response.writeHead(500).end()
        })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const context = await browser.newContext()
    try {
        const page = await context.newPage()
        const origin = 'http://127.0.0.1:' + server.address().port
        await context.route('**/*', (route) =>
            new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
        )
        await page.goto(origin)
        assert.ok(await page.evaluate(() => 'onpageswap' in window), 'Use Chrome with pageswap support')
        await page.waitForFunction(() => window.posthog?.sessionRecordingStarted())
        await page.mouse.click(25, 10)
        const deadline = Date.now() + 25000
        const firstPage = (event) => event.document.includes('fixture-document-1')
        while (!rejected.some(firstPage) && !errors.length && Date.now() < deadline) await delay(100)
        if (errors.length) throw errors[0]
        const original = rejected.find(firstPage)
        assert.ok(original?.uuid, 'Receiver must reject a real first-page snapshot before reload')
        recoverAt = Date.now() + 2000
        await delay(250)
        await page.reload()
        await page.waitForFunction(() => window.posthog?.sessionRecordingStarted())
        await page.mouse.click(25, 10)
        await delay(20000)
        if (errors.length) throw errors[0]
        assert.ok(
            accepted.some((event) => event.document.includes('fixture-document-2')),
            'Receiver must recover and accept the new page'
        )
        const old = accepted.filter(firstPage)
        assert.ok(
            old.every((event) => event.uuid === original.uuid),
            'Recovered snapshot must retain its UUID'
        )
        return old.length
    } finally {
        await context.close()
        server.closeAllConnections()
        const closed = once(server, 'close')
        server.close()
        await closed
    }
}

const browser = await chromium.launch({ channel: 'chrome' })
try {
    for (const [label, ref, expected] of [
        ['main', process.argv[2] ?? 'origin/main', 0],
        ['PR', 'HEAD', 1],
    ]) {
        const { revision, sdk } = await bundleRevision(ref)
        const acceptedOld = await trial(browser, sdk)
        process.stdout.write(`${label} ${revision.slice(0, 8)} acceptedOld=${acceptedOld}\n`)
        assert.equal(acceptedOld, expected, `Unexpected original snapshot delivery on ${label}`)
    }
} finally {
    await browser.close()
}
