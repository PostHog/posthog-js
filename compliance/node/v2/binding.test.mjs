import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { Binding, classify } from './binding.mjs'

const consumer = process.env.POSTHOG_NODE_CONSUMER
if (!consumer) throw new Error('Set POSTHOG_NODE_CONSUMER to the packaged consumer directory')
const { PostHog } = createRequire(resolve(consumer, 'package.json'))('posthog-node')

// Observe the genuine packaged public constructor and replace only its public
// methods. The binding never receives a different SDK-shaped implementation.
async function spies(run, captureMode = 'v0') {
    const originals = new Map()
    const calls = []
    const results = {
        capture: undefined,
        captureAi: undefined,
        flush: undefined,
        getFeatureFlag: undefined,
        reloadFeatureFlags: undefined,
        waitForLocalEvaluationReady: undefined,
    }
    for (const name of Object.keys(results)) {
        originals.set(name, Object.getOwnPropertyDescriptor(PostHog.prototype, name))
        Object.defineProperty(PostHog.prototype, name, {
            configurable: true,
            value: function (...args) {
                calls.push([name, args])
                const result = results[name]
                if (result instanceof Error) throw result
                return result
            },
        })
    }
    const NativeConstructor = new Proxy(PostHog, {
        construct(target, args) {
            calls.push(['constructor', args])
            return Reflect.construct(target, args)
        },
    })
    try {
        await run(new Binding(NativeConstructor, captureMode), calls, results)
    } finally {
        for (const [name, descriptor] of originals) {
            if (descriptor) Object.defineProperty(PostHog.prototype, name, descriptor)
            else delete PostHog.prototype[name]
        }
    }
}
const setup = (binding, config) =>
    binding.invoke('/setup', { project_token: 'test-project', ...(config === undefined ? {} : { config }) })

test('setup preserves omission and maps only explicit config, including false/zero/gzip', async () => {
    for (const [config, expected] of [
        [undefined, ['test-project']],
        [{}, ['test-project', {}]],
        [
            {
                host: null,
                flush_at: 0,
                flush_interval_ms: 0,
                max_retries: 0,
                disable_geoip: false,
                compression: 'gzip',
                historical_migration: false,
            },
            [
                'test-project',
                {
                    host: null,
                    flushAt: 0,
                    flushInterval: 0,
                    fetchRetryCount: 0,
                    disableGeoip: false,
                    disableCompression: false,
                    historicalMigration: false,
                },
            ],
        ],
        [{ compression: 'none' }, ['test-project', { disableCompression: true }]],
        [{ secret_key: '' }, ['test-project', { secretKey: '' }]],
        [{ secret_key: null }, ['test-project', { secretKey: null }]],
    ])
        await spies(async (binding, calls) => {
            assert.deepEqual(await setup(binding, config), { kind: 'sdk', outcome: { kind: 'void' } })
            assert.deepEqual(calls, [['constructor', expected]])
        })
})

test('local reload and readiness call only their public methods with native arguments and results', async () => {
    await spies(async (binding, calls, results) => {
        await setup(binding)
        assert.deepEqual(await binding.invoke('/reload_feature_flags', {}), { kind: 'sdk', outcome: { kind: 'void' } })
        assert.deepEqual(calls, [
            ['constructor', ['test-project']],
            ['reloadFeatureFlags', []],
        ])
        for (const args of [{}, { timeout_ms: 0 }, { timeout_ms: null }, { timeout_ms: false }, { timeout_ms: 5000 }]) {
            for (const value of [true, false, undefined, null]) {
                results.waitForLocalEvaluationReady = value
                assert.deepEqual(
                    (await binding.invoke('/wait_for_local_evaluation_ready', args)).outcome,
                    value === undefined ? { kind: 'undefined' } : { kind: 'value', value }
                )
                assert.deepEqual(calls.at(-1), [
                    'waitForLocalEvaluationReady',
                    Object.hasOwn(args, 'timeout_ms') ? [args.timeout_ms] : [],
                ])
            }
        }
        assert.equal(calls.length, 22)
        results.reloadFeatureFlags = new Error('native reload failure')
        assert.equal((await binding.invoke('/reload_feature_flags', {})).outcome.kind, 'thrown')
        results.waitForLocalEvaluationReady = new Error('native readiness failure')
        assert.equal((await binding.invoke('/wait_for_local_evaluation_ready', {})).outcome.kind, 'thrown')
    })
})

