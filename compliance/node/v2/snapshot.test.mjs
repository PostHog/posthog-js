import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { Binding } from './binding.mjs'

const consumer = process.env.POSTHOG_NODE_CONSUMER
if (!consumer) throw new Error('Set POSTHOG_NODE_CONSUMER to a packaged consumer')
const { PostHog, FeatureFlagEvaluations } = createRequire(resolve(consumer, 'package.json'))('posthog-node')

// Genuine package instances, with spies replacing only their public methods.
async function spies(run) {
    const seed = new PostHog('test-token', { flushInterval: 0 })
    const parent = await seed.evaluateFlags()
    const child = await seed.evaluateFlags()
    const nested = await seed.evaluateFlags()
    const calls = []
    const originals = []
    const state = {
        evaluation: parent,
        value: 'control',
        payload: { active: false, attempt: 0 },
        enabled: true,
    }
    function patch(prototype, name, descriptor) {
        originals.push([prototype, name, Object.getOwnPropertyDescriptor(prototype, name)])
        Object.defineProperty(prototype, name, {
            configurable: true,
            ...descriptor,
        })
    }
    patch(PostHog.prototype, 'evaluateFlags', {
        value(...args) {
            calls.push(['evaluateFlags', this, args])
            if (state.evaluation instanceof Error) throw state.evaluation
            return state.evaluation
        },
    })
    for (const [name, field] of [
        ['isEnabled', 'enabled'],
        ['getFlag', 'value'],
        ['getFlagPayload', 'payload'],
    ])
        patch(FeatureFlagEvaluations.prototype, name, {
            value(...args) {
                calls.push([name, this, args])
                if (state[field] instanceof Error) throw state[field]
                return state[field]
            },
        })
    patch(FeatureFlagEvaluations.prototype, 'keys', {
        get() {
            calls.push(['keys', this, []])
            return this === parent ? ['beta-ui', 'checkout'] : ['checkout']
        },
    })
    patch(FeatureFlagEvaluations.prototype, 'only', {
        value(...args) {
            calls.push(['only', this, args])
            return child
        },
    })
    patch(FeatureFlagEvaluations.prototype, 'onlyAccessed', {
        value(...args) {
            calls.push(['onlyAccessed', this, args])
            return nested
        },
    })
    const NativeConstructor = new Proxy(PostHog, {
        construct(target, args) {
            calls.push(['constructor', null, args])
            return Reflect.construct(target, args)
        },
    })
    const binding = new Binding(NativeConstructor)
    try {
        await run({ binding, calls, state, parent, child, nested })
    } finally {
        for (const [prototype, name, descriptor] of originals) {
            if (descriptor) Object.defineProperty(prototype, name, descriptor)
            else delete prototype[name]
        }
        await seed.shutdown()
        if (binding.client) await binding.client.shutdown()
    }
}
const setup = (binding) =>
    binding.invoke('/setup', {
        project_token: 'test-token',
        config: { flush_interval_ms: 0 },
    })
const value = (data) => ({ kind: 'value', value: data })

test('compound request evaluates once and calls every getter on its native parent/child receiver', async () => {
    await spies(async ({ binding, calls, parent, child, nested }) => {
        await setup(binding)
        const reads = [
            { method: 'is_enabled', key: 'checkout' },
            { method: 'get_flag', key: 'checkout' },
            { method: 'get_flag_payload', key: 'checkout' },
            { method: 'keys' },
            {
                method: 'only',
                keys: ['checkout', 'checkout', 'missing'],
                reads: [
                    { method: 'get_flag', key: 'checkout' },
                    { method: 'only_accessed', reads: [{ method: 'keys' }] },
                ],
            },
            { method: 'get_flag', key: 'checkout' },
            { method: 'only', keys: [], reads: [] },
            { method: 'only_accessed', reads: [] },
        ]
        const result = await binding.invoke('/evaluate_flags/read', {
            distinct_id: 'person',
            reads,
        })
        assert.deepEqual(result, {
            kind: 'sdk',
            outcome: value({
                results: [
                    value(true),
                    value('control'),
                    value({ active: false, attempt: 0 }),
                    value(['beta-ui', 'checkout']),
                    value({
                        results: [value('control'), value({ results: [value(['checkout'])] })],
                    }),
                    value('control'),
                    value({ results: [] }),
                    value({ results: [] }),
                ],
            }),
        })
        assert.deepEqual(
            calls.slice(1).map(([name, , args]) => [name, args]),
            [
                ['evaluateFlags', ['person']],
                ['isEnabled', ['checkout']],
                ['getFlag', ['checkout']],
                ['getFlagPayload', ['checkout']],
                ['keys', []],
                ['only', [['checkout', 'checkout', 'missing']]],
                ['getFlag', ['checkout']],
                ['onlyAccessed', []],
                ['keys', []],
                ['getFlag', ['checkout']],
                ['only', [[]]],
                ['onlyAccessed', []],
            ]
        )
        assert.equal(calls[1][1], binding.client)
        assert.deepEqual(
            calls.slice(2).map(([, receiver]) => receiver),
            [parent, parent, parent, parent, parent, child, child, nested, parent, parent, parent]
        )
        await binding.invoke('/evaluate_flags/read', {
            distinct_id: 'other',
            options: { groups: { organization: 'other' } },
            reads: [],
        })
        assert.deepEqual(calls.at(-1).slice(0, 1), ['evaluateFlags'])
        assert.deepEqual(calls.at(-1)[2], ['other', { groups: { organization: 'other' } }])
    })
})

