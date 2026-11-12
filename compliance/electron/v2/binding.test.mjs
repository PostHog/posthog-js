import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Binding, setupOptions } from './binding.mjs'
const voidOutcome = { kind: 'sdk', outcome: { kind: 'void' } }
function fixture(profile = 'electron-main') {
    const calls = []
    const client = new Proxy(
        {},
        {
            get: (_, method) =>
                method === 'then'
                    ? undefined
                    : (...args) => {
                          calls.push({ method, args })
                      },
        }
    )
    return {
        calls,
        binding: new Binding(async (options) => {
            calls.push({ method: 'init', args: [options] })
            return client
        }, profile),
    }
}
test('setupOptions maps explicit configuration and suppresses only lifecycle integration noise', () => {
    assert.deepEqual(
        setupOptions({
            project_token: '',
            config: { flush_at: 0, disabled: false, default_opt_in: false, compression: 'none' },
        }),
        {
            projectToken: '',
            captureAppLifecycleEvents: false,
            flushAt: 0,
            disabled: false,
            defaultOptIn: false,
            disableCompression: true,
        }
    )
})
test('Binding preserves absent and explicit false zero null arguments for public client calls', async () => {
    const { calls, binding } = fixture()
    assert.deepEqual(await binding.invoke('/setup', { project_token: 'test' }), voidOutcome)
    assert.deepEqual(
        await binding.invoke('/capture', { event: 'event', properties: { enabled: false, count: 0, missing: null } }),
        voidOutcome
    )
    await binding.invoke('/identify', { distinct_id: 'person', set: { '$set': 0 } })
    await binding.invoke('/capture', { event: 'absent' })
    assert.deepEqual(calls.slice(1), [
        { method: 'capture', args: ['event', { enabled: false, count: 0, missing: null }] },
        { method: 'identify', args: ['person', { '$set': 0 }] },
        { method: 'capture', args: ['absent'] },
    ])
})
test('Binding rejects per-call IDs and unsupported timestamp without SDK calls', async () => {
    const { calls, binding } = fixture()
    await binding.invoke('/setup', { project_token: 'test' })
    for (const field of ['distinct_id', 'timestamp', 'uuid']) {
        const outcome = await binding.invoke('/capture', { event: 'event', [field]: 'not-supported' })
        assert.equal(outcome.failure.kind, 'unsupported_binding')
    }
    assert.equal(calls.length, 1)
})
test('Binding creates native handled TypeError in the selected JavaScript realm', async () => {
    const { calls, binding } = fixture()
    await binding.invoke('/setup', {})
    await binding.invoke('/capture_exception', { error: { type: 'TypeError', message: 'boom' }, properties: null })
    assert.equal(calls[1].method, 'captureException')
    assert.ok(calls[1].args[0] instanceof TypeError)
    assert.equal(calls[1].args[0].message, 'boom')
    assert.ok(calls[1].args[0].stack)
    assert.equal(calls[1].args[1], null)
})
test('Binding classifies actual getter undefined, false, null and SDK throws', async () => {
    for (const value of [undefined, false, null, 0, '']) {
        const binding = new Binding(async () => ({ getFeatureFlag: () => value }), 'electron-main')
        await binding.invoke('/setup', {})
        const result = await binding.invoke('/get_feature_flag', { key: 'flag' })
        assert.deepEqual(result.outcome, value === undefined ? { kind: 'undefined' } : { kind: 'value', value })
    }
    const error = new TypeError('native')
    const binding = new Binding(
        async () => ({
            flush: () => {
                throw error
            },
        }),
        'electron-main'
    )
    await binding.invoke('/setup', {})
    const first = await binding.invoke('/flush', {})
    assert.equal(first.outcome.kind, 'thrown')
    assert.deepEqual(await binding.invoke('/flush', {}), first)
})
test('Binding selects actual main and renderer reload methods', async () => {
    for (const profile of ['electron-main', 'electron-renderer']) {
        const { calls, binding } = fixture(profile)
        await binding.invoke('/setup', {})
        await binding.invoke('/reload_feature_flags', {})
        assert.equal(calls[1].method, profile === 'electron-main' ? 'reloadFeatureFlagsAsync' : 'reloadFeatureFlags')
    }
})
test('Binding invokes only public reset with no synthetic identity state', async () => {
    const { calls, binding } = fixture()
    await binding.invoke('/setup', {})
    assert.deepEqual(await binding.invoke('/reset', {}), voidOutcome)
    assert.deepEqual(calls[1], { method: 'reset', args: [] })
})
test('Binding rejects non-JSON native values instead of fabricating a result', async () => {
    const binding = new Binding(async () => ({ getFeatureFlag: () => new Date() }))
    await binding.invoke('/setup', {})
    assert.equal((await binding.invoke('/get_feature_flag', {})).failure.code, 'native-non-json-result')
})