test('AI capture invokes its public method once and preserves native results and timestamp input', async () => {
    for (const mode of ['v0', 'v1']) {
        await spies(async (binding, calls, results) => {
            await setup(binding)
            const args = {
                event: '$ai_generation',
                distinct_id: 'person',
                uuid: 'supplied',
                timestamp: '2025-01-02T08:34:05+05:30',
                properties: { timestamp_like: '2025-01-02T08:34:05+05:30' },
            }
            const before = structuredClone(args)
            for (const value of ['native-uuid', undefined, null, false]) {
                results.captureAi = value
                const completion = await binding.invoke('/capture_ai', args)
                assert.deepEqual(completion, {
                    kind: 'sdk',
                    outcome: value === undefined ? { kind: 'undefined' } : { kind: 'value', value },
                })
                assert.deepEqual(calls.at(-1), [
                    'captureAi',
                    [
                        {
                            event: args.event,
                            distinctId: 'person',
                            uuid: 'supplied',
                            timestamp: new Date('2025-01-02T03:04:05Z'),
                            properties: args.properties,
                        },
                    ],
                ])
            }
            assert.deepEqual(args, before)
            results.captureAi = undefined
            await binding.invoke('/capture_ai', {
                event: 42,
                distinct_id: false,
                properties: null,
                timestamp: null,
                uuid: null,
            })
            assert.deepEqual(calls.at(-1), [
                'captureAi',
                [{ event: 42, distinctId: false, properties: null, timestamp: null, uuid: null }],
            ])
            await binding.invoke('/capture_ai', {})
            assert.deepEqual(calls.at(-1), ['captureAi', [{}]])
            assert.equal(
                (await binding.invoke('/capture_ai', { options: { cookieless_mode: false } })).failure.kind,
                'unsupported_binding'
            )
            assert.equal(calls.length, 7)
            assert.equal(calls.filter(([name]) => name === 'capture' || name === 'flush').length, 0)
            results.captureAi = new Error('native AI failure')
            assert.equal((await binding.invoke('/capture_ai', {})).outcome.kind, 'thrown')
        }, mode)
    }
})

test('semantic negatives reach public constructor/capture without coercion', async () => {
    await spies(async (binding, calls) => {
        const result = await binding.invoke('/setup', { project_token: 'test-project', config: null })
        assert.equal(result.outcome.kind, 'thrown')
        assert.deepEqual(calls, [['constructor', ['test-project', null]]])
    })
    await spies(async (binding, calls) => {
        await setup(binding)
        await binding.invoke('/capture', {
            event: 42,
            properties: null,
            distinct_id: false,
            groups: 0,
            uuid: null,
            timestamp: null,
        })
        await binding.invoke('/capture', {})
        assert.deepEqual(calls.slice(1), [
            ['capture', [{ event: 42, properties: null, distinctId: false, groups: 0, uuid: null, timestamp: null }]],
            ['capture', [{}]],
        ])
    })
})

test('capture renames only known parameters; timestamp offset is lossless', async () =>
    spies(async (binding, calls) => {
        await setup(binding)
        const args = {
            event: 'event',
            distinct_id: 'person',
            properties: { false: false, zero: 0, null: null, kind: 'instance', id: 'data' },
            timestamp: '2026-01-02T03:04:05.123000000+02:30',
            uuid: 'uuid',
            disable_geoip: false,
            send_feature_flags: {
                only_evaluate_locally: false,
                person_properties: null,
                group_properties: {},
                flag_keys: null,
            },
        }
        await binding.invoke('/capture', args)
        assert.deepEqual(calls[1], [
            'capture',
            [
                {
                    event: 'event',
                    distinctId: 'person',
                    properties: args.properties,
                    timestamp: new Date('2026-01-02T00:34:05.123Z'),
                    uuid: 'uuid',
                    disableGeoip: false,
                    sendFeatureFlags: {
                        onlyEvaluateLocally: false,
                        personProperties: null,
                        groupProperties: {},
                        flagKeys: null,
                    },
                },
            ],
        ])
        assert.equal(args.timestamp, '2026-01-02T03:04:05.123000000+02:30')
        for (const timestamp of ['2026-01-02T03:04:05.123000001Z', '2026-02-30T00:00:00Z', 'not a date']) {
            const result = await binding.invoke('/capture', { event: 'event', timestamp })
            assert.equal(result.failure.kind, 'blocked_fixture')
        }
        assert.equal(calls.length, 2)
    }))

test('flag getter maps options, preserves omission/results, performs no flush', async () =>
    spies(async (binding, calls, results) => {
        await setup(binding)
        const options = {
            groups: null,
            person_properties: {},
            group_properties: null,
            only_evaluate_locally: false,
            send_event: false,
            disable_geoip: false,
        }
        for (const value of [undefined, null, false, 0, 'variant']) {
            results.getFeatureFlag = Promise.resolve(value)
            const result = await binding.invoke('/get_feature_flag', { key: 'flag', distinct_id: null, ...options })
            assert.deepEqual(result, {
                kind: 'sdk',
                outcome: value === undefined ? { kind: 'undefined' } : { kind: 'value', value },
            })
            assert.deepEqual(calls.at(-1), [
                'getFeatureFlag',
                [
                    'flag',
                    null,
                    {
                        groups: null,
                        personProperties: {},
                        groupProperties: null,
                        onlyEvaluateLocally: false,
                        sendFeatureFlagEvents: false,
                        disableGeoip: false,
                    },
                ],
            ])
        }
        await binding.invoke('/get_feature_flag', {})
        assert.deepEqual(calls.at(-1), ['getFeatureFlag', []])
        await binding.invoke('/get_feature_flag', { key: 'flag' })
        assert.deepEqual(calls.at(-1), ['getFeatureFlag', ['flag']])
        assert.equal(calls.filter(([name]) => name === 'getFeatureFlag').length, 7)
        assert.equal(calls.filter(([name]) => name === 'flush').length, 0)
    }))

