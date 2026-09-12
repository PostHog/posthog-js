const assert = require('node:assert/strict')
const { test } = require('node:test')
const http = require('node:http')
const { createAdapter, normalizeAllowedHarnessHost } = require('./adapter')

test('harness origins retain their port and reject non-local destinations', () => {
    assert.equal(normalizeAllowedHarnessHost('http://127.0.0.1:19214/path'), 'http://127.0.0.1:19214')
    assert.throws(() => normalizeAllowedHarnessHost('https://127.0.0.1:19214'))
    assert.throws(() => normalizeAllowedHarnessHost('http://example.com:19214'))
    assert.throws(() => normalizeAllowedHarnessHost('http://user:password@localhost:19214'))
})

test('built Chromium SDK owns batching, timestamps, retry and terminal outcomes', async (t) => {
    process.env.PORT = process.env.BROWSER_TEST_ADAPTER_PORT || '18214'
    const host = `http://127.0.0.1:${process.env.BROWSER_TEST_MOCK_PORT || 19214}`
    let received = []
    let statuses = []
    const mock = http.createServer((req, res) => {
        let body = ''
        req.on('data', (chunk) => {
            body += chunk
        })
        req.on('end', () => {
            if (req.url.startsWith('/e/')) {
                received.push({ url: req.url, body: JSON.parse(body), headers: req.headers })
                res.writeHead(statuses.shift() || 200, { 'Content-Type': 'application/json' })
                res.end('{}')
            } else {
                res.writeHead(404, { 'Content-Type': 'text/html' })
                res.end('<!doctype html><title>first-party mock</title>')
            }
        })
    })
    await new Promise((resolve) => mock.listen(new URL(host).port, '127.0.0.1', resolve))
    t.after(() => new Promise((resolve) => mock.close(resolve)))
    const adapter = await createAdapter()
    t.after(() => adapter.close())
    const call = async (route, body) => {
        const response = await fetch(`http://127.0.0.1:${process.env.PORT}/${route}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
        })
        return { status: response.status, body: await response.json() }
    }
    const init = async () => {
        await call('reset')
        received = []
        statuses = []
        assert.equal((await call('init', { api_key: 'test-key', host, flush_interval_ms: 250 })).status, 200)
    }
    await init()
    const capture = await call('capture', { distinct_id: 'person', event: 'batched', properties: { kept: true } })
    assert.match(capture.body.uuid, /^[0-9a-f-]{36}$/)
    assert.equal((await call('flush')).status, 200)
    assert.equal(received.length, 1)
    assert.equal(received[0].headers['sec-fetch-site'], 'same-origin')
    assert.equal(received[0].body.batch[0].uuid, capture.body.uuid)
    assert.equal(received[0].body.batch[0].timestamp, undefined)
    assert.equal(typeof received[0].body.batch[0].offset, 'number')
    assert.equal(received[0].body.batch[0].properties.$current_url, host + '/')

    await init()
    await call('capture', {
        distinct_id: 'person',
        event: 'explicit-time',
        timestamp: '2025-01-02T05:04:05+02:00',
        properties: { original: '2025-01-02T05:04:05+02:00' },
    })
    assert.equal((await call('flush')).status, 200)
    assert.equal(received[0].body.batch[0].timestamp, '2025-01-02T03:04:05.000Z')
    assert.equal(received[0].body.batch[0].properties.original, '2025-01-02T05:04:05+02:00')

    await init()
    statuses = [503, 200]
    await call('capture', { distinct_id: 'person', event: 'retry' })
    assert.equal((await call('flush')).status, 200)
    assert.equal(received.length, 2)
    assert.equal(received[0].body.batch[0].uuid, received[1].body.batch[0].uuid)
    assert.match(received[1].url, /retry_count=1/)

    await init()
    statuses = [429]
    await call('capture', { distinct_id: 'person', event: 'terminal' })
    const terminal = await call('flush')
    assert.equal(terminal.status, 200)
    assert.equal(terminal.body.events_flushed, 0)
    assert.equal(received.length, 1)

    await init()
    statuses = Array(12).fill(503)
    await call('capture', { distinct_id: 'person', event: 'still-retrying' })
    const pending = await call('flush')
    assert.equal(pending.status, 504)
    assert.match(pending.body.error, /drain not established/)
})
