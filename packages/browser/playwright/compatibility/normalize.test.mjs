import test from 'node:test'
import assert from 'node:assert/strict'
import { normalize } from './normalize.mjs'

const context = { origin: 'http://127.0.0.1:1234', version: '1.354.0', extensionVersion: '1.438.2' }

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
