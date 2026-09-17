import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LocalObserver } from './local-observer.mjs'

const version = '97.3.1-test'
const implementation = `posthog-node@${version}:FeatureFlagsPoller.computeFlagAndPayloadLocally`

const deferred = () => {
    let resolve, reject
    const promise = new Promise((yes, no) => {
        resolve = yes
        reject = no
    })
    return { promise, resolve, reject }
}

test('observer preserves the component promise, receiver, arguments and actual result', async () => {
    const observer = new LocalObserver(version)
    const pending = deferred()
    const flag = { key: 'native-key' },
        context = { distinctId: 'person' }
    const poller = {
        computeFlagAndPayloadLocally(...args) {
            assert.equal(this, poller)
            assert.deepEqual(args, [flag, context])
            return pending.promise
        },
    }
    const original = poller.computeFlagAndPayloadLocally
    assert.equal(observer.attach({ featureFlagsPoller: poller }), true)
    const result = { value: false, payload: { untouched: true } }
    const run = observer.run('call', () => {
        const promise = poller.computeFlagAndPayloadLocally(flag, context)
        assert.equal(promise, pending.promise)
        return promise
    })
    pending.resolve(result)
    assert.deepEqual(await run, {
        completion: result,
        provenance: {
            layer: 'native_component',
            implementation,
            call_id: 'call',
            key: 'native-key',
            resolution: 'local',
            value: false,
        },
    })
    observer.close()
    assert.equal(poller.computeFlagAndPayloadLocally, original)
})

test('concurrent invocation contexts cannot borrow observations', async () => {
    const observer = new LocalObserver(version)
    const a = deferred(),
        b = deferred()
    const poller = {
        computeFlagAndPayloadLocally(flag) {
            return flag.key === 'a' ? a.promise : b.promise
        },
    }
    observer.attach({ featureFlagsPoller: poller })
    const first = observer.run('first', () => poller.computeFlagAndPayloadLocally({ key: 'a' }))
    const second = observer.run('second', () => poller.computeFlagAndPayloadLocally({ key: 'b' }))
    b.resolve({ value: 'variant' })
    a.resolve({ value: true })
    assert.equal((await first).provenance.call_id, 'first')
    assert.equal((await first).provenance.value, true)
    assert.equal((await second).provenance.key, 'b')
    assert.equal((await second).provenance.value, 'variant')
    assert.deepEqual(await observer.run('unknown', () => true), { completion: true })
    observer.close()
})

test('missing, inconclusive, rejected, duplicate and late evaluation do not produce conclusive provenance', async () => {
    const observer = new LocalObserver(version)
    assert.equal(observer.attach({}), false)
    assert.deepEqual(await observer.run('missing', () => false), { completion: false })
    let pending = deferred()
    const poller = {
        computeFlagAndPayloadLocally() {
            return pending.promise
        },
    }
    observer.attach({ featureFlagsPoller: poller })
    const rejected = observer.run('rejected', () => poller.computeFlagAndPayloadLocally({ key: 'f' }))
    const error = new Error('native failure')
    pending.reject(error)
    await assert.rejects(rejected, (e) => e === error)
    pending = deferred()
    pending.resolve(undefined)
    assert.deepEqual(await observer.run('inconclusive', () => poller.computeFlagAndPayloadLocally({ key: 'f' })), {
        completion: undefined,
    })
    pending = deferred()
    pending.resolve({ value: true })
    const duplicate = await observer.run('duplicate', async () => {
        await poller.computeFlagAndPayloadLocally({ key: 'f' })
        return poller.computeFlagAndPayloadLocally({ key: 'f' })
    })
    assert.equal(duplicate.provenance, undefined)
    pending = deferred()
    assert.deepEqual(
        await observer.run('late', () => {
            poller.computeFlagAndPayloadLocally({ key: 'f' })
            return false
        }),
        { completion: false }
    )
    pending.resolve({ value: true })
    await pending.promise
    assert.deepEqual(await observer.run('next', () => true), { completion: true })
    observer.close()
})

for (const result of [undefined, null, false, { value: true }, { then() { throw new Error('must not assimilate') } }]) {
    test(`incompatible return ${String(result)} is unchanged and not local provenance`, async () => {
        const observer = new LocalObserver(version)
        const poller = { computeFlagAndPayloadLocally() { return result } }
        observer.attach({ featureFlagsPoller: poller })
        const seen = await observer.run('call', () => {
            assert.equal(poller.computeFlagAndPayloadLocally({ key: 'f' }), result)
            return 'public result'
        })
        assert.deepEqual(seen, { completion: 'public result' })
        observer.close()
    })
}

test('incompatible promise species and result accessors cannot throw into SDK work', async () => {
    const observer = new LocalObserver(version)
    let result = Promise.resolve({ value: true })
    Object.defineProperty(result, 'constructor', { get() { throw new Error('species') } })
    const poller = { computeFlagAndPayloadLocally() { return result } }
    observer.attach({ featureFlagsPoller: poller })
    const invoke = () => { assert.equal(poller.computeFlagAndPayloadLocally({ key: 'f' }), result); return false }
    assert.deepEqual(await observer.run('species', invoke), { completion: false })
    result = Promise.resolve({ get value() { throw new Error('private shape changed') } })
    assert.deepEqual(await observer.run('accessor', invoke), { completion: false })
    observer.close()
})

test('unwritable seam and synchronous native exception retain native behavior', async () => {
    const observer = new LocalObserver(version)
    const error = new Error('native')
    const original = () => { throw error }
    const poller = Object.freeze({ computeFlagAndPayloadLocally: original })
    assert.equal(observer.attach({ featureFlagsPoller: poller }), false)
    assert.equal(poller.computeFlagAndPayloadLocally, original)
    const writable = { computeFlagAndPayloadLocally: original }
    assert.equal(observer.attach({ featureFlagsPoller: writable }), true)
    await assert.rejects(observer.run('native', () => writable.computeFlagAndPayloadLocally()), e => e === error)
    observer.close()
})
