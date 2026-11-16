import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { assertXHRTransport, xhrScenarios } from './xhr-cases.mjs'

test('every XHR scenario explicitly selects XHR without changing default transport scenarios', () => {
    const context = { window: {}, location: { origin: 'http://127.0.0.1:1234' }, addEventListener() {} }
    runInNewContext(readFileSync(new URL('./harness.js', import.meta.url), 'utf8'), context)
    const lab = context.window.__compat
    for (const scenario of xhrScenarios) {
        lab.scenario = scenario
        assert.equal(lab.options().api_transport, 'XHR')
    }
    for (const scenario of ['core', 'replay', 'surveys']) {
        lab.scenario = scenario
        assert.equal(Object.hasOwn(lab.options(), 'api_transport'), false)
    }
})

test('XHR proof requires native flags and capture requests, not configuration alone', () => {
    const flags = { path: '/flags/', resourceType: 'xhr' }
    const capture = { path: '/e/', resourceType: 'xhr' }
    assert.deepEqual(assertXHRTransport([flags, capture]), { flags: 'xhr', capture: 'xhr' })
    assert.throws(() => assertXHRTransport([flags]), /did not deliver an event/)
    assert.throws(() => assertXHRTransport([capture]), /did not send a flags request/)
    assert.throws(() => assertXHRTransport([{ ...flags, resourceType: 'fetch' }, capture]), /native XHR/)
    assert.throws(() => assertXHRTransport([flags, { ...capture, resourceType: 'fetch' }]), /native XHR/)
})