for (const [args, expected] of [
    [{ reads: [] }, []],
    [{ options: {}, reads: [] }, [{}]],
    [{ distinct_id: 'person', reads: [] }, ['person']],
    [{ distinct_id: null, options: null, reads: [] }, [null, null]],
    [
        {
            distinct_id: 'person',
            options: {
                groups: { organization: 'acme' },
                person_properties: { active: false, attempt: 0 },
                group_properties: { organization: { values: [0, false, null] } },
                only_evaluate_locally: false,
                disable_geoip: false,
                flag_keys: [],
            },
            reads: [],
        },
        [
            'person',
            {
                groups: { organization: 'acme' },
                personProperties: { active: false, attempt: 0 },
                groupProperties: { organization: { values: [0, false, null] } },
                onlyEvaluateLocally: false,
                disableGeoip: false,
                flagKeys: [],
            },
        ],
    ],
])
    test(`evaluation preserves native arguments: ${JSON.stringify(args)}`, async () => {
        await spies(async ({ binding, calls }) => {
            await setup(binding)
            await binding.invoke('/evaluate_flags/read', args)
            assert.deepEqual(calls.at(-1)[2], expected)
        })
    })

for (const [read, expected] of [
    [{ method: 'is_enabled', key: 'missing' }, ['missing']],
    [{ method: 'is_enabled', key: 'missing', options: {} }, ['missing', {}]],
    [{ method: 'is_enabled', key: 'missing', options: { default_value: false } }, ['missing', { defaultValue: false }]],
    [{ method: 'is_enabled', key: 'missing', options: { default_value: true } }, ['missing', { defaultValue: true }]],
    [{ method: 'is_enabled', options: { default_value: false } }, [undefined, { defaultValue: false }]],
])
    test(`enablement default arguments: ${JSON.stringify(read)}`, async () => {
        await spies(async ({ binding, calls }) => {
            await setup(binding)
            await binding.invoke('/evaluate_flags/read', { reads: [read] })
            assert.deepEqual(calls.at(-1)[2], expected)
        })
    })

for (const result of [undefined, null, false, 0, 'hello', '{"copy":"new"}', { active: false, attempt: 0 }])
    test(`native getter outcome remains lossless: ${JSON.stringify(result)}`, async () => {
        await spies(async ({ binding, state }) => {
            await setup(binding)
            state.payload = result
            assert.deepEqual(
                await binding.invoke('/evaluate_flags/read', {
                    reads: [{ method: 'get_flag_payload', key: 'checkout' }],
                }),
                {
                    kind: 'sdk',
                    outcome: value({
                        results: [result === undefined ? { kind: 'undefined' } : value(result)],
                    }),
                }
            )
        })
    })

for (const bad of [
    { reads: [{ method: 'unsupported' }] },
    { options: { send_event: false }, reads: [] },
    { reads: [{ method: 'keys', key: 'checkout' }] },
    { reads: [{ method: 'only_accessed', keys: [], reads: [] }] },
    {
        reads: [{ method: 'is_enabled', key: 'x', options: { unsupported: true } }],
    },
    {
        reads: [
            {
                method: 'only',
                keys: [],
                reads: [{ method: 'get_flag', extra: true }],
            },
        ],
    },
])
    test(`unknown mapping remains a binding gap: ${JSON.stringify(bad)}`, async () => {
        await spies(async ({ binding, calls }) => {
            await setup(binding)
            assert.equal((await binding.invoke('/evaluate_flags/read', bad)).failure.kind, 'unsupported_binding')
            assert.equal(calls.length, 1)
        })
    })

for (const field of ['evaluation', 'value', 'payload', 'enabled'])
    test(`native ${field} throws remain native`, async () => {
        await spies(async ({ binding, state }) => {
            await setup(binding)
            state[field] = new Error('native error')
            const method =
                {
                    value: 'get_flag',
                    payload: 'get_flag_payload',
                    enabled: 'is_enabled',
                }[field] || 'get_flag'
            const args = { reads: [{ method, key: 'checkout' }] }
            const first = await binding.invoke('/evaluate_flags/read', args)
            assert.equal(first.kind, 'sdk')
            assert.equal(first.outcome.kind, 'thrown')
            assert.deepEqual(await binding.invoke('/evaluate_flags/read', args), first)
        })
    })

test('non-JSON getter result stays a fixture gap', async () => {
    await spies(async ({ binding, state }) => {
        await setup(binding)
        state.value = new Date()
        assert.equal(
            (
                await binding.invoke('/evaluate_flags/read', {
                    reads: [{ method: 'get_flag', key: 'checkout' }],
                })
            ).failure.code,
            'native-non-json-result'
        )
    })
})

test('public disabled and flag-specific retry configuration is forwarded', async () => {
    await spies(async ({ binding, calls }) => {
        await binding.invoke('/setup', {
            project_token: 'test-token',
            config: {
                disabled: true,
                feature_flags_request_max_retries: 0,
                flush_interval_ms: 0,
            },
        })
        assert.deepEqual(calls[0][2], [
            'test-token',
            { disabled: true, featureFlagsRequestMaxRetries: 0, flushInterval: 0 },
        ])
    })
})
