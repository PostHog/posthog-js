/** Chromium controller. All capture bytes and retries belong to the built browser SDK. */
const express = require('express')
const { chromium } = require('playwright')
const { gunzipSync } = require('node:zlib')
const path = require('node:path')

function normalizeAllowedHarnessHost(rawHost) {
    const url = new URL(rawHost)
    if (
        url.protocol !== 'http:' ||
        !['localhost', '127.0.0.1', 'test-harness', 'host.docker.internal'].includes(url.hostname) ||
        url.username ||
        url.password
    ) {
        throw new Error('Unsupported harness host')
    }
    return url.origin
}

async function createAdapter() {
    const browser = await chromium.launch({ headless: true })
    let context
    let page
    let requests = []
    let completed = new Set()
    let sent = new Set()
    let observationError = null
    const observations = new Set()
    const app = express()
    app.use(express.json())
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><title>SDK compliance</title>'))
    app.get('/sdk.js', (_req, res) => res.sendFile(path.resolve(__dirname, '../../packages/browser/dist/array.js')))
    app.get('/health', (_req, res) =>
        res.json({
            sdk_name: 'posthog-js',
            sdk_version: require('../../packages/browser/package.json').version,
            adapter_version: '1.1.0',
            capabilities: ['capture_v0'],
        })
    )

    async function reset() {
        // Closing the isolated runtime cancels its timers; do not trigger SDK unload/beacon sends.
        if (context) await context.close()
        await Promise.allSettled(observations)
        context = page = undefined
        requests = []
        completed = new Set()
        sent = new Set()
        observationError = null
    }

    app.post('/init', async (req, res) => {
        const host = normalizeAllowedHarnessHost(req.body.host)
        await reset()
        context = await browser.newContext()
        page = await context.newPage()
        page.on('response', (response) => {
            const request = response.request()
            if (new URL(request.url()).pathname !== '/e/') return
            const observation = (async () => {
                const bytes = request.postDataBuffer()
                const encoding = new URL(request.url()).searchParams.get('compression')
                const contentType = request.headers()['content-type'] || ''
                let body
                if (encoding === 'gzip-js' || request.headers()['content-encoding'] === 'gzip')
                    body = JSON.parse(gunzipSync(bytes).toString())
                else if (contentType.includes('application/x-www-form-urlencoded')) {
                    body = JSON.parse(
                        Buffer.from(new URLSearchParams(bytes.toString()).get('data'), 'base64').toString()
                    )
                } else body = JSON.parse(bytes.toString())
                const events = body.batch || (Array.isArray(body) ? body : [body])
                const uuids = events.map((event) => event.uuid)
                const retry = Number(new URL(request.url()).searchParams.get('retry_count') || 0)
                const status = response.status()
                // Wait for the real response body so the SDK can process it. Never fulfill/intercept requests.
                await response.finished()
                requests.push({
                    timestamp_ms: request.timing().startTime,
                    status_code: status,
                    retry_attempt: retry,
                    event_count: events.length,
                    uuid_list: uuids,
                })
                if (status === 200 || (status >= 400 && status < 500) || retry >= 10) {
                    uuids.forEach((uuid) => completed.add(uuid))
                }
                if (status === 200) uuids.forEach((uuid) => sent.add(uuid))
            })().catch((error) => {
                observationError = error.message
            })
            observations.add(observation)
            observation.finally(() => observations.delete(observation))
        })
        // The harness mock has no CORS response headers. Exercise a first-party deployment.
        await page.goto(`${host}/`)
        await page.addScriptTag({ url: `http://127.0.0.1:${server.address().port}/sdk.js` })
        await page.evaluate(
            ({ api_key, host, flush_interval_ms, enable_compression }) => {
                window.captured = []
                window.posthog.init(api_key, {
                    api_host: host,
                    persistence: 'memory',
                    autocapture: false,
                    opt_out_useragent_filter: true,
                    capture_pageview: false,
                    capture_pageleave: false,
                    disable_session_recording: true,
                    disable_surveys: true,
                    advanced_disable_flags: true,
                    disable_external_dependency_loading: true,
                    disable_compression: enable_compression === undefined ? true : !enable_compression,
                    request_queue_config: { flush_interval_ms: flush_interval_ms ?? 500 },
                    before_send: (event) => {
                        window.captured.push(event.uuid)
                        return event
                    },
                })
            },
            { ...req.body, host }
        )
        res.json({ success: true })
    })

    app.post('/capture', async (req, res) => {
        if (!page) return res.status(400).json({ error: 'SDK not initialized' })
        if (!req.body.distinct_id || !req.body.event)
            return res.status(400).json({ error: 'distinct_id and event are required' })
        const uuid = await page.evaluate(({ distinct_id, event, properties, timestamp }) => {
            window.posthog.register({ distinct_id })
            // Do not pass an empty options object: that bypasses the SDK's default batching path.
            return window.posthog.capture(event, properties, timestamp ? { timestamp: new Date(timestamp) } : undefined)
                ?.uuid
        }, req.body)
        if (!uuid) return res.status(500).json({ error: 'SDK did not capture the event' })
        res.json({ success: true, uuid })
    })

    app.post('/flush', async (_req, res) => {
        if (!page) return res.status(400).json({ error: 'SDK not initialized' })
        const before = sent.size
        const deadline = Date.now() + 12000
        // There is no public blocking flush. Wait for terminal observed outcomes of every
        // captured UUID, not network idleness (which can mean a retry timer is pending).
        do {
            const captured = await page.evaluate(() => window.captured)
            if (!observationError && captured.every((uuid) => completed.has(uuid))) {
                return res.json({ success: true, events_flushed: sent.size - before })
            }
            await new Promise((resolve) => setTimeout(resolve, 25))
        } while (Date.now() < deadline && !observationError)
        res.status(504).json({
            success: false,
            events_flushed: sent.size - before,
            error:
                observationError ||
                'Native timer/retry drain not established within 12s; browser has no public blocking flush',
        })
    })
    app.get('/state', async (_req, res) => {
        const captured = page ? await page.evaluate(() => window.captured) : []
        res.json({
            pending_events: captured.filter((uuid) => !completed.has(uuid)).length,
            total_events_captured: captured.length,
            total_events_sent: sent.size,
            total_retries: requests.filter((request) => request.retry_attempt > 0).length,
            last_error: observationError,
            requests_made: requests,
        })
    })
    app.post('/reset', async (_req, res) => {
        await reset()
        res.json({ success: true })
    })
    app.use((error, _req, res, _next) => res.status(500).json({ success: false, error: error.message }))
    const server = app.listen(process.env.PORT || 8080)
    return {
        server,
        close: async () => {
            await reset()
            await browser.close()
            await new Promise((resolve) => server.close(resolve))
        },
    }
}

if (require.main === module) {
    createAdapter()
        .then(({ close }) => {
            process.on('SIGTERM', async () => {
                await close()
                process.exit(0)
            })
        })
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
module.exports = { createAdapter, normalizeAllowedHarnessHost }
