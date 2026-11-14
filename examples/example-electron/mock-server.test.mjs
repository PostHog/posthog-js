import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { flagKey, flagPayload, mockToken, startMockServer } from './mock-server.mjs'

test('mock-server serves decoded flags and records JSON and gzip batches', async () => {
    const observed = []
    const receiver = await startMockServer({ onEvent: (event) => observed.push(event) })
    try {
        const response = await fetch(`${receiver.host}/flags/?v=2`, { method: 'POST', body: '{}' })
        assert.equal(response.status, 200)
        const flags = await response.json()
        assert.equal(flags.featureFlags[flagKey], 'local-variant')
        assert.deepEqual(JSON.parse(flags.featureFlagPayloads[flagKey]), flagPayload)
        for (const compressed of [false, true]) {
            const body = JSON.stringify({ api_key: mockToken, batch: [{ event: 'mock_event', properties: {} }] })
            const capture = await fetch(`${receiver.host}/batch/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(compressed ? { 'Content-Encoding': 'gzip' } : {}) },
                body: compressed ? gzipSync(body) : body,
            })
            assert.equal(capture.status, 200)
            await capture.json()
        }
        assert.equal(receiver.events.length, 2)
        assert.deepEqual(observed, receiver.events)
        assert.equal(receiver.requests.length, 3)
        assert.deepEqual(receiver.errors, [])
    } finally {
        await receiver.close()
    }
})

test('mock-server rejects malformed capture and does not accept snapshot endpoints', async () => {
    const receiver = await startMockServer()
    try {
        const invalid = await fetch(`${receiver.host}/batch/`, { method: 'POST', body: '{"batch":[{}]}' })
        assert.equal(invalid.status, 400)
        await invalid.json()
        assert.equal(receiver.errors.length, 1)
        assert.deepEqual(receiver.events, [])
        const snapshot = await fetch(`${receiver.host}/s/`, { method: 'POST', body: '{}' })
        assert.equal(snapshot.status, 404)
        await snapshot.json()
        assert.equal(receiver.requests.at(-1).path, '/s/')
    } finally {
        await receiver.close()
    }
})
