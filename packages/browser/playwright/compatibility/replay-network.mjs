import assert from 'node:assert/strict'
import { decodeReplay } from './normalize.mjs'

export const replayNetworkPath = '/__compat/replay-network'
export const replayNetworkCases = [
    {
        name: 'plain',
        requestBody: JSON.stringify({ message: 'compat request body' }),
        responseBody: JSON.stringify({ message: 'compat response body' }),
    },
    {
        name: 'sensitive',
        requestBody: JSON.stringify({ password: 'private-request-body' }),
        responseBody: JSON.stringify({ password: 'private-response-body' }),
    },
]
export const replayNetworkHeaders = {
    request: {
        'content-type': 'application/json',
        'x-compat-request': 'retained',
        authorization: 'private-request-header',
    },
    response: {
        'Content-Type': 'application/json',
        'X-Compat-Response': 'retained',
        Authorization: 'private-response-header',
        Date: 'Mon, 01 Jan 2024 00:00:00 GMT',
    },
}

// Keep event dates deterministic without virtualizing native fetch timing or timer scheduling.
export function freezeReplayDate(time) {
    const NativeDate = globalThis.Date
    function FixedDate(...args) {
        if (!new.target) return new NativeDate(time).toString()
        return Reflect.construct(NativeDate, args.length ? args : [time], new.target)
    }
    Object.setPrototypeOf(FixedDate, NativeDate)
    FixedDate.prototype = NativeDate.prototype
    FixedDate.now = () => time
    globalThis.Date = FixedDate
}

export function capturedReplayRequests(network) {
    return decodeReplay(network.snapshots)
        .flatMap((snapshot) => snapshot.properties?.$snapshot_data ?? [])
        .filter((event) => event.type === 6 && event.data.plugin === 'rrweb/network@1')
        .flatMap((event) => event.data.payload.requests)
}

export function assertReplayNetworkCapture(network, wire, origin) {
    const captured = capturedReplayRequests(network)
    for (const sample of replayNetworkCases) {
        const path = `${replayNetworkPath}/${sample.name}`
        const sent = wire.requests.filter((request) => request.path === path)
        assert.equal(sent.length, 1, `Missing or duplicate native ${sample.name} request`)
        assert.equal(sent[0].method, 'POST')
        assert.equal(sent[0].status, 200)
        assert.equal(sent[0].rawBody, sample.requestBody, 'Replay changed the outgoing request body')
        for (const [name, value] of Object.entries(replayNetworkHeaders.request))
            assert.equal(sent[0].headers[name], value, `Replay changed outgoing ${name}`)

        const records = captured.filter((request) => request.name === origin + path)
        assert.equal(records.length, 1, `Missing or duplicate replay ${sample.name} request`)
        const request = records[0]
        assert.equal(request.method, 'POST')
        assert.equal(request.status, 200)
        assert.equal(request.initiatorType, 'fetch')
        for (const key of ['startTime', 'endTime', 'timeOrigin', 'timestamp'])
            assert(Number.isFinite(request[key]) && request[key] >= 0, `Invalid Replay network ${key}`)
        assert(request.timeOrigin > 0 && request.timestamp > 0, 'Missing Replay network timestamp')
        assert(request.endTime >= request.startTime, 'Replay network response precedes request')
        assert(
            Math.abs(request.timestamp - (request.timeOrigin + request.startTime)) <= 1,
            'Replay network timestamp does not match its clock origin'
        )
        assert.equal(request.requestHeaders?.['x-compat-request'], 'retained')
        assert.equal(request.responseHeaders?.['x-compat-response'], 'retained')
        assert.equal(request.requestHeaders?.authorization, 'redacted')
        assert.equal(request.responseHeaders?.authorization, 'redacted')
        for (const side of ['request', 'response']) {
            if (sample.name === 'plain') assert.equal(request[`${side}Body`], sample[`${side}Body`])
            else assert.match(request[`${side}Body`] ?? '', /\[SessionRecording\].*body redacted/)
        }
    }
    const serialized = JSON.stringify(network.snapshots)
    for (const value of [
        'private-request-header',
        'private-response-header',
        'private-request-body',
        'private-response-body',
    ])
        assert(!serialized.includes(value), `Replay leaked ${value}`)
}

export async function exerciseReplayNetwork({ page, received, expect }) {
    await page.locator('#masked').fill('changed-secret-password')
    const outcomes = await page.evaluate(
        async ({ samples, path, headers }) => {
            const outcomes = []
            for (const sample of samples) {
                const response = await fetch(`${path}/${sample.name}`, {
                    method: 'POST',
                    headers,
                    body: sample.requestBody,
                })
                outcomes.push({
                    status: response.status,
                    body: await response.text(),
                    ordinaryHeader: response.headers.get('x-compat-response'),
                    sensitiveHeader: response.headers.get('authorization'),
                })
            }
            return outcomes
        },
        { samples: replayNetworkCases, path: replayNetworkPath, headers: replayNetworkHeaders.request }
    )
    assert.deepEqual(
        outcomes,
        replayNetworkCases.map((sample) => ({
            status: 200,
            body: sample.responseBody,
            ordinaryHeader: 'retained',
            sensitiveHeader: 'private-response-header',
        })),
        'Replay changed the application response'
    )
    await expect
        .poll(
            async () =>
                capturedReplayRequests(await received()).filter((request) =>
                    replayNetworkCases.some((sample) => request.name.endsWith(`${replayNetworkPath}/${sample.name}`))
                ).length,
            { message: 'Replay network requests were not delivered', timeout: 15_000 }
        )
        .toBe(replayNetworkCases.length)
}
