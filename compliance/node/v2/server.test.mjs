import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer, request as httpRequest } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { setImmediate } from 'node:timers/promises'
import { startServer, protocol } from './server.mjs'

const consumer = process.env.POSTHOG_NODE_CONSUMER
if (!consumer) throw new Error('Set POSTHOG_NODE_CONSUMER to an installed tarball consumer')

async function harness(t, options = {}) {
    const adapter = await startServer({ consumer, port: 0, ...options })
    t.after(() => adapter.close())
    const base = `http://127.0.0.1:${adapter.address.port}`
    const post = async (path, data, status = 200, origin = base) => {
        const response = await fetch(origin + '/v2/' + path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(data),
        })
        const body = await response.json()
        assert.equal(response.status, status, JSON.stringify(body))
        return body
    }
    let sequence = 0
    const allocate = (fixture_id = 'f', timeout_ms = 5000) =>
        post('fixtures/allocate', {
            fixture_id,
            case_id: 'test',
            profile_id: options.mode === 'v1' ? 'node-analytics-v1' : 'node-legacy',
            timeout_ms,
        })
    const invoke = async (route, args = {}, fixture_id = 'f', timeout_ms = 5000) =>
        (
            await post('invoke', {
                fixture_id,
                call_id: String(++sequence),
                route,
                args,
                timeout_ms,
            })
        ).completion
    const close = (fixture_id = 'f') => post('fixtures/close', { fixture_id, timeout_ms: 5000 })
    return { adapter, post, allocate, invoke, close }
}

