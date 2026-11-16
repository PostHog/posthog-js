import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {
    assertReplayNetworkCapture,
    freezeReplayDate,
    replayNetworkCases,
    replayNetworkHeaders,
    replayNetworkPath,
} from './replay-network.mjs'

test('Replay freezes only Date while preserving explicit dates and native timing APIs', () => {
    const fixed = Date.parse('2024-01-01T00:00:00Z')
    const sandbox = {
        performance,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        requestAnimationFrame() {},
        cancelAnimationFrame() {},
    }
    vm.createContext(sandbox)
    vm.runInContext(`(${freezeReplayDate})(${fixed})`, sandbox)
    assert.equal(vm.runInContext('Date.now()', sandbox), fixed)
    assert.equal(vm.runInContext('new Date().getTime()', sandbox), fixed)
    assert.equal(vm.runInContext('Date()', sandbox), new Date(fixed).toString())
    assert.equal(vm.runInContext('new Date(123).getTime()', sandbox), 123)
    assert.equal(
        vm.runInContext('new Date("2020-01-01T00:00:00Z").getTime()', sandbox),
        Date.parse('2020-01-01T00:00:00Z')
    )
    assert.equal(vm.runInContext('new Date(2020, 0, 1).getTime()', sandbox), new Date(2020, 0, 1).getTime())
    assert.equal(vm.runInContext('Date.UTC(2020, 0, 1)', sandbox), Date.UTC(2020, 0, 1))
    assert.equal(vm.runInContext('Date.parse("2020-01-01T00:00:00Z")', sandbox), Date.parse('2020-01-01T00:00:00Z'))
    assert.equal(vm.runInContext('new Date() instanceof Date', sandbox), true)
    assert.equal(vm.runInContext('Object.prototype.toString.call(new Date())', sandbox), '[object Date]')
    assert.equal(vm.runInContext('class DerivedDate extends Date {}; new DerivedDate().getTime()', sandbox), fixed)
    assert.equal(vm.runInContext('performance', sandbox), performance)
    assert.equal(vm.runInContext('performance.now', sandbox), performance.now)
    for (const name of [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'requestAnimationFrame',
        'cancelAnimationFrame',
    ])
        assert.equal(vm.runInContext(name, sandbox), sandbox[name])
})

const origin = 'http://fixture.test'
function evidence() {
    const requests = replayNetworkCases.map((sample) => ({
        name: `${origin}${replayNetworkPath}/${sample.name}`,
        method: 'POST',
        status: 200,
        initiatorType: 'fetch',
        startTime: 10,
        endTime: 20,
        timeOrigin: 1704067200000,
        timestamp: 1704067200010,
        requestHeaders: { 'x-compat-request': 'retained', authorization: 'redacted' },
        responseHeaders: { 'x-compat-response': 'retained', authorization: 'redacted' },
        requestBody:
            sample.name === 'plain'
                ? sample.requestBody
                : '[SessionRecording] Request body redacted as might contain: password',
        responseBody:
            sample.name === 'plain'
                ? sample.responseBody
                : '[SessionRecording] Response body redacted as might contain: password',
    }))
    return {
        network: {
            snapshots: [
                {
                    properties: {
                        $snapshot_data: [{ type: 6, data: { plugin: 'rrweb/network@1', payload: { requests } } }],
                    },
                },
            ],
        },
        wire: {
            requests: replayNetworkCases.map((sample) => ({
                path: `${replayNetworkPath}/${sample.name}`,
                method: 'POST',
                status: 200,
                rawBody: sample.requestBody,
                headers: { ...replayNetworkHeaders.request },
            })),
        },
    }
}
const records = (input) => input.network.snapshots[0].properties.$snapshot_data[0].data.payload.requests
const check = ({ network, wire }) => assertReplayNetworkCapture(network, wire, origin)

test('Replay network proof requires native delivery and complete, redacted capture', () => {
    check(evidence())
    for (const mutate of [
        (input) => {
            input.wire.requests.pop()
        },
        (input) => {
            input.wire.requests.push(input.wire.requests[0])
        },
        (input) => {
            input.wire.requests[0].rawBody = 'changed'
        },
        (input) => {
            input.wire.requests[0].headers.authorization = 'redacted'
        },
        (input) => {
            records(input).pop()
        },
        (input) => {
            records(input).push(records(input)[0])
        },
        (input) => {
            records(input)[0].requestBody = '[SessionRecording] Request body redacted'
        },
        (input) => {
            delete records(input)[0].responseBody
        },
        (input) => {
            records(input)[0].status = 500
        },
        (input) => {
            records(input)[0].method = 'GET'
        },
        (input) => {
            records(input)[0].initiatorType = 'xmlhttprequest'
        },
        (input) => {
            records(input)[0].startTime = -1
        },
        (input) => {
            records(input)[0].endTime = 5
        },
        (input) => {
            records(input)[0].timestamp += 100
        },
        (input) => {
            delete records(input)[0].timeOrigin
        },
        (input) => {
            delete records(input)[0].requestHeaders
        },
        (input) => {
            records(input)[0].responseHeaders['x-compat-response'] = 'changed'
        },
        (input) => {
            records(input)[0].requestHeaders.authorization = 'private-request-header'
        },
        (input) => {
            records(input)[0].responseHeaders.authorization = 'private-response-header'
        },
        (input) => {
            records(input)[1].requestBody = replayNetworkCases[1].requestBody
        },
        (input) => {
            records(input)[1].responseBody = replayNetworkCases[1].responseBody
        },
        (input) => {
            input.network.snapshots[0].properties.$snapshot_data.push({ type: 3, data: 'private-request-header' })
        },
    ]) {
        const input = evidence()
        mutate(input)
        assert.throws(() => check(input), mutate.toString())
    }
})
