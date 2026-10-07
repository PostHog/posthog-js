/* eslint-disable posthog-js/no-direct-number-check -- Standalone browser test fixtures exercise public APIs without importing SDK runtime helpers. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { normalize, differences, decodeReplay } from './normalize.mjs'
import { parseOptions, selection, completeCoverage, identicalArtifacts } from './options.mjs'
import { assertLoaderProof } from './loader-proof.mjs'

const context = { origin: 'http://127.0.0.1:1234', version: '1.436.1' }
const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const c = '33333333-3333-4333-8333-333333333333'
const d = '44444444-4444-4444-8444-444444444444'
const n = (value) => normalize(value, context)
const changed = (before, after) => differences(n(before), n(after)).length > 0
const event = (properties) => ({ event: 'fixture', properties })
const snapshot = (events) => ({ network: { events } })

test('generated IDs retain identity relationships across API, storage and payloads', () => {
    const sample = (distinct, session) => ({
        api: {
            observations: [{ method: 'get_distinct_id', returned: distinct }],
            storage: {
                local: {
                    ph_fixture_posthog: JSON.stringify({
                        distinct_id: distinct,
                        $sesid: [0, session, 0],
                        $client_session_props: { sessionId: session },
                    }),
                },
            },
        },
        network: {
            events: [event({ distinct_id: distinct, $device_id: distinct, $session_id: session })],
            requests: [{ path: '/flags', body: { distinct_id: distinct, $device_id: distinct } }],
        },
    })
    assert.deepEqual(n(sample(a, b)), n(sample(c, d)))
    const broken = sample(c, d)
    broken.network.events[0].properties.distinct_id = d
    assert(changed(sample(a, b), broken))
})

test('fixture origin and explicit SDK-version metadata normalize without hiding query changes', () => {
    const sample = (origin, version) => ({
        network: {
            events: [event({ $lib_version: version, $host: new URL(origin).host, $current_url: `${origin}/` })],
            requests: [
                { path: `/static/${version}/surveys.js`, query: { v: [version], feature: ['retained'] }, status: 200 },
            ],
        },
    })
    assert.deepEqual(
        normalize(sample(context.origin, context.version), context),
        normalize(sample('http://127.0.0.1:5678', '1.437.0'), { origin: 'http://127.0.0.1:5678', version: '1.437.0' })
    )
    const baseline = sample(context.origin, context.version),
        bad = structuredClone(baseline)
    bad.network.requests[0].query.feature = ['changed']
    assert(changed(baseline, bad))
})

test('application UUIDs, cv fields, versions and clock-like fields are retained', () => {
    const app = {
        uuid: a,
        cv: 'application-format',
        data: 'application-data',
        $lib_version: context.version,
        timeUnixNano: '123',
        $snapshot_bytes: 100,
        $sdk_debug_extensions_init_time_ms: 1,
    }
    const baseline = snapshot([event({ application: app })])
    assert.deepEqual(JSON.parse(JSON.stringify(n(baseline).network.events[0].properties.application)), app)
    for (const key of Object.keys(app)) {
        const bad = structuredClone(baseline)
        bad.network.events[0].properties.application[key] = typeof app[key] === 'number' ? 900 : 'changed'
        assert(changed(baseline, bad), key)
    }
})

test('CPU/encoded-size metrics normalize numeric variation, not malformed types', () => {
    const baseline = snapshot([event({ $sdk_debug_extensions_init_time_ms: 1, $snapshot_bytes: 100 })])
    assert.deepEqual(n(baseline), n(snapshot([event({ $sdk_debug_extensions_init_time_ms: 7, $snapshot_bytes: 200 })])))
    assert(changed(baseline, snapshot([event({ $sdk_debug_extensions_init_time_ms: false, $snapshot_bytes: null })])))
})

test('OpenTelemetry identity/version/clock normalization preserves record contents', () => {
    const sample = (id, clock) => ({
        network: {
            logs: [
                {
                    resourceLogs: [
                        {
                            resource: {
                                attributes: [{ key: 'telemetry.sdk.version', value: { stringValue: context.version } }],
                            },
                            scopeLogs: [
                                {
                                    logRecords: [
                                        {
                                            timeUnixNano: clock,
                                            observedTimeUnixNano: clock,
                                            body: { stringValue: 'retained' },
                                            attributes: [{ key: 'posthogDistinctId', value: { stringValue: id } }],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    })
    assert.deepEqual(n(sample(a, '123')), n(sample(b, '456')))
    const bad = sample(b, '456')
    bad.network.logs[0].resourceLogs[0].scopeLogs[0].logRecords[0].body.stringValue = 'changed'
    assert(changed(sample(a, '123'), bad))
    bad.network.logs[0].resourceLogs[0].scopeLogs[0].logRecords[0].timeUnixNano = false
    assert(changed(sample(a, '123'), bad))
})

test('missing, extra, duplicate and modified delivered events fail comparison', () => {
    const baseline = snapshot([event({ phase: 'loaded', retained: 0 }), event({ phase: 'ready', retained: true })])
    assert(changed(baseline, snapshot(baseline.network.events.slice(1))))
    assert(changed(baseline, snapshot([...baseline.network.events, baseline.network.events[0]])))
    const bad = structuredClone(baseline)
    bad.network.events[0].properties.retained = 1
    assert(changed(baseline, bad))
})

test('independent arrivals can reorder, but payload-array and callback order cannot', () => {
    const requests = [
        { path: '/flags', query: { v: ['2'] } },
        { path: '/e', body: { batch: [event({ phase: 'one' }), event({ phase: 'two' })] } },
    ]
    const baseline = {
        api: { callbacks: [{ callback: 'one' }, { callback: 'two' }] },
        network: { requests, events: [event({ phase: 'one' }), event({ phase: 'two' })] },
    }
    const arrivals = structuredClone(baseline)
    arrivals.network.requests.reverse()
    arrivals.network.events.reverse()
    assert.deepEqual(n(baseline), n(arrivals))
    const payload = structuredClone(baseline)
    payload.network.requests[1].body.batch.reverse()
    assert(changed(baseline, payload))
    const callbacks = structuredClone(baseline)
    callbacks.api.callbacks.reverse()
    assert(changed(baseline, callbacks))
})

test('replay queue diagnostics can vary while missing delivered frames remain detectable', () => {
    const sample = (length) => ({
        network: {
            snapshots: [
                {
                    properties: {
                        $sdk_debug_replay_internal_buffer_length: length,
                        $snapshot_data: [
                            { type: 4, data: { href: context.origin } },
                            { type: 2, data: { node: { type: 0 } } },
                        ],
                    },
                },
            ],
        },
    })
    assert.deepEqual(n(sample(1)), n(sample(6)))
    const missing = sample(6)
    missing.network.snapshots[0].properties.$snapshot_data.pop()
    assert(changed(sample(1), missing))
    assert(changed(sample(1), sample(false)))
})

test('replay decoding retains compression version and fails on unknown codecs', () => {
    const data = { node: { type: 0, childNodes: [{ textContent: 'retained' }] } }
    const compressed = gzipSync(JSON.stringify(data)).toString('latin1')
    const source = {
        network: { snapshots: [{ properties: { $snapshot_data: [{ type: 2, cv: '2024-10', data: compressed }] } }] },
    }
    const decoded = decodeReplay(source).network.snapshots[0].properties.$snapshot_data[0]
    assert.equal(decoded.cv, '2024-10')
    assert.deepEqual(decoded.data, data)
    assert.equal(source.network.snapshots[0].properties.$snapshot_data[0].data, compressed)
    const bad = structuredClone(source)
    bad.network.snapshots[0].properties.$snapshot_data[0].cv = 'unknown'
    assert.throws(() => n(bad), /Unsupported replay compression/)
})

test('normalization does not mutate source arrays or discard prototype-named JSON keys', () => {
    const source = snapshot([
        event({ phase: 'z' }),
        event({ phase: 'a', nested: JSON.parse('{"__proto__":{"retained":true},"constructor":"retained"}') }),
    ])
    const copy = structuredClone(source)
    const normalized = n(source)
    assert.deepEqual(source, copy)
    assert(Object.hasOwn(normalized.network.events[0].properties.nested, '__proto__'))
    assert.equal(normalized.network.events[0].properties.nested.__proto__.retained, true)
    assert(differences({}, JSON.parse('{"constructor":null}')).some((diff) => diff.missing === 'baseline'))
})

test('null, undefined, missing values and callback counts remain distinct', () => {
    assert(differences({ value: null }, { value: { $kind: 'undefined' } }).length)
    assert(differences({}, { value: undefined }).length)
    assert(differences({ callbacks: [1] }, { callbacks: [1, 1] }).length)
})

test('browser API harness records return values, throws, callbacks and settled promises', async () => {
    const sandbox = { window: {}, addEventListener() {}, Error, Date }
    vm.runInNewContext(readFileSync(new URL('./harness.js', import.meta.url), 'utf8'), sandbox)
    const lab = sandbox.window.__compat
    lab.ph = {
        value: () => undefined,
        nil: () => null,
        fail() {
            throw new TypeError('fixture failure')
        },
        promised: () => Promise.resolve({ retained: 0, missing: undefined }),
        rejected: () => Promise.reject(new Error('fixture rejection')),
    }
    lab.call('value')
    lab.call('nil')
    lab.call('absent')
    lab.call('fail')
    lab.call('promised')
    lab.call('rejected')
    lab.callback('fixture')(undefined, null, false)
    await Promise.resolve()
    const observations = JSON.parse(JSON.stringify(lab.observations))
    assert.deepEqual(observations[0].returned, { $kind: 'undefined' })
    assert.equal(observations[1].returned, null)
    assert.deepEqual(observations[2].returned, { $kind: 'missing-method' })
    assert.equal(observations[3].thrown.name, 'TypeError')
    assert.equal(lab.promises[0].state, 'fulfilled')
    assert.equal(lab.promises[1].state, 'rejected')
    assert.deepEqual(JSON.parse(JSON.stringify(lab.callbacks[0].values)), [{ $kind: 'undefined' }, null, false])
})

test('identity classification uses runtime digests rather than source labels or inventory order', () => {
    const main = { version: '1.436.1', sourceSha: 'one', files: { 'array.js': 'a', 'surveys.js': 'b' } }
    const same = { ...main, sourceSha: 'two', files: { 'surveys.js': 'b', 'array.js': 'a' } }
    assert(identicalArtifacts(main, same))
    assert(!identicalArtifacts(main, { ...same, files: { ...same.files, 'surveys.js': 'changed' } }))
    assert(!identicalArtifacts(main, { ...same, version: '1.437.0' }))
})

test('CLI rejects unknown, duplicate and missing options and selections', () => {
    assert.deepEqual(parseOptions(['--engines', 'chromium'], ['engines']), { engines: 'chromium' })
    for (const argv of [
        ['--engine', 'chromium'],
        ['--engines'],
        ['--engines', '--modes'],
        ['--engines', 'chromium', '--engines', 'firefox'],
    ])
        assert.throws(() => parseOptions(argv, ['engines']))
    assert.throws(() => selection(['chromium', 'firefox'], 'chromium,chromium', 'engines'))
    assert.throws(() => selection(['chromium'], 'unknown', 'engines'))
})

test('loader scenarios fail without held requests, initialized UI or native fallback evidence', () => {
    const legacy = { path: '/static/surveys.js', status: 200 }
    const versioned = { path: '/static/1.436.1/surveys.js', status: 404 }
    const loading = { pendingRequest: true, renderedBeforeRelease: false, renderedAfterRelease: true }
    assert.throws(() => assertLoaderProof('delayed-loading', 'current', [], loading))
    assert.throws(() =>
        assertLoaderProof('delayed-loading', 'current', [legacy], { ...loading, pendingRequest: false })
    )
    assert.throws(() =>
        assertLoaderProof('delayed-loading', 'current', [legacy], { ...loading, renderedBeforeRelease: true })
    )
    assert.equal(assertLoaderProof('delayed-loading', 'current', [legacy], loading), 'held-request-then-ready')
    assert.throws(() => assertLoaderProof('version-fallback', 'current', [legacy], loading))
    assert.throws(() => assertLoaderProof('version-fallback', 'current', [legacy, versioned], loading))
    assert.throws(() =>
        assertLoaderProof('version-fallback', 'current', [versioned, legacy], {
            ...loading,
            renderedAfterRelease: false,
        })
    )
    assert.equal(
        assertLoaderProof('version-fallback', 'current', [versioned, legacy], loading),
        'versioned-404-then-legacy-ready'
    )
    assert.equal(assertLoaderProof('version-fallback', 'historical', [legacy], loading), 'legacy-path-only')
})

test('coverage requires every tuple and repeated runs, not only matching row counts', () => {
    const requirements = {
        engines: ['chromium', 'firefox'],
        modes: ['npm'],
        comparisons: ['current'],
        scenarios: ['core'],
        repeats: 2,
        cellFailures: [],
    }
    const row = (engine) => ({ engine, mode: 'npm', comparison: 'current', scenario: 'core' })
    const complete = [row('chromium'), row('firefox')]
    assert(completeCoverage(complete, requirements))
    assert(!completeCoverage([row('chromium'), row('chromium')], requirements))
    assert(!completeCoverage(complete, { ...requirements, repeats: 1 }))
    assert(!completeCoverage(complete, { ...requirements, cellFailures: ['failed engine'] }))
})