for (const mode of ['v0', 'v1'])
    for (const format of ['cjs', 'esm']) {
        test(`public ${format}/${mode}: identify and alias deliver literal properties after flush`, async (t) => {
            const traffic = []
            const mock = createServer(async (request, response) => {
                let body = ''
                for await (const chunk of request) body += chunk
                traffic.push({ path: request.url, body: JSON.parse(body) })
                response.setHeader('content-type', 'application/json')
                response.end('{"status":1}')
            })
            mock.listen(0, '127.0.0.1')
            await once(mock, 'listening')
            t.after(
                () =>
                    new Promise((done) => {
                        mock.closeAllConnections()
                        mock.close(done)
                    })
            )
            const { post, allocate, invoke, close } = await harness(t, { mode, format })
            const negotiation = await post('negotiate', { protocol })
            assert.ok(negotiation.supported_routes.includes('/identify'))
            assert.ok(negotiation.supported_routes.includes('/alias'))
            await allocate()
            await invoke('/setup', {
                project_token: 'phc_test',
                config: {
                    host: `http://127.0.0.1:${mock.address().port}`,
                    compression: 'none',
                    flush_at: 20,
                    flush_interval_ms: 0,
                },
            })
            const set = {
                email: 'user@example.test',
                active: false,
                score: 0,
                note: null,
                preferences: { theme: 'dark' },
                tags: ['beta', 'team'],
                $set: { literal: true },
                $set_once: { literal: false },
                $anon_distinct_id: 'literal',
            }
            for (const [route, args, expectedEvent, distinctId] of [
                ['/identify', { distinct_id: 'user-123', set, disable_geoip: false }, '$identify', 'user-123'],
                [
                    '/alias',
                    { distinct_id: 'anon-123', alias: 'user-123', disable_geoip: false },
                    '$create_alias',
                    'anon-123',
                ],
            ]) {
                const count = traffic.length
                assert.deepEqual(await invoke(route, args), { kind: 'sdk', outcome: { kind: 'void' } })
                assert.equal(traffic.length, count)
                assert.deepEqual(await invoke('/flush'), { kind: 'sdk', outcome: { kind: 'void' } })
                assert.equal(traffic.length, count + 1)
                const request = traffic.at(-1)
                assert.ok(request.path.startsWith(mode === 'v0' ? '/batch' : '/i/v1/analytics/events'))
                assert.equal(request.body.batch.length, 1)
                const event = request.body.batch[0]
                assert.equal(event.event, expectedEvent)
                assert.equal(event.distinct_id, distinctId)
                assert.equal(event.properties.$geoip_disable, undefined)
                if (route === '/identify') assert.deepEqual(event.properties.$set, set)
                else assert.equal(event.properties.alias, 'user-123')
            }
            await close()
            assert.equal(traffic.length, 2)
        })

        test(`public ${format}/${mode}: capture, flush, local results and reload through HTTP`, async (t) => {
            const traffic = []
            let active = true
            const mock = createServer(async (request, response) => {
                let body = ''
                for await (const chunk of request) body += chunk
                traffic.push({ path: request.url, body, authorization: request.headers.authorization })
                response.setHeader('content-type', 'application/json')
                response.end(
                    JSON.stringify(
                        request.url.includes('definitions')
                            ? {
                                  flags: [
                                      {
                                          id: 1,
                                          key: 'flag',
                                          active,
                                          filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
                                      },
                                  ],
                                  group_type_mapping: {},
                                  cohorts: {},
                              }
                            : { status: 1 }
                    )
                )
            })
            mock.listen(0, '127.0.0.1')
            await once(mock, 'listening')
            t.after(
                () =>
                    new Promise((done) => {
                        mock.closeAllConnections()
                        mock.close(done)
                    })
            )
            const { post, allocate, invoke, close } = await harness(t, { mode, format })
            const negotiation = await post('negotiate', { protocol })
            assert.equal(negotiation.protocol, protocol)
            assert.deepEqual(negotiation.profiles[0].fixture_capabilities, ['storage.empty.v1'])
            await allocate()
            assert.deepEqual(
                await invoke('/setup', {
                    project_token: 'phc_test',
                    config: {
                        host: `http://127.0.0.1:${mock.address().port}`,
                        secret_key: 'phx_test',
                        compression: 'none',
                        flush_at: 100,
                        flush_interval_ms: 0,
                    },
                }),
                { kind: 'sdk', outcome: { kind: 'void' } }
            )
            assert.deepEqual(
                (
                    await invoke('/capture', {
                        event: 'slice',
                        distinct_id: 'person',
                        properties: { zero: 0, null: null, false: false },
                    })
                ).outcome,
                { kind: 'void' }
            )
            assert.deepEqual((await invoke('/flush')).outcome, { kind: 'void' })
            const capture = traffic.find(({ path }) => path.startsWith(mode === 'v0' ? '/batch' : '/i/v1/analytics'))
            assert.ok(capture)
            assert.ok(capture.body.includes('slice'))
            assert.deepEqual(
                (
                    await invoke('/get_feature_flag', {
                        key: 'flag',
                        distinct_id: 'person',
                        only_evaluate_locally: true,
                        send_event: false,
                    })
                ).outcome,
                { kind: 'value', value: true }
            )
            for (const value of [true, false, true]) {
                active = value
                assert.deepEqual((await invoke('/reload_feature_flags')).outcome, { kind: 'void' })
                assert.deepEqual(
                    (
                        await invoke('/get_feature_flag', {
                            key: 'flag',
                            distinct_id: 'person',
                            only_evaluate_locally: true,
                            send_event: false,
                        })
                    ).outcome,
                    { kind: 'value', value }
                )
            }
            assert.deepEqual(
                (
                    await invoke('/get_feature_flag', {
                        key: 'missing',
                        distinct_id: 'person',
                        only_evaluate_locally: true,
                        send_event: false,
                    })
                ).outcome,
                { kind: 'undefined' }
            )
            await close()
            assert.ok(traffic.filter(({ path }) => path.startsWith('/flags/definitions')).length >= 4)
            assert.equal(traffic.filter(({ path }) => /^\/(flags|decide)\/?(?:\?|$)/.test(path)).length, 0)
        })
    }

test('a single public local-only getter waits for delayed initial definitions', { timeout: 5000 }, async (t) => {
    const { PostHog } = createRequire(resolve(consumer, 'package.json'))('posthog-node')
    const traffic = []
    const firstDefinitions = Promise.withResolvers()
    const mock = createServer((request, response) => {
        traffic.push(request.url)
        response.setHeader('content-type', 'application/json')
        if (request.url.startsWith('/flags/definitions')) firstDefinitions.resolve(response)
        else response.end('{}')
    })
    mock.listen(0, '127.0.0.1')
    await once(mock, 'listening')
    const client = new PostHog('phc_test', {
        host: `http://127.0.0.1:${mock.address().port}`,
        secretKey: 'phx_test',
        flushInterval: 0,
    })
    let response = null
    t.after(async () => {
        if (response && !response.writableEnded) response.end('{"flags":[]}')
        await client.shutdown()
        mock.closeAllConnections()
        await new Promise((done) => mock.close(done))
    })

    // Hold the first HTTP response open before invoking the genuine public getter.
    response = await firstDefinitions.promise
    let settled = false
    const result = client.getFeatureFlag('flag', 'person', {
        onlyEvaluateLocally: true,
        sendFeatureFlagEvents: false,
    })
    result.then(
        () => {
            settled = true
        },
        () => {
            settled = true
        }
    )
    await setImmediate()
    assert.equal(settled, false, 'the getter must remain pending while definitions are withheld')
    response.end(
        JSON.stringify({
            flags: [
                {
                    id: 1,
                    key: 'flag',
                    active: true,
                    filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
                },
            ],
            group_type_mapping: {},
            cohorts: {},
        })
    )
    assert.equal(await result, true)
    await client.shutdown()
    assert.equal(traffic.filter((path) => path.startsWith('/flags/definitions')).length, 1)
    assert.equal(traffic.filter((path) => /^\/(flags|decide)\/?(?:\?|$)/.test(path)).length, 0)
})

