import test from 'node:test'
import assert from 'node:assert/strict'
import { normalize } from './normalize.mjs'

const context = { origin: 'http://127.0.0.1:1234', version: '1.354.0', extensionVersion: '1.438.2' }

test('Replay network normalization bounds native clocks without hiding captured content or malformed values', () => {
    const request = {
        name: `${context.origin}/__compat/replay-network/plain`,
        startTime: 10,
        endTime: 20,
        duration: 10,
        connectEnd: 2,
        finalResponseHeadersStart: 17,
        domContentLoadedEventEnd: 5,
        timeOrigin: 1704067200000,
        timestamp: 1704067200010,
        status: 200,
        requestHeaders: { ordinary: 'retained', authorization: 'redacted' },
        responseHeaders: { ordinary: 'retained' },
        requestBody: '{"timestamp":123}',
        responseBody: '{"startTime":456}',
    }
    const event = { type: 6, data: { plugin: 'rrweb/network@1', payload: { requests: [request] } } }
    const snapshot = { properties: { $snapshot_data: [event] } }
    const source = {
        application: structuredClone(event.data),
        network: { snapshots: [snapshot], requests: [{ path: '/s', body: snapshot }] },
    }
    const normalized = normalize(source, context)
    for (const bucket of [normalized.network.snapshots[0], normalized.network.requests[0].body]) {
        const record = bucket.properties.$snapshot_data[0].data.payload.requests[0]
        for (const field of [
            'startTime',
            'endTime',
            'timeOrigin',
            'timestamp',
            'duration',
            'connectEnd',
            'finalResponseHeadersStart',
            'domContentLoadedEventEnd',
        ])
            assert.equal(record[field], '<network-clock-ms>')
        assert.equal(record.name, '<fixture-origin>/__compat/replay-network/plain')
        for (const field of ['status', 'requestHeaders', 'responseHeaders', 'requestBody', 'responseBody'])
            assert.deepEqual(record[field], normalize({ value: request[field] }, context).value)
    }
    assert.equal(normalized.application.payload.requests[0].timestamp, request.timestamp)
    assert.equal(
        source.network.snapshots[0].properties.$snapshot_data[0].data.payload.requests[0].timestamp,
        request.timestamp
    )
    for (const value of ['10', null, false, -1]) {
        const malformed = structuredClone(source)
        malformed.network.snapshots[0].properties.$snapshot_data[0].data.payload.requests[0].startTime = value
        assert.equal(
            normalize(malformed, context).network.snapshots[0].properties.$snapshot_data[0].data.payload.requests[0]
                .startTime,
            value
        )
    }
    const unrelated = structuredClone(source)
    unrelated.network.snapshots[0].properties.$snapshot_data[0].data.plugin = 'application/plugin'
    assert.equal(
        normalize(unrelated, context).network.snapshots[0].properties.$snapshot_data[0].data.payload.requests[0]
            .timestamp,
        request.timestamp
    )
})

test('Replay normalizes near-origin Firefox navigation fetchStart without masking negative request clocks', () => {
    const source = (fetchStart, entryType = 'navigation', isInitial = true) => ({
        network: {
            snapshots: [
                {
                    properties: {
                        $snapshot_data: [
                            {
                                type: 6,
                                data: {
                                    plugin: 'rrweb/network@1',
                                    payload: { requests: [{ fetchStart, entryType, isInitial }] },
                                },
                            },
                        ],
                    },
                },
            ],
        },
    })
    const result = (value) =>
        normalize(value, context).network.snapshots[0].properties.$snapshot_data[0].data.payload.requests[0].fetchStart
    assert.equal(result(source(-1)), result(source(0)))
    assert.equal(result(source(-2)), -2)
    assert.equal(result(source(-1, 'resource', false)), -1)
    assert.equal(result(source(-1, 'navigation', false)), -1)
})

test('normalize asserts core and CDN replay version roles before replacing only recognized metadata', () => {
    const input = {
        network: {
            events: [
                {
                    event: 'application',
                    properties: {
                        $lib_version: '1.354.0',
                        nested: { $lib_version: '1.438.2' },
                        $os: 'Windows',
                        $device_type: 'Desktop',
                    },
                },
            ],
            snapshots: [{ properties: { $lib_version: '1.438.2', $snapshot_data: [] } }],
            requests: [{ path: '/s', body: [{ properties: { $lib_version: '1.438.2' } }] }],
        },
    }
    const normalized = normalize(input, context)
    assert.equal(normalized.network.events[0].properties.$lib_version, '<core-version>')
    assert.equal(normalized.network.snapshots[0].properties.$lib_version, '<extension-version>')
    assert.equal(normalized.network.requests[0].body[0].properties.$lib_version, '<extension-version>')
    assert.equal(normalized.network.events[0].properties.nested.$lib_version, '1.438.2')
    assert.equal(normalized.network.events[0].properties.$os, 'Windows')
    assert.equal(normalized.network.events[0].properties.$device_type, 'Desktop')
    for (const bucket of ['events', 'snapshots']) {
        const bad = structuredClone(input)
        bad.network[bucket][0].properties.$lib_version = 'unexpected'
        assert.throws(() => normalize(bad, context), /Unexpected .* metadata/)
    }
})

test('normalize validates metadata inside JSON-backed storage and preserves non-JSON values', () => {
    for (const area of ['local', 'session']) {
        const value = JSON.stringify({ $lib_version: '1.354.0', nested: { $lib_version: 'application-version' } })
        const input = { api: { storage: { [area]: { phc_COMPAT: value, malformed: '{not-json' } } } }
        const result = normalize(input, context)
        assert.equal(result.api.storage[area].phc_COMPAT.$lib_version, '<core-version>')
        assert.equal(result.api.storage[area].phc_COMPAT.nested.$lib_version, 'application-version')
        assert.equal(result.api.storage[area].malformed, '{not-json')
        input.api.storage[area].phc_COMPAT = JSON.stringify({ $lib_version: 'wrong' })
        assert.throws(() => normalize(input, context), {
            message: `Unexpected core metadata at api.storage.${area}.phc_COMPAT.$lib_version: wrong; expected 1.354.0`,
        })
    }
})

test('normalize validates OTLP scope/resource versions without erasing platform context or protocol revisions', () => {
    const input = {
        network: {
            logs: [
                {
                    resourceLogs: [
                        {
                            resource: {
                                attributes: [
                                    { key: 'telemetry.sdk.version', value: { stringValue: '1.354.0' } },
                                    { key: 'os.name', value: { stringValue: 'Windows' } },
                                ],
                            },
                            scopeLogs: [{ scope: { name: 'posthog-js', version: '1.354.0' }, logRecords: [] }],
                        },
                    ],
                },
            ],
            requests: [{ path: '/flags', query: { v: ['2'] } }],
        },
    }
    const result = normalize(input, context)
    assert.equal(result.network.logs[0].resourceLogs[0].scopeLogs[0].scope.version, '<core-version>')
    assert.equal(result.network.logs[0].resourceLogs[0].resource.attributes[1].value.stringValue, 'Windows')
    assert.equal(result.network.requests[0].query.v[0], '2')
    input.network.logs[0].resourceLogs[0].scopeLogs[0].scope.version = 'wrong'
    assert.throws(() => normalize(input, context), /Unexpected core metadata/)
})
