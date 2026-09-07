const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const http = require('node:http')
const { gunzipSync } = require('node:zlib')
const path = require('node:path')

for (const mode of ['v0', 'v1']) {
    test(`built Node ${mode}: native UUID, gzip, flags defaults and observed outcomes`, async (t) => {
        const port = process.env.NODE_TEST_ADAPTER_PORT || '18215'
        const host = `http://127.0.0.1:${process.env.NODE_TEST_MOCK_PORT || 19215}`
        let received = []
        let partial = false
        const mock = http.createServer(async (req, res) => {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const bytes = Buffer.concat(chunks)
            const body = JSON.parse((req.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes).toString())
            received.push({ url: req.url, body, headers: req.headers })
            res.setHeader('Content-Type', 'application/json')
            if (req.url.startsWith('/flags/')) return res.end(JSON.stringify({ featureFlags: { flag: true } }))
            if (partial && req.headers['posthog-attempt'] === '1') {
                return res.end(
                    JSON.stringify({
                        results: Object.fromEntries(
                            body.batch.map((event, i) => [event.uuid, { result: i === 0 ? 'ok' : 'retry' }])
                        ),
                    })
                )
            }
            res.end('{}')
        })
        await new Promise((resolve) => mock.listen(new URL(host).port, '127.0.0.1', resolve))
        t.after(() => new Promise((resolve) => mock.close(resolve)))
        const child = spawn(process.execPath, [path.join(__dirname, 'adapter.js')], {
            env: { ...process.env, PORT: port, POSTHOG_CAPTURE_MODE: mode },
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        t.after(async () => {
            child.kill()
            await once(child, 'exit')
        })
        let ready = false
        for (let i = 0; i < 100; i++) {
            try {
                ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok
            } catch {}
            if (ready) break
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
        assert.ok(ready, 'adapter started')
        const call = async (route, body) => {
            const response = await fetch(
                `http://127.0.0.1:${port}/${route}`,
                body === undefined
                    ? {}
                    : {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(body),
                      }
            )
            assert.equal(response.status, 200)
            return response.json()
        }
        await call('init', { api_key: 'test-key', host, flush_at: 100, flush_interval_ms: 0, enable_compression: true })
        const result = await call('capture', {
            distinct_id: 'person',
            event: 'generated',
            timestamp: '2025-01-02T05:04:05+02:00',
        })
        assert.match(result.uuid, /^[0-9a-f-]{36}$/)
        assert.equal((await call('flush', {})).events_flushed, 1)
        assert.equal(received[0].body.batch[0].uuid, result.uuid)
        assert.equal(received[0].body.batch[0].timestamp, '2025-01-02T03:04:05.000Z')
        assert.equal(received[0].headers['content-encoding'], 'gzip')
        assert.equal((await call('flush', {})).events_flushed, 0)
        let state = await call('state')
        assert.equal(state.total_events_captured, 1)
        assert.equal(state.total_events_sent, 1)
        assert.equal(state.pending_events, 0)
        assert.equal(state.requests_made[0].event_count, 1)

        await call('get_feature_flag', { key: 'flag', distinct_id: 'person' })
        assert.equal(received.find((request) => request.url.startsWith('/flags/')).body.geoip_disable, true)
        state = await call('state')
        assert.equal(state.total_events_captured, 2)
        assert.equal(state.requests_made.length, 2, 'flag request is not counted as capture')

        if (mode === 'v1') {
            received = []
            await call('init', {
                api_key: 'test-key',
                host,
                flush_at: 100,
                flush_interval_ms: 0,
                enable_compression: true,
            })
            partial = true
            await call('capture', { distinct_id: 'person', event: 'first' })
            await call('capture', { distinct_id: 'person', event: 'second' })
            assert.equal((await call('flush', {})).events_flushed, 2)
            state = await call('state')
            assert.equal(state.total_events_sent, 2)
            assert.equal(state.total_retries, 1)
            assert.deepEqual(
                state.requests_made.map((request) => request.event_count),
                [2, 1]
            )
            assert.deepEqual(
                state.requests_made.map((request) => request.retry_attempt),
                [0, 1]
            )
        }
        await call('reset', {})
    })
}