test('void evidence does not discard real values; async native completion is awaited', async () =>
    spies(async (binding, calls, results) => {
        await setup(binding)
        assert.deepEqual(await binding.invoke('/capture', { event: 'event' }), {
            kind: 'sdk',
            outcome: { kind: 'void' },
        })
        results.capture = false
        assert.deepEqual(await binding.invoke('/capture', {}), {
            kind: 'sdk',
            outcome: { kind: 'value', value: false },
        })
        let resolveFlush
        results.flush = new Promise((resolve) => {
            resolveFlush = resolve
        })
        let settled = false
        const pending = binding.invoke('/flush', {}).then((result) => {
            settled = true
            return result
        })
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(settled, false)
        resolveFlush()
        assert.deepEqual(await pending, { kind: 'sdk', outcome: { kind: 'void' } })
        assert.equal(calls.filter(([name]) => name === 'flush').length, 1)
    }))

test('unsupported supplied fields remain attributed gaps before native work', async () =>
    spies(async (binding, calls) => {
        for (const config of [{ preload_feature_flags: false }, { compression: null }, { request_timeout_ms: 0 }]) {
            assert.equal((await setup(binding, config)).failure.kind, 'unsupported_binding')
        }
        assert.equal(calls.length, 0)
        await setup(binding)
        for (const [route, args] of [
            ['/capture', { event: 'event', set: null }],
            ['/capture', { options: {} }],
            ['/capture', { send_feature_flags: { device_id: 'd' } }],
            ['/flush', { timeout_ms: 0 }],
            ['/get_feature_flag', { key: 'f', fresh: false }],
            ['/get_feature_flag', { default_value: null }],
            ['/identify', {}],
        ])
            assert.equal((await binding.invoke(route, args)).failure.kind, 'unsupported_binding')
        assert.equal((await setup(binding)).failure.code, 'repeated-setup')
        assert.equal(calls.length, 1)
    }))

test('native exceptions are retained by identity; non-JSON results are blocked', async () =>
    spies(async (binding, calls, results) => {
        assert.equal((await binding.invoke('/flush', {})).failure.code, 'before-setup')
        await setup(binding)
        results.flush = new Error('native failure')
        const first = await binding.invoke('/flush', {})
        assert.equal(first.outcome.kind, 'thrown')
        assert.deepEqual(await binding.invoke('/flush', {}), first)
        for (const value of [NaN, Infinity, 1n, new Date(), { missing: undefined }, [, 1], -0]) {
            results.capture = value
            assert.equal((await binding.invoke('/capture', {})).failure.code, 'native-non-json-result')
        }
        assert.deepEqual(classify(undefined), { kind: 'undefined' })
        assert.deepEqual(classify({ kind: 'instance', id: 'plain-data' }), {
            kind: 'value',
            value: { kind: 'instance', id: 'plain-data' },
        })
    }))

test('analytics-v1 options translate to native input properties without coercion or mutation', async () =>
    spies(async (binding, calls) => {
        await setup(binding)
        const args = {
            event: 'event',
            distinct_id: 'person',
            properties: { custom: false },
            options: {
                cookieless_mode: false,
                disable_skew_correction: true,
                process_person_profile: false,
                product_tour_id: 'tour',
            },
        }
        const before = structuredClone(args)
        await binding.invoke('/capture', args)
        assert.deepEqual(calls[1], [
            'capture',
            [
                {
                    event: 'event',
                    distinctId: 'person',
                    properties: {
                        custom: false,
                        $cookieless_mode: false,
                        $ignore_sent_at: true,
                        $process_person_profile: false,
                        $product_tour_id: 'tour',
                    },
                },
            ],
        ])
        assert.deepEqual(args, before)
        await binding.invoke('/capture', { event: 'negative', options: { cookieless_mode: null } })
        assert.deepEqual(calls[2], ['capture', [{ event: 'negative', properties: { $cookieless_mode: null } }]])
        await binding.invoke('/capture', { event: 'empty', options: {} })
        assert.deepEqual(calls[3], ['capture', [{ event: 'empty' }]])
        for (const [args, kind] of [
            [{ options: null }, 'unsupported_binding'],
            [{ options: { unknown: false } }, 'unsupported_binding'],
            [{ options: { cookieless_mode: true }, properties: null }, 'blocked_fixture'],
            [{ options: { cookieless_mode: true }, properties: { $cookieless_mode: false } }, 'blocked_fixture'],
        ])
            assert.equal((await binding.invoke('/capture', args)).failure.kind, kind)
        assert.equal(calls.length, 4)
    }, 'v1'))
