/* eslint-disable posthog-js/no-direct-number-check -- Standalone browser test fixtures validate delivered metric types. */
import assert from 'node:assert/strict'

// Shape written by historical cores, before recorder cache timestamps were introduced.
export const legacyRecordingConfig = {
    enabled: true,
    endpoint: '/s/',
    consoleLogRecordingEnabled: false,
    recordCanvas: false,
    canvasRecording: { enabled: false },
    minimumDurationMilliseconds: null,
    networkPayloadCapture: { capturePerformance: false },
    sampleRate: null,
}

export const expectedReplayStyles = {
    paddingTop: '32px',
    paddingBottom: '48px',
    color: 'rgb(20, 30, 40)',
    borderTopWidth: '3px',
}

export function assertWebVitalsDelivery(network) {
    const events = network.events.filter((event) => event.event === '$web_vitals')
    assert.equal(events.length, 1, 'Missing or duplicate Web Vitals delivery')
    const properties = events[0].properties
    const metric = properties.$web_vitals_FCP_event
    assert.equal(metric?.name, 'FCP', 'Missing FCP metric')
    for (const value of [properties.$web_vitals_FCP_value, metric.value, metric.delta, metric.timestamp])
        assert(typeof value === 'number' && Number.isFinite(value) && value >= 0, 'Invalid FCP measurement')
    assert.equal(properties.$web_vitals_FCP_value, metric.value, 'FCP value disagrees with its metric')
    assert(['good', 'needs-improvement', 'poor'].includes(metric.rating), 'Invalid FCP rating')
    assert.match(metric.id, /^v\d+-\d+-\d+$/, 'Invalid Web Vitals metric ID')
    for (const key of ['$session_id', '$window_id'])
        assert.match(
            properties[key],
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
            `Invalid Web Vitals ${key}`
        )
    assert.equal(typeof properties.$current_url, 'string', 'Invalid Web Vitals URL')
    assert(['http:', 'https:'].includes(new URL(properties.$current_url).protocol), 'Invalid Web Vitals URL')
    for (const key of ['$session_id', '$window_id', '$current_url'])
        assert.equal(metric[key], properties[key], `Web Vitals ${key} disagrees with its event`)
}

export function assertCssReconstruction(replay) {
    assert.deepEqual(replay.originalStyles, expectedReplayStyles, 'CSS fixture did not establish expected styles')
    assert.deepEqual(replay.rebuiltStyles, expectedReplayStyles, 'Replay lost CSS variable or CSSOM declarations')
}

export function assertPersistedConfigProof(loading) {
    assert.equal(loading.configHeld, true, 'Live config was not delayed')
    assert.equal(loading.retainedLegacyConfig, true, 'Recorder discarded legacy persisted config')
    assert.equal(loading.startedAfterConfig, true, 'Recorder did not start after live config')
}
