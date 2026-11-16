import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { gzipSync } from 'node:zlib'
import { createMockServer, buildConfigResponse, buildFlagsResponse } from '@posthog-tooling/sdk-mock-server'

async function start(t, options) {
    const server = createMockServer(options)
    const origin = await server.start()
    t.after(() => server.stop())
    return { server, origin }
}

async function json(origin, path, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(origin + path, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
    return { status: response.status, headers: response.headers, body: await response.json() }
}

async function until(predicate) {
    const deadline = Date.now() + 2000
    while (!predicate()) {
        assert.ok(Date.now() < deadline, 'Timed out waiting for server evidence')
        await sleep(5)
    }
}

const events = [
    { event: 'first', distinct_id: 'person', uuid: 'uuid-1', properties: { retained: [2, 1], nil: null } },
    { event: 'second', distinct_id: 'person', uuid: 'uuid-2', properties: {} },
]

test('isolated lifecycle, deep control merge, reset and capture clearing', async (t) => {
    const first = await start(t, { state: { projectToken: 'first', flags: { custom: true } }, barriers: ['config'] })
    const second = await start(t)
    assert.notEqual(first.origin, second.origin)
    assert.equal(await first.server.start(), first.origin)
    const patched = await json(first.origin, '/__control/state', {
        flags: { custom: false },
        delays: { flags: 0.01 },
        sessionReplayEnabled: false,
    })
    assert.equal(patched.body.flags.custom, false)
    assert.equal(patched.body.flags['bool-value'], undefined)
    assert.equal(patched.body.delays.batch, 0)
    assert.equal(second.server.getState().sessionReplayEnabled, true)
    first.server.releaseBarrier('config')
    assert.equal((await json(first.origin, '/array/first/config')).body.sessionRecording, false)
    await json(first.origin, '/batch/', { batch: events })
    assert.deepEqual((await json(first.origin, '/__captured/events?since=1')).body, [events[1]])
    assert.deepEqual(first.server.inspect().events, events)
    assert.equal(second.server.inspect().events.length, 0)
    assert.equal((await json(first.origin, '/__captured/all')).body.requests.length, 2)
    await json(first.origin, '/__captured', undefined, 'DELETE')
    assert.equal(first.server.inspect().events.length, 0)
    assert.equal(first.server.getState().sessionReplayEnabled, false)
    await json(first.origin, '/__control/reset', {})
    assert.equal(first.server.getState().sessionReplayEnabled, true)
    assert.equal(first.server.getState().projectToken, 'first')
    assert.equal(first.server.getState().flags.custom, true)
    assert.deepEqual(first.server.barriers(), { config: false })
    assert.equal(first.server.inspect().requests.length, 0)
    const copy = first.server.getState()
    copy.flags.custom = 'mutated'
    assert.equal(first.server.getState().flags.custom, true)
    assert.equal((await json(first.origin, '/__control/state', [])).status, 400)
    await first.server.stop()
    await first.server.stop()
    await assert.rejects(first.server.start(), /stopped/)
    await assert.rejects(fetch(first.origin + '/__control/state'))
})

test('Python-shaped remote config, replay knobs, flags payloads, quota and forced errors', async (t) => {
    const { server, origin } = await start(t)
    const config = (await json(origin, '/array/phc_MOCK/config')).body
    assert.deepEqual(config, {
        token: 'phc_MOCK',
        supportedCompression: ['gzip', 'gzip-js'],
        captureDeadClicks: true,
        capturePerformance: { network_timing: true, web_vitals: true, web_vitals_allowed_metrics: null },
        autocapture_opt_out: false,
        analytics: { endpoint: '/i/v0/e/' },
        elementsChainAsString: true,
        sessionRecording: { endpoint: '/s/' },
        heatmaps: true,
        surveys: false,
        defaultIdentifiedOnly: true,
        siteApps: [],
        errorTracking: { autocaptureExceptions: true },
        hasFeatureFlags: true,
    })
    server.updateState({
        linkedFlag: 'gate',
        sampleRate: 0.5,
        eventTriggers: ['go'],
        minimumDurationMilliseconds: 123,
        hasFeatureFlags: null,
        flags: { variant: 'blue', nested: { values: [1, 2] } },
    })
    const flags = await json(origin, '/flags/?v=2', { distinct_id: 'p', groups: { company: 'one' } })
    assert.deepEqual(flags.body.sessionRecording, {
        endpoint: '/s/',
        linkedFlag: 'gate',
        sampleRate: '0.5',
        eventTriggers: ['go'],
        minimumDurationMilliseconds: 123,
    })
    assert.equal(flags.body.featureFlagPayloads.variant, '"blue"')
    assert.equal(flags.body.featureFlagPayloads.nested, '{"values":[1,2]}')
    assert.equal(flags.body.featureFlagPayloads['bool-value'], undefined)
    assert.match(flags.body.requestId, /^[a-f0-9-]{36}$/)
    assert.equal(typeof flags.body.evaluatedAt, 'number')
    assert.equal(Object.hasOwn(buildConfigResponse(server.getState()), 'hasFeatureFlags'), false)
    server.updateState({ flagsQuotaLimited: true })
    assert.deepEqual(buildFlagsResponse(server.getState()), { quotaLimited: ['feature_flags'] })
    assert.deepEqual((await json(origin, '/decide/', {})).body, { quotaLimited: ['feature_flags'] })
    server.updateState({ force500: { flags: true, config: true, batch: true, snapshot: true, logs: true } })
    for (const [path, body] of [
        ['/flags', {}],
        ['/batch', { batch: events }],
        ['/s/', events],
        ['/i/v1/logs', { resourceLogs: [] }],
        ['/array/p/config', undefined],
    ]) {
        const forced = await json(origin, path, body)
        assert.equal(forced.status, 500)
        assert.deepEqual(forced.body, { status: 'forced_500' })
    }
    assert.deepEqual(server.inspect().events, events)
    assert.deepEqual(server.inspect().snapshots, events)
    assert.deepEqual(server.inspect().logs, [{ resourceLogs: [] }])
    assert.equal(server.inspect().flags_calls.length, 3)
    assert.equal(server.inspect().config_calls.length, 2)
})

test('config script and survey fixture response remain configurable without SDK imports', async (t) => {
    const survey = { id: 'fixture-survey', questions: [{ type: 'open', question: 'Hello?' }] }
    const { server, origin } = await start(t, {
        state: {
            projectToken: 'ph_fixture',
            surveysEnabled: true,
            surveys: [survey],
            configOverrides: {
                supportedCompression: [],
                logs: { captureConsoleLogs: true },
                analytics: { endpoint: '/e/' },
            },
            flagsOverrides: { requestId: 'fixed', evaluatedAt: 1704067200 },
        },
    })
    const script = await fetch(origin + '/array/ph_fixture/config.js')
    assert.match(script.headers.get('content-type'), /javascript/)
    const window = {}
    runInNewContext(await script.text(), { window })
    const config = JSON.parse(JSON.stringify(window._POSTHOG_REMOTE_CONFIG.ph_fixture.config))
    assert.deepEqual(config, buildConfigResponse(server.getState()))
    assert.deepEqual(config.surveys, [survey])
    assert.deepEqual((await json(origin, '/api/surveys/')).body, { surveys: [survey] })
    assert.equal((await json(origin, '/flags', {})).body.requestId, 'fixed')
})

const envelope = { batch: events, sent_at: '2025-01-01T00:00:00Z' }
const text = JSON.stringify(envelope)
const formBase64 = new URLSearchParams({ data: Buffer.from(text).toString('base64') }).toString()
const wires = [
    { name: 'plain JSON', body: text, wrapper: 'json', headers: { 'content-type': 'application/json' } },
    { name: 'gzip header', body: gzipSync(text), wrapper: 'gzip', headers: { 'content-encoding': 'gzip' } },
    { name: 'gzip magic', body: gzipSync(text), wrapper: 'gzip', headers: {} },
    { name: 'gzip-js query', body: gzipSync(text), wrapper: 'gzip', query: '?compression=gzip-js', headers: {} },
    { name: 'gzip query', body: gzipSync(text), wrapper: 'gzip', query: '?compression=gzip', headers: {} },
    {
        name: 'base64 form',
        body: formBase64,
        wrapper: 'form-base64',
        query: '?compression=base64',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
    },
    {
        name: 'legacy base64 form',
        body: formBase64,
        wrapper: 'form-base64',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
    },
    { name: 'Beacon base64 data', body: formBase64, wrapper: 'form-base64', headers: { 'content-type': 'text/plain' } },
    {
        name: 'url-encoded JSON',
        body: new URLSearchParams({ data: text }).toString(),
        wrapper: 'form-json',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
    },
    {
        name: 'base64 body',
        body: Buffer.from(text).toString('base64'),
        wrapper: 'base64',
        query: '?compression=base64',
        headers: {},
    },
]
for (const wire of wires) {
    test(`decode ${wire.name} with exact raw request evidence`, async (t) => {
        const { server, origin } = await start(t)
        const response = await fetch(origin + '/i/v0/e/' + (wire.query ?? ''), {
            method: 'POST',
            headers: wire.headers,
            body: wire.body,
        })
        assert.deepEqual(await response.json(), { status: 1 })
        assert.deepEqual(server.inspect().events, events)
        const [record] = server.inspect().requests
        assert.deepEqual(record.body, envelope)
        assert.equal(record.rawBodyBase64, Buffer.from(wire.body).toString('base64'))
        assert.equal(record.rawBody, Buffer.from(wire.body).toString('utf8'))
        assert.equal(record.bodyWrapper, wire.wrapper)
        assert.equal(record.status, 200)
        assert.equal(record.responseFinished, true)
        const copy = server.inspect()
        copy.events[0].event = 'changed'
        assert.equal(server.inspect().events[0].event, 'first')
    })
}

test('chunked gzip ingestion, all consumed analytics aliases, replay and OTLP retain complete ordered bodies', async (t) => {
    const { server, origin } = await start(t)
    const bytes = gzipSync(text)
    await new Promise((resolve, reject) => {
        const req = httpRequest(
            origin + '/batch/',
            { method: 'POST', headers: { 'content-encoding': 'gzip' } },
            (response) => {
                assert.equal(response.statusCode, 200)
                response.resume()
                response.on('end', resolve)
            }
        )
        req.on('error', reject)
        req.write(bytes.subarray(0, 12))
        req.end(bytes.subarray(12))
    })
    assert.equal(server.inspect().requests[0].headers['transfer-encoding'], 'chunked')
    assert.equal(server.inspect().requests[0].rawBodyBase64, bytes.toString('base64'))
    for (const path of ['/e', '/e/', '/i/v0/e', '/i/v0/e/', '/batch', '/batch/']) {
        await json(origin, path, path === '/batch' ? { batch: events } : events)
    }
    assert.equal(server.inspect().events.length, 14)
    const replay = [
        {
            event: '$snapshot',
            properties: { $session_id: 'session', $snapshot_data: [{ type: 2, data: { nested: [3, 1] } }] },
        },
    ]
    for (const path of ['/s', '/s/', '/newS', '/newS/']) await json(origin, path, replay)
    assert.deepEqual(server.inspect().snapshots, [...replay, ...replay, ...replay, ...replay])
    const logs = {
        resourceLogs: [
            { scopeLogs: [{ logRecords: [{ body: { stringValue: 'hello' } }, { body: { stringValue: 'second' } }] }] },
        ],
    }
    await json(origin, '/i/v1/logs?token=fixture', logs)
    assert.deepEqual(server.inspect().logs, [logs])
    assert.deepEqual(server.inspect().requests.at(-1).body, logs)
    assert.deepEqual(server.inspect().requests.at(-1).query, { token: ['fixture'] })
})

test('Capture V1 native endpoint acknowledges UUIDs and retains its auth, timing headers and wire envelope', async (t) => {
    const { server, origin } = await start(t)
    const native = {
        created_at: '2025-01-01T00:00:00Z',
        batch: events.map((event) => ({
            ...event,
            options: { process_person_profile: true },
            session_id: 'session',
            window_id: 'window',
            timestamp: '2025-01-01T00:00:00Z',
        })),
    }
    const raw = JSON.stringify(native)
    const response = await fetch(origin + '/i/v1/analytics/events', {
        method: 'POST',
        headers: {
            authorization: 'Bearer ph_fixture',
            'content-type': 'application/json',
            'posthog-attempt': '1',
            'posthog-request-id': 'request-id',
            'posthog-request-timestamp': '2025-01-01T00:00:00Z',
            'posthog-sdk-info': 'posthog-js/fixture',
        },
        body: raw,
    })
    assert.deepEqual(await response.json(), { results: { 'uuid-1': { result: 'ok' }, 'uuid-2': { result: 'ok' } } })
    const [request] = server.inspect().requests
    assert.equal(request.path, '/i/v1/analytics/events')
    assert.equal(request.headers.authorization, 'Bearer ph_fixture')
    assert.equal(request.headers['posthog-attempt'], '1')
    assert.equal(request.headers['posthog-request-id'], 'request-id')
    assert.equal(request.headers['posthog-request-timestamp'], '2025-01-01T00:00:00Z')
    assert.equal(request.headers['posthog-sdk-info'], 'posthog-js/fixture')
    assert.equal(request.headers['content-encoding'], undefined)
    assert.equal(request.rawBody, raw)
    assert.deepEqual(request.body, native)
    assert.deepEqual(server.inspect().events, native.batch)
    server.clearCaptured()
    const gzipped = gzipSync(raw)
    await fetch(origin + '/i/v1/analytics/events', {
        method: 'POST',
        headers: { 'content-encoding': 'gzip' },
        body: gzipped,
    })
    assert.deepEqual(server.inspect().requests[0].body, native)
    assert.equal(server.inspect().requests[0].rawBodyBase64, gzipped.toString('base64'))
})

test('endpoint response barriers expose pending requests and read live state only after release', async (t) => {
    const { server, origin } = await start(t, { barriers: ['flags'] })
    let finished = false
    const pending = json(origin, '/flags/', { distinct_id: 'person' }).then((value) => {
        finished = true
        return value
    })
    await until(() => server.inspect().blockedRequests.length === 1)
    const record = server.inspect().requests[0]
    assert.equal(record.status, null)
    assert.equal(record.responseFinished, false)
    assert.equal(finished, false)
    assert.equal(server.inspect().flags_calls.length, 0)
    assert.deepEqual(server.inspect().blockedRequests[0], {
        id: record.id,
        method: 'POST',
        path: '/flags/',
        barrier: 'flags',
    })
    await json(origin, '/__control/state', { flags: { 'compat-variant': 'blue' } })
    assert.equal((await json(origin, '/__control/barriers')).body.flags, false)
    await json(origin, '/__control/release', { barriers: ['flags'] })
    assert.equal((await pending).body.featureFlags['compat-variant'], 'blue')
    assert.equal(server.inspect().blockedRequests.length, 0)
    assert.equal(server.inspect().requests[0].responseFinished, true)
    assert.equal((await json(origin, '/__control/release', { barriers: [1] })).status, 400)
})

test('SDK adapter owns page/CDN assets, sharing response holds, status faults and request recording', async (t) => {
    const { server, origin } = await start(t, {
        barriers: ['extensions'],
        adapter: async (request, context) => {
            if (request.path === '/') return { body: '<h1>Fixture</h1>', headers: { 'Content-Type': 'text/html' } }
            if (request.path.startsWith('/static/')) {
                await context.waitForBarrier('extensions')
                return request.path.includes('/version/')
                    ? { status: 404, json: { error: 'Controlled fallback' } }
                    : { body: 'window.fixture = true', headers: { 'Content-Type': 'text/javascript' } }
            }
        },
        respond: (endpoint, request, response, state) =>
            endpoint === 'flags'
                ? {
                      ...response,
                      json: { ...response.json, ...buildConfigResponse(state), requestId: request.body.distinct_id },
                  }
                : response,
    })
    assert.equal(await (await fetch(origin + '/')).text(), '<h1>Fixture</h1>')
    const pending = fetch(origin + '/static/version/surveys.js')
    await until(() => server.inspect().blockedRequests.length === 1)
    assert.equal(server.inspect().blockedRequests[0].barrier, 'extensions')
    server.releaseBarrier('extensions')
    assert.equal((await pending).status, 404)
    assert.equal(await (await fetch(origin + '/static/surveys.js')).text(), 'window.fixture = true')
    assert.deepEqual(
        server.inspect().requests.map(({ path, status }) => [path, status]),
        [
            ['/', 200],
            ['/static/version/surveys.js', 404],
            ['/static/surveys.js', 200],
        ]
    )
    const flags = await json(origin, '/flags', { distinct_id: 'fixed-id' })
    assert.equal(flags.body.requestId, 'fixed-id')
    assert.deepEqual(flags.body.analytics, { endpoint: '/i/v0/e/' })
})

test('reset cancels held requests and delays without resurrecting capture or errors', async (t) => {
    const { server, origin } = await start(t, { barriers: ['flags'], state: { delays: { batch: 60 } } })
    const held = json(origin, '/flags', {})
    const delayed = json(origin, '/batch', { batch: events })
    await until(() => server.inspect().requests.length === 2 && server.inspect().blockedRequests.length === 1)
    server.reset()
    assert.equal((await held).status, 503)
    assert.equal((await delayed).status, 503)
    assert.deepEqual(server.inspect(), {
        events: [],
        snapshots: [],
        logs: [],
        flags_calls: [],
        config_calls: [],
        requests: [],
        blockedRequests: [],
        errors: [],
    })
    assert.deepEqual(server.barriers(), { flags: false })
    server.updateState({ delays: { batch: 0 } })
    await json(origin, '/batch', { batch: events })
    assert.deepEqual(server.inspect().events, events)
})

test('stop closes active held sockets and cancels their waiters promptly', async (t) => {
    const { server, origin } = await start(t, { barriers: ['flags'] })
    const outcome = fetch(origin + '/flags', { method: 'POST', body: '{}' }).then(
        () => 'completed',
        () => 'closed'
    )
    await until(() => server.inspect().blockedRequests.length === 1)
    await server.stop()
    assert.equal(await outcome, 'closed')
    assert.equal(server.inspect().blockedRequests.length, 0)
    assert.equal(server.inspect().errors.length, 0)
})

test('client disconnect removes a held-response waiter', async (t) => {
    const { server, origin } = await start(t, { barriers: ['config'] })
    const abort = new AbortController()
    const outcome = fetch(origin + '/array/p/config', { signal: abort.signal }).catch(() => undefined)
    await until(() => server.inspect().blockedRequests.length === 1)
    abort.abort()
    await outcome
    await until(() => server.inspect().blockedRequests.length === 0)
    assert.equal(server.inspect().errors.length, 0)
})

test('barrier timeout and decoder failures are visible, never silently accepted as events', async (t) => {
    const { server, origin } = await start(t, { barriers: ['flags'], barrierTimeoutMs: 20 })
    const timeout = await json(origin, '/flags', {})
    assert.equal(timeout.status, 400)
    assert.match(timeout.body.error, /Barrier timed out: flags/)
    assert.equal(server.inspect().blockedRequests.length, 0)
    const invalid = [
        { body: 'not json' },
        { body: 'data=not-base64', headers: { 'content-type': 'application/x-www-form-urlencoded' } },
        { body: 'bad gzip', headers: { 'content-encoding': 'gzip' } },
        { body: '{}', query: '?compression=unknown' },
        { body: '{}', headers: { 'content-encoding': 'br' } },
    ]
    for (const wire of invalid) {
        const response = await fetch(origin + '/e/' + (wire.query ?? ''), {
            method: 'POST',
            body: wire.body,
            headers: wire.headers,
        })
        assert.equal(response.status, 400)
        assert.ok((await response.json()).error)
        assert.equal(server.inspect().requests.at(-1).rawBody, wire.body)
        assert.ok(server.inspect().requests.at(-1).decodeError)
    }
    assert.equal(server.inspect().errors.length, 6)
    assert.equal(server.inspect().events.length, 0)
})

test('CORS preflight echoes requested headers; unknown routes and proxy destinations are inspectable failures', async (t) => {
    const { server, origin } = await start(t)
    const preflight = await fetch(origin + '/i/v1/analytics/events', {
        method: 'OPTIONS',
        headers: { 'Access-Control-Request-Headers': 'authorization,content-encoding' },
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'authorization,content-encoding')
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*')
    assert.match(preflight.headers.get('access-control-allow-methods'), /POST/)
    assert.equal(await preflight.text(), '')
    assert.equal((await json(origin, '/unknown')).status, 404)
    const blocked = await new Promise((resolve, reject) => {
        const req = httpRequest(
            origin,
            { path: 'http://external.invalid/', headers: { Host: 'external.invalid' } },
            (response) => {
                response.resume()
                response.on('end', () => resolve(response.statusCode))
            }
        )
        req.on('error', reject)
        req.end()
    })
    assert.equal(blocked, 403)
    const target = new URL(origin)
    const connectResponse = await new Promise((resolve, reject) => {
        const socket = connect(Number(target.port), target.hostname, () =>
            socket.write('CONNECT external.invalid:443 HTTP/1.1\r\nHost: external.invalid:443\r\n\r\n')
        )
        let data = ''
        socket.on('data', (bytes) => {
            data += bytes.toString()
        })
        socket.on('end', () => resolve(data))
        socket.on('error', reject)
    })
    assert.match(connectResponse, /403 Forbidden/)
    assert.deepEqual(server.inspect().errors, [
        'Unexpected GET: /unknown',
        'Blocked proxy destination: external.invalid',
        'Blocked proxy CONNECT: external.invalid:443',
    ])
    assert.equal(server.inspect().requests[0].status, 404)
})

test('concurrent gate waiters release together without affecting another server', async (t) => {
    const first = await start(t, { barriers: ['flags'] })
    const second = await start(t, { barriers: ['flags'] })
    const firstRequests = [
        json(first.origin, '/flags', { distinct_id: 'one' }),
        json(first.origin, '/flags', { distinct_id: 'two' }),
    ]
    let secondFinished = false
    const secondRequest = json(second.origin, '/flags', { distinct_id: 'other' }).then((value) => {
        secondFinished = true
        return value
    })
    await until(
        () =>
            first.server.inspect().blockedRequests.length === 2 && second.server.inspect().blockedRequests.length === 1
    )
    first.server.releaseBarrier('flags')
    assert.deepEqual(
        (await Promise.all(firstRequests)).map(({ status }) => status),
        [200, 200]
    )
    assert.equal(first.server.inspect().blockedRequests.length, 0)
    assert.equal(secondFinished, false)
    assert.equal(second.server.inspect().flags_calls.length, 0)
    second.server.releaseBarrier('flags')
    assert.equal((await secondRequest).status, 200)
    assert.equal(second.server.inspect().flags_calls.length, 1)
})

test('response override supports native per-event outcomes and HTTP Retry-After faults', async (t) => {
    let attempt = 0
    const { server, origin } = await start(t, {
        respond: (endpoint, request, response) => {
            if (endpoint !== 'captureV1') return response
            if (++attempt === 1)
                return { status: 429, headers: { 'Retry-After': '3' }, json: { error: 'Controlled rate limit' } }
            return {
                json: {
                    results: {
                        [request.body.batch[0].uuid]: { result: 'retry', details: 'Controlled retry' },
                        [request.body.batch[1].uuid]: { result: 'drop', details: 'Controlled drop' },
                    },
                },
            }
        },
    })
    const fault = await json(origin, '/i/v1/analytics/events', envelope)
    assert.equal(fault.status, 429)
    assert.equal(fault.headers.get('retry-after'), '3')
    assert.deepEqual((await json(origin, '/i/v1/analytics/events', envelope)).body, {
        results: {
            'uuid-1': { result: 'retry', details: 'Controlled retry' },
            'uuid-2': { result: 'drop', details: 'Controlled drop' },
        },
    })
    assert.deepEqual(server.inspect().events, [...events, ...events])
    assert.deepEqual(
        server.inspect().requests.map(({ status }) => status),
        [429, 200]
    )
    assert.deepEqual(server.inspect().errors, [])
})

test('reset during an incomplete upload cannot restore pre-reset request evidence', async (t) => {
    const { server, origin } = await start(t)
    let request
    const result = new Promise((resolve, reject) => {
        request = httpRequest(
            origin + '/e/',
            { method: 'POST', headers: { 'content-type': 'application/json', Expect: '100-continue' } },
            (response) => {
                response.resume()
                response.on('end', () => resolve(response.statusCode))
            }
        )
        request.on('error', reject)
        request.write('{')
    })
    // The interim response proves the server accepted this still-incomplete upload.
    await new Promise((resolve) => request.once('continue', resolve))
    server.reset()
    request.end('"event":"late"}')
    assert.equal(await result, 503)
    assert.equal(server.inspect().requests.length, 0)
    assert.equal(server.inspect().events.length, 0)
    assert.deepEqual(server.inspect().errors, [])
})
