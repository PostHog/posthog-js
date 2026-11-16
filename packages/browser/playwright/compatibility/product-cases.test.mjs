import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { normalize, differences } from './normalize.mjs'
import {
    assertWebVitalsDelivery,
    assertCssReconstruction,
    assertPersistedConfigProof,
    expectedReplayStyles,
} from './product-cases.mjs'
import { MATRIX } from './golden.mjs'

const session = '11111111-1111-4111-8111-111111111111'
const windowId = '22222222-2222-4222-8222-222222222222'
const context = { origin: 'http://fixture.test', version: '1.0.0' }
const webVitals = () => ({
    events: [
        {
            event: '$web_vitals',
            properties: {
                $session_id: session,
                $window_id: windowId,
                $current_url: context.origin,
                $web_vitals_FCP_value: 24,
                $web_vitals_FCP_event: {
                    name: 'FCP',
                    value: 24,
                    delta: 24,
                    timestamp: 1704067200000,
                    rating: 'good',
                    id: 'v6-1704067200000-1234567890123',
                    $session_id: session,
                    $window_id: windowId,
                    $current_url: context.origin,
                },
            },
        },
    ],
})

test('Web Vitals proof rejects missing, duplicate, malformed and misattributed metrics', () => {
    assertWebVitalsDelivery(webVitals())
    assert.throws(() => assertWebVitalsDelivery({ events: [] }), /delivery/)
    const duplicate = webVitals()
    duplicate.events.push(duplicate.events[0])
    assert.throws(() => assertWebVitalsDelivery(duplicate), /delivery/)
    for (const [key, value] of [
        ['name', 'LCP'],
        ['value', false],
        ['delta', -1],
        ['timestamp', NaN],
        ['rating', 'invalid'],
        ['id', 'invalid'],
        ['$session_id', windowId],
        ['$window_id', session],
        ['$current_url', 'https://other.test'],
    ]) {
        const bad = webVitals()
        bad.events[0].properties.$web_vitals_FCP_event[key] = value
        assert.throws(() => assertWebVitalsDelivery(bad), key)
    }
})

test('Web Vitals proof rejects matching missing or malformed identity metadata', () => {
    for (const key of ['$session_id', '$window_id', '$current_url']) {
        const missing = webVitals()
        const properties = missing.events[0].properties
        delete properties[key]
        delete properties.$web_vitals_FCP_event[key]
        assert.throws(() => assertWebVitalsDelivery(missing), `Missing ${key}`)
        for (const value of [undefined, null, false, 123, '', 'invalid', 'data:text/plain,metric']) {
            const bad = webVitals()
            bad.events[0].properties[key] = value
            bad.events[0].properties.$web_vitals_FCP_event[key] = value
            assert.throws(() => assertWebVitalsDelivery(bad), `Malformed ${key}: ${value}`)
        }
    }
    const valid = webVitals()
    valid.events[0].properties.$current_url = valid.events[0].properties.$web_vitals_FCP_event.$current_url =
        'https://fixture.test/'
    assertWebVitalsDelivery(valid)
})

test('Web Vitals normalization bounds measurements to SDK metric fields and preserves identity relationships', () => {
    const before = { network: webVitals() }
    const after = structuredClone(before)
    const properties = after.network.events[0].properties
    properties.$web_vitals_FCP_value = properties.$web_vitals_FCP_event.value = 900
    properties.$web_vitals_FCP_event.delta = 900
    properties.$web_vitals_FCP_event.rating = 'poor'
    properties.$web_vitals_FCP_event.id = 'v6-1704067200000-9876543210987'
    assert.deepEqual(normalize(before, context), normalize(after, context))
    const normalized = normalize(before, context).network.events[0].properties
    assert.equal(normalized.$session_id, normalized.$web_vitals_FCP_event.$session_id)
    assert.equal(normalized.$window_id, normalized.$web_vitals_FCP_event.$window_id)
    properties.$web_vitals_FCP_event.$session_id = windowId
    assert(differences(normalize(before, context), normalize(after, context)).length > 0)
    properties.$web_vitals_FCP_event.value = false
    assert.equal(normalize(after, context).network.events[0].properties.$web_vitals_FCP_event.value, false)
    for (const network of [before.network, after.network]) network.events[0].event = 'application-metric'
    assert(differences(normalize(before, context), normalize(after, context)).length > 0)
})

test('CSS reconstruction proof checks both the live fixture and reconstructed layout', () => {
    const good = { originalStyles: { ...expectedReplayStyles }, rebuiltStyles: { ...expectedReplayStyles } }
    assertCssReconstruction(good)
    for (const side of ['originalStyles', 'rebuiltStyles']) {
        for (const property of Object.keys(expectedReplayStyles)) {
            const bad = structuredClone(good)
            bad[side][property] = '0px'
            assert.throws(() => assertCssReconstruction(bad), /styles|declarations/)
        }
    }
})

test('legacy config proof requires a held response, preserved config and eventual recording', () => {
    const good = { configHeld: true, retainedLegacyConfig: true, startedAfterConfig: true }
    assertPersistedConfigProof(good)
    for (const key of Object.keys(good)) assert.throws(() => assertPersistedConfigProof({ ...good, [key]: false }))
})

test('automatic surveys and Web Vitals use native opt-ins across cores and entrypoints', () => {
    const sandbox = { window: {}, location: { origin: context.origin }, addEventListener() {}, Error, Date }
    vm.runInNewContext(readFileSync(new URL('./harness.js', import.meta.url), 'utf8'), sandbox)
    const lab = sandbox.window.__compat
    for (const mode of MATRIX.entrypoints) {
        lab.mode = mode
        for (const comparison of MATRIX.coreFamilies) {
            lab.comparison = comparison
            lab.scenario = 'surveys-auto'
            assert.equal(lab.options().disable_surveys, false)
            assert.equal(lab.options().disable_surveys_automatic_display, false)
            lab.scenario = 'surveys'
            assert.equal(lab.options().disable_surveys_automatic_display, true)
            lab.scenario = 'web-vitals'
            const config = JSON.parse(JSON.stringify(lab.options().capture_performance))
            assert.equal(config.web_vitals, true)
            assert.deepEqual(config.web_vitals_allowed_metrics, ['FCP'])
        }
    }
})