test('transport errors remain non-200; SDK throws are completions and case IDs cannot be reused', async (t) => {
    const { post, allocate, invoke, close } = await harness(t)
    await post('negotiate', { protocol: 'obsolete' }, 400)
    await post(
        'fixtures/allocate',
        { fixture_id: 'bad', case_id: 'test', profile_id: 'node-legacy', timeout_ms: 60001 },
        400
    )
    await post('invoke', { fixture_id: 'missing', call_id: 'x', route: '/flush', args: {}, timeout_ms: 1000 }, 400)
    await allocate()
    await post(
        'fixtures/allocate',
        { fixture_id: 'f', case_id: 'test', profile_id: 'node-legacy', timeout_ms: 1000 },
        400
    )
    const data = {
        fixture_id: 'f',
        call_id: 'explicit',
        route: '/setup',
        args: { project_token: 'test', config: null },
        timeout_ms: 1000,
    }
    assert.equal((await post('invoke', data)).completion.outcome.kind, 'thrown')
    await post('invoke', data, 400)
    assert.equal((await invoke('/setup', { project_token: 'test' })).outcome.kind, 'void')
    assert.equal((await invoke('/unknown')).failure.kind, 'unsupported_binding')
    await close()
    await post('invoke', { ...data, call_id: 'after-close' }, 400)
})

test('one IPv6 wildcard listener advertises the same ephemeral port for both families', async (t) => {
    const { adapter, post } = await harness(t, { host: '::' })
    for (const host of ['127.0.0.1', '[::1]', 'localhost']) {
        assert.equal(
            (await post('negotiate', { protocol }, 200, `http://${host}:${adapter.address.port}`)).protocol,
            protocol
        )
    }
})

test('DNS localhost with an ephemeral port is reachable using its bound address', async (t) => {
    const { adapter, post } = await harness(t, { host: 'localhost' })
    const address = adapter.address.family === 'IPv6' ? `[${adapter.address.address}]` : adapter.address.address
    await post('negotiate', { protocol }, 200, `http://${address}:${adapter.address.port}`)
    await post('negotiate', { protocol }, 200, `http://localhost:${adapter.address.port}`)
})

