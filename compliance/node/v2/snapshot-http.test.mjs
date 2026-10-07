import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { startServer, protocol } from './server.mjs'

const consumer = process.env.POSTHOG_NODE_CONSUMER
if (!consumer) throw new Error('Set POSTHOG_NODE_CONSUMER to an installed consumer')
const value = (data) => ({ kind: 'value', value: data })

for (const mode of ['v0', 'v1'])
    for (const format of ['cjs', 'esm']) {
        test(`installed public snapshot HTTP: ${mode}/${format}`, async (t) => {
            const traffic = []
            const mock = createServer(async (request, response) => {
                const chunks = []
                for await (const chunk of request) chunks.push(chunk)
                const body = JSON.parse(Buffer.concat(chunks).toString())
                traffic.push({ path: request.url, body })
                response.setHeader('content-type', 'application/json')
                response.end(
                    JSON.stringify(
                        request.url.startsWith('/flags')
                            ? {
                                  featureFlags: { 'beta-ui': true, checkout: 'control' },
                                  featureFlagPayloads: {
                                      checkout: '{"copy":"new","enabled":false,"attempt":0}',
                                  },
                              }
                            : { status: 1 }
                    )
                )
            })
            mock.listen(0, '127.0.0.1')
            await once(mock, 'listening')
            const adapter = await startServer({ consumer, mode, format, port: 0 })
            t.after(async () => {
                await adapter.close()
                mock.closeAllConnections()
                await new Promise((done) => mock.close(done))
            })
            let sequence = 0
            async function post(path, data) {
                const response = await fetch(`http://127.0.0.1:${adapter.address.port}/v2/${path}`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(data),
                })
                assert.equal(response.status, 200)
                return response.json()
            }
            async function allocate(id, config = {}) {
                await post('fixtures/allocate', {
                    fixture_id: id,
                    case_id: 'snapshot',
                    profile_id: mode === 'v0' ? 'node-legacy' : 'node-analytics-v1',
                    timeout_ms: 5000,
                })
                await invoke(id, '/setup', {
                    project_token: 'test-token',
                    config: {
                        host: `http://127.0.0.1:${mock.address().port}`,
                        flush_at: 100,
                        flush_interval_ms: 0,
                        compression: 'none',
                        ...config,
                    },
                })
            }
            async function invoke(id, route, args = {}) {
                const result = await post('invoke', {
                    fixture_id: id,
                    call_id: String(++sequence),
                    route,
                    args,
                    timeout_ms: 5000,
                })
                assert.equal(result.completion.kind, 'sdk')
                return result.completion.outcome
            }
            const negotiation = await post('negotiate', { protocol })
            assert.ok(negotiation.supported_routes.includes('/evaluate_flags/read'))
            assert.ok(negotiation.profiles[0].sdk_capabilities.includes('flag_snapshot_value_scalar'))
            await allocate('normal')
            const result = await invoke('normal', '/evaluate_flags/read', {
                distinct_id: 'snapshot-user',
                options: {
                    only_evaluate_locally: false,
                    groups: { organization: 'acme' },
                },
                reads: [
                    { method: 'only_accessed', reads: [{ method: 'keys' }] },
                    { method: 'get_flag_payload', key: 'checkout' },
                    {
                        method: 'only',
                        keys: ['checkout'],
                        reads: [
                            { method: 'get_flag', key: 'checkout' },
                            { method: 'is_enabled', key: 'checkout' },
                        ],
                    },
                    { method: 'get_flag', key: 'checkout' },
                    { method: 'is_enabled', key: 'beta-ui' },
                    { method: 'only_accessed', reads: [{ method: 'keys' }] },
                ],
            })
            assert.deepEqual(
                result,
                value({
                    results: [
                        value({ results: [value([])] }),
                        value({ copy: 'new', enabled: false, attempt: 0 }),
                        value({ results: [value('control'), value(true)] }),
                        value('control'),
                        value(true),
                        value({ results: [value(['checkout', 'beta-ui'])] }),
                    ],
                })
            )
            await invoke('normal', '/flush')
            const flags = traffic.filter((row) => row.path.startsWith('/flags'))
            assert.equal(flags.length, 1)
            assert.equal(flags[0].body.distinct_id, 'snapshot-user')
            assert.deepEqual(flags[0].body.groups, { organization: 'acme' })
            const events = traffic.filter((row) => !row.path.startsWith('/flags')).flatMap((row) => row.body.batch)
            assert.equal(events.length, 2)
            assert.deepEqual(events.map((event) => event.properties.$feature_flag).sort(), ['beta-ui', 'checkout'])
            assert.ok(
                events.every(
                    (event) =>
                        event.event === '$feature_flag_called' &&
                        event.distinct_id === 'snapshot-user' &&
                        event.properties.$groups.organization === 'acme'
                )
            )
            for (const [id, config, args] of [
                ['missing', {}, {}],
                ['disabled', { disabled: true }, { distinct_id: 'snapshot-user' }],
            ]) {
                const before = traffic.length
                await allocate(id, config)
                assert.deepEqual(
                    await invoke(id, '/evaluate_flags/read', {
                        ...args,
                        reads: [
                            { method: 'keys' },
                            { method: 'is_enabled', key: 'x' },
                            { method: 'get_flag', key: 'x' },
                        ],
                    }),
                    value({ results: [value([]), value(false), { kind: 'undefined' }] })
                )
                await invoke(id, '/flush')
                assert.equal(traffic.length, before)
            }
        })
    }

test('genuine public filter warns for dropped unknown keys and preserves the original', async (t) => {
    const { PostHog } = createRequire(resolve(consumer, 'package.json'))('posthog-node')
    const mock = createServer(async (request, response) => {
        for await (const _chunk of request) {
        }
        response.setHeader('content-type', 'application/json')
        response.end('{"featureFlags":{"checkout":"control","beta-ui":true},"featureFlagPayloads":{}}')
    })
    mock.listen(0, '127.0.0.1')
    await once(mock, 'listening')
    const client = new PostHog('test-token', {
        host: `http://127.0.0.1:${mock.address().port}`,
        flushInterval: 0,
    })
    t.after(async () => {
        await client.shutdown()
        mock.closeAllConnections()
        await new Promise((done) => mock.close(done))
    })
    const snapshot = await client.evaluateFlags('snapshot-user', {
        onlyEvaluateLocally: false,
    })
    const original = Object.getOwnPropertyDescriptor(console, 'warn')
    const warnings = []
    Object.defineProperty(console, 'warn', { ...original, value: (...args) => warnings.push(args.join(' ')) })
    try {
        assert.deepEqual(snapshot.only(['checkout', 'checkout', 'missing']).keys, ['checkout'])
        assert.deepEqual(snapshot.only([]).keys, [])
        assert.deepEqual(snapshot.keys.sort(), ['beta-ui', 'checkout'])
        assert.deepEqual(snapshot.onlyAccessed().keys, [])
        assert.equal(warnings.length, 1)
        assert.match(warnings[0], /missing/)
        assert.match(warnings[0], /dropped/)
    } finally {
        Object.defineProperty(console, 'warn', original)
    }
})