// Controlled public SDK stand-in exercises infrastructure failures, not conformance.
async function controlledConsumer(t, source) {
    const root = await mkdtemp(join(tmpdir(), 'node-adapter-test-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    await mkdir(join(root, 'node_modules/posthog-node'), { recursive: true })
    await writeFile(join(root, 'package.json'), '{}')
    await writeFile(
        join(root, 'node_modules/posthog-node/package.json'),
        JSON.stringify({ name: 'posthog-node', main: 'index.cjs' })
    )
    await writeFile(join(root, 'node_modules/posthog-node/index.cjs'), source)
    return root
}

test('raw JSON numbers are translated losslessly or blocked before an SDK call', async (t) => {
    const root = await controlledConsumer(
        t,
        `exports.PostHog = class { calls = 0; getFeatureFlag(key) { return { key, calls: ++this.calls } } shutdown() {} }`
    )
    const { adapter, allocate, invoke } = await harness(t, { consumer: root })
    await allocate()
    await invoke('/setup', { project_token: 'test' })
    const raw = async (token) => {
        const response = await fetch(`http://127.0.0.1:${adapter.address.port}/v2/invoke`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: `{"fixture_id":"f","call_id":"raw-${token}","route":"/get_feature_flag","args":{"key":${token}},"timeout_ms":5000}`,
        })
        assert.equal(response.status, 200)
        return (await response.json()).completion
    }
    for (const token of [
        '9007199254740993',
        '9007199254740992',
        '1.0000000000000001',
        '-0',
        '-0.0',
        '1e-999',
        '1e400',
    ]) {
        const result = await raw(token)
        assert.equal(result.kind, 'harness')
        assert.equal(result.failure.kind, 'blocked_fixture')
        assert.equal(result.failure.code, 'number-representation')
    }
    let calls = 0
    for (const token of ['1e0', '0.125', '1200.0', '1e-7', '-12.5', '0e123']) {
        assert.deepEqual(await raw(token), {
            kind: 'sdk',
            outcome: { kind: 'value', value: { key: Number(token), calls: ++calls } },
        })
    }
})

test('a hung invocation is killed, cannot run later calls, and does not contaminate another case', async (t) => {
    const root = await controlledConsumer(
        t,
        `exports.PostHog = class { flush() { while (true) {} } shutdown() {} getFeatureFlag() { return false } }`
    )
    const { post, allocate, invoke, close } = await harness(t, { consumer: root })
    await allocate()
    await invoke('/setup')
    const before = Date.now()
    await post('invoke', { fixture_id: 'f', call_id: 'hang', route: '/flush', args: {}, timeout_ms: 50 }, 400)
    assert.ok(Date.now() - before < 2000)
    await post(
        'invoke',
        { fixture_id: 'f', call_id: 'late', route: '/get_feature_flag', args: {}, timeout_ms: 1000 },
        400
    )
    await allocate('fresh')
    await invoke('/setup', {}, 'fresh')
    assert.deepEqual((await invoke('/get_feature_flag', {}, 'fresh')).outcome, { kind: 'value', value: false })
    await close('fresh')
})

test('closing a case prevents its lingering timers from emitting later traffic', async (t) => {
    let requests = 0
    const mock = createServer((_request, response) => {
        requests++
        response.end('{}')
    })
    mock.listen(0, '127.0.0.1')
    await once(mock, 'listening')
    t.after(() => new Promise((done) => mock.close(done)))
    const root = await controlledConsumer(
        t,
        `exports.PostHog = class {
        constructor(token, options) { this.host = options.host }
        capture() { setTimeout(() => fetch(this.host), 150) }
        shutdown() {}
    }`
    )
    const { allocate, invoke, close } = await harness(t, { consumer: root })
    await allocate()
    await invoke('/setup', { project_token: 'test', config: { host: `http://127.0.0.1:${mock.address().port}` } })
    await invoke('/capture', { event: 'late', distinct_id: 'person' })
    await close()
    await new Promise((done) => setTimeout(done, 200))
    assert.equal(requests, 0)
})

test('bounded shutdown failures are not successful close', async (t) => {
    for (const shutdown of ['throw new Error("shutdown")', 'return new Promise(() => {})']) {
        const root = await controlledConsumer(t, `exports.PostHog = class { shutdown() { ${shutdown} } }`)
        const { post, allocate, invoke } = await harness(t, { consumer: root })
        await allocate()
        await invoke('/setup')
        await post('fixtures/close', { fixture_id: 'f', timeout_ms: 50 }, 400)
    }
})

test('UTF-8 split across HTTP chunks reaches the public method unchanged', async (t) => {
    const root = await controlledConsumer(
        t,
        `exports.PostHog = class { getFeatureFlag(key) { return key } shutdown() {} }`
    )
    const { adapter, allocate, invoke } = await harness(t, { consumer: root })
    await allocate()
    await invoke('/setup')
    const value = 'é💡'
    const bytes = Buffer.from(
        JSON.stringify({
            fixture_id: 'f',
            call_id: 'unicode',
            route: '/get_feature_flag',
            args: { key: value },
            timeout_ms: 1000,
        })
    )
    const split = bytes.indexOf(Buffer.from(value)) + 1
    const result = await new Promise((resolve, reject) => {
        const request = httpRequest(
            { hostname: '127.0.0.1', port: adapter.address.port, path: '/v2/invoke', method: 'POST' },
            (response) => {
                let body = ''
                response.setEncoding('utf8')
                response.on('data', (chunk) => {
                    body += chunk
                })
                response.on('end', () => resolve(JSON.parse(body)))
            }
        )
        request.on('error', reject)
        request.write(bytes.subarray(0, split))
        setTimeout(() => request.end(bytes.subarray(split)), 20)
    })
    assert.deepEqual(result.completion.outcome, { kind: 'value', value })
})

test('an invalid consumer directory fails allocation within its deadline', async (t) => {
    const { post } = await harness(t, { consumer: '/nonexistent/node-compliance-consumer' })
    await post(
        'fixtures/allocate',
        { fixture_id: 'f', case_id: 'test', profile_id: 'node-legacy', timeout_ms: 100 },
        400
    )
})

test('missing public package fails allocation rather than claiming execution', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'node-adapter-empty-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const { post } = await harness(t, { consumer: root })
    await post(
        'fixtures/allocate',
        { fixture_id: 'f', case_id: 'test', profile_id: 'node-legacy', timeout_ms: 1000 },
        400
    )
})
