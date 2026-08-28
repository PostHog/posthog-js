import { buildCaptureV1Event, sendCaptureV1Batch, sendCaptureV1Batches, type CaptureV1Message } from '../src/capture-v1'
import type { RequestRuntime } from '../src/request'
import type { BrowserFetch } from '../src/types'

const message = (overrides: Partial<CaptureV1Message> = {}): CaptureV1Message => ({
    event: 'signed_up',
    uuid: 'event-uuid',
    distinct_id: 'person-1',
    timestamp: '2026-01-02T03:04:05.000Z',
    properties: {},
    ...overrides,
})

const runtime = (fetch: BrowserFetch | undefined): RequestRuntime => [
    {
        api: 'https://example.com/proxy',
        flags: 'https://example.com/proxy',
        assets: 'https://example.com/proxy',
    },
    'ph_test',
    fetch,
    undefined,
]

describe('Capture Analytics V1', () => {
    it('builds the root event shape without mutating the normalized message', () => {
        const input = message({
            properties: {
                token: 'ph_test',
                distinct_id: 'person-1',
                plan: 'pro',
                $device_id: 'device-1',
                $groups: { company: 'posthog' },
                $unset: ['old_property'],
                $set: { email: 'person@example.com' },
                $set_once: { source: 'docs' },
                $session_id: 'session-1',
                $window_id: 'window-1',
                $lib: 'web',
                $lib_version: '1.2.3',
            },
        })
        const snapshot = structuredClone(input)

        expect(buildCaptureV1Event(input)).toEqual({
            event: 'signed_up',
            uuid: 'event-uuid',
            distinct_id: 'person-1',
            timestamp: '2026-01-02T03:04:05.000Z',
            session_id: 'session-1',
            window_id: 'window-1',
            options: {},
            properties: {
                plan: 'pro',
                $device_id: 'device-1',
                $groups: { company: 'posthog' },
                $unset: ['old_property'],
                $set: { email: 'person@example.com' },
                $set_once: { source: 'docs' },
            },
        })
        expect(input).toEqual(snapshot)
    })

    it.each([
        ['$cookieless_mode', true, 'cookieless_mode', true],
        ['$cookieless_mode', ' 0 ', 'cookieless_mode', false],
        ['$ignore_sent_at', 1, 'disable_skew_correction', true],
        ['$process_person_profile', 'FALSE', 'process_person_profile', false],
        ['$product_tour_id', 'tour-1', 'product_tour_id', 'tour-1'],
    ] as const)('promotes %s into typed options', (property, value, option, expected) => {
        const event = buildCaptureV1Event(message({ properties: { [property]: value, keep: true } }))

        expect(event.options[option]).toBe(expected)
        expect(event.properties).toEqual({ keep: true })
    })

    it('strips malformed controls without rejecting the event', () => {
        expect(
            buildCaptureV1Event(
                message({ properties: { $cookieless_mode: 'maybe', $product_tour_id: 42, keep: true } })
            )
        ).toMatchObject({ options: {}, properties: { keep: true } })
    })

    it('ignores enumerable properties inherited by the option sentinel table', () => {
        Object.defineProperty(Object.prototype, 'inherited_capture_control', {
            configurable: true,
            enumerable: true,
            get: () => {
                throw new Error('inherited control was read')
            },
        })
        try {
            expect(buildCaptureV1Event(message())).toMatchObject({ options: {}, properties: {} })
        } finally {
            delete (Object.prototype as Record<string, unknown>).inherited_capture_control
        }
    })

    it('sends the exact Fetch request contract through a proxy path', async () => {
        const requests: Array<{ url: string; init: RequestInit }> = []
        const fetch: BrowserFetch = async (input, init = {}) => {
            requests.push({ url: String(input), init })
            return new Response('{"results":{}}', { status: 200 })
        }

        const result = await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3')

        expect(result).toMatchObject({ statusCode: 200, retry: [], drops: [] })
        expect(requests).toHaveLength(1)
        expect(requests[0]?.url).toBe('https://example.com/proxy/i/v1/analytics/events')
        expect(requests[0]?.init).toMatchObject({ method: 'POST', credentials: 'omit' })
        const headers = requests[0]?.init.headers as Record<string, string>
        expect(headers).toMatchObject({
            'Content-Type': 'application/json',
            Authorization: 'Bearer ph_test',
            'PostHog-Sdk-Info': 'posthog-js/1.2.3',
            'PostHog-Attempt': '1',
        })
        expect(headers['PostHog-Request-Id']).toMatch(/^[0-9a-f-]{36}$/)
        expect(headers['PostHog-Request-Timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(headers).not.toHaveProperty('User-Agent')
        expect(headers).not.toHaveProperty('Content-Encoding')

        const body = JSON.parse(String(requests[0]?.init.body)) as Record<string, unknown>
        expect(body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(body.batch).toEqual([buildCaptureV1Event(message())])
        expect(body).not.toHaveProperty('api_key')
        expect(body).not.toHaveProperty('token')
        expect(body).not.toHaveProperty('sent_at')
    })

    describe('batch partitioning', () => {
        const fixedNow = Date.parse('2026-01-02T03:04:05.000Z')
        const requestBodies = (requests: RequestInit[]): string[] => requests.map(({ body }) => String(body))

        it('partitions 101 events at the canonical 100-event boundary without reordering', async () => {
            const requests: RequestInit[] = []
            const fetch: BrowserFetch = async (_input, init = {}) => {
                requests.push(init)
                return new Response('{"results":{}}', { status: 200 })
            }
            const events = Array.from({ length: 101 }, (_, index) =>
                message({ event: `event-${index}`, uuid: `uuid-${index}` })
            )

            const result = await sendCaptureV1Batches(runtime(fetch), events, '1.2.3', {
                now: () => fixedNow,
            })

            expect(result).toMatchObject({ statusCode: 200, retry: [], drops: [] })
            const batches = requestBodies(requests).map((body) => JSON.parse(body).batch as CaptureV1Message[])
            expect(batches.map((batch) => batch.length)).toEqual([100, 1])
            expect(batches.flat().map(({ uuid }) => uuid)).toEqual(events.map(({ uuid }) => uuid))
        })

        it.each([
            ['ASCII', 'plain-text'],
            ['multibyte', 'héllo 😀'],
        ])('uses exact UTF-8 envelope bytes at the %s boundary', async (_label, value) => {
            const events = [
                message({ uuid: 'first', properties: { value } }),
                message({ uuid: 'second', properties: { value } }),
            ]
            const baseline: RequestInit[] = []
            await sendCaptureV1Batches(
                runtime(async (_input, init = {}) => {
                    baseline.push(init)
                    return new Response('{"results":{}}', { status: 200 })
                }),
                events,
                '1.2.3',
                { now: () => fixedNow, targetBatchBytes: Number.MAX_SAFE_INTEGER }
            )
            const exactBytes = new TextEncoder().encode(String(baseline[0]?.body)).length

            const atBoundary: RequestInit[] = []
            await sendCaptureV1Batches(
                runtime(async (_input, init = {}) => {
                    atBoundary.push(init)
                    return new Response('{"results":{}}', { status: 200 })
                }),
                events,
                '1.2.3',
                { now: () => fixedNow, targetBatchBytes: exactBytes }
            )
            const belowBoundary: RequestInit[] = []
            await sendCaptureV1Batches(
                runtime(async (_input, init = {}) => {
                    belowBoundary.push(init)
                    return new Response('{"results":{}}', { status: 200 })
                }),
                events,
                '1.2.3',
                { now: () => fixedNow, targetBatchBytes: exactBytes - 1 }
            )

            expect(atBoundary).toHaveLength(1)
            expect(new TextEncoder().encode(String(atBoundary[0]?.body))).toHaveLength(exactBytes)
            expect(belowBoundary).toHaveLength(2)
        })

        it('sends one event alone when it exceeds the soft byte target', async () => {
            const requests: RequestInit[] = []
            await sendCaptureV1Batches(
                runtime(async (_input, init = {}) => {
                    requests.push(init)
                    return new Response('{"results":{}}', { status: 200 })
                }),
                [message({ properties: { value: 'é'.repeat(100) } })],
                '1.2.3',
                { now: () => fixedNow, targetBatchBytes: 1 }
            )

            expect(requests).toHaveLength(1)
            expect(new TextEncoder().encode(String(requests[0]?.body)).length).toBeGreaterThan(1)
        })

        it('sends byte-partitioned requests sequentially', async () => {
            const requests: RequestInit[] = []
            let finishFirst: ((response: Response) => void) | undefined
            const first = new Promise<Response>((resolve) => {
                finishFirst = resolve
            })
            const fetch = jest
                .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
                .mockImplementationOnce(async (_input, init = {}) => {
                    requests.push(init)
                    return first
                })
                .mockImplementation(async (_input, init = {}) => {
                    requests.push(init)
                    return new Response('{"results":{}}', { status: 200 })
                })

            const delivery = sendCaptureV1Batches(
                runtime(fetch),
                [message({ uuid: 'first' }), message({ uuid: 'second' })],
                '1.2.3',
                { now: () => fixedNow, maxBatchEvents: 1 }
            )
            await Promise.resolve()
            await Promise.resolve()
            expect(fetch).toHaveBeenCalledTimes(1)

            finishFirst?.(new Response('{"results":{}}', { status: 200 }))
            await delivery
            expect(fetch).toHaveBeenCalledTimes(2)
            expect(requestBodies(requests).map((body) => JSON.parse(body).batch[0].uuid)).toEqual(['first', 'second'])
        })

        it('coordinates partial retries independently across multiple requests', async () => {
            const requests: RequestInit[] = []
            const fetch: BrowserFetch = async (_input, init = {}) => {
                requests.push(init)
                const uuids = (JSON.parse(String(init.body)).batch as CaptureV1Message[]).map(({ uuid }) => uuid)
                return new Response(
                    JSON.stringify({
                        results:
                            requests.length === 1
                                ? { [uuids[1]!]: { result: 'retry' } }
                                : Object.fromEntries(uuids.map((uuid) => [uuid, { result: 'ok' }])),
                    }),
                    { status: 200 }
                )
            }

            const result = await sendCaptureV1Batches(
                runtime(fetch),
                ['a', 'b', 'c', 'd'].map((uuid) => message({ uuid })),
                '1.2.3',
                { now: () => fixedNow, maxBatchEvents: 2, sleep: async () => {}, random: () => 0.5 }
            )

            expect(
                requestBodies(requests).map((body) => JSON.parse(body).batch.map(({ uuid }: CaptureV1Message) => uuid))
            ).toEqual([['a', 'b'], ['b'], ['c', 'd']])
            expect(result).toMatchObject({ statusCode: 200, retry: [], drops: [] })
        })

        it('treats a 413 as terminal for its request and continues later batches without splitting', async () => {
            const requests: RequestInit[] = []
            const fetch: BrowserFetch = async (_input, init = {}) => {
                requests.push(init)
                return requests.length === 1
                    ? new Response('too large', { status: 413 })
                    : new Response('{"results":{}}', { status: 200 })
            }

            const result = await sendCaptureV1Batches(
                runtime(fetch),
                ['a', 'b', 'c', 'd'].map((uuid) => message({ uuid })),
                '1.2.3',
                { now: () => fixedNow, maxBatchEvents: 2 }
            )

            expect(requests).toHaveLength(2)
            expect(requestBodies(requests).map((body) => JSON.parse(body).batch.length)).toEqual([2, 2])
            expect(result.retry).toEqual([])
            expect(result.error).toBeInstanceOf(Error)
        })

        it('returns only never-attempted batches when delivery is cancelled between requests', async () => {
            let canRetryChecks = 0
            const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>(async (_input, init = {}) => {
                const uuid = (JSON.parse(String(init.body)).batch as CaptureV1Message[])[0]!.uuid
                return new Response(
                    JSON.stringify({ results: { [uuid]: { result: 'drop', details: 'not_persisted' } } }),
                    { status: 200 }
                )
            })

            const result = await sendCaptureV1Batches(
                runtime(fetch),
                ['accepted', 'unsent-1', 'unsent-2'].map((uuid) => message({ uuid })),
                '1.2.3',
                {
                    now: () => fixedNow,
                    maxBatchEvents: 1,
                    canRetry: () => ++canRetryChecks <= 2,
                }
            )

            expect(fetch).toHaveBeenCalledTimes(1)
            expect(result.retry).toEqual(['unsent-1', 'unsent-2'])
            expect(result.error).toHaveProperty('message', 'Capture V1 dropped one or more events')
            expect(result.terminalError).toHaveProperty('message', 'Capture V1 retry was cancelled')
        })

        it('preserves source identity for an unsent duplicate UUID after an accepted batch', async () => {
            let canRetryChecks = 0
            const accepted = message({ event: 'accepted', uuid: 'duplicate' })
            const unsent = message({ event: 'unsent', uuid: 'duplicate' })

            const result = await sendCaptureV1Batches(
                runtime(async () => new Response('{"results":{}}', { status: 200 })),
                [accepted, unsent],
                '1.2.3',
                {
                    now: () => fixedNow,
                    maxBatchEvents: 1,
                    canRetry: () => ++canRetryChecks <= 2,
                }
            )

            expect(result.retry).toEqual(['duplicate'])
            expect(result.retryMessages).toEqual([unsent])
            expect(result.retryMessages).not.toContain(accepted)
        })
    })

    describe('compression', () => {
        it('sends valid native gzip for an eligible exact V1 envelope', async () => {
            let request: RequestInit | undefined
            const result = await sendCaptureV1Batch(
                runtime(async (_input, init = {}) => {
                    request = init
                    return new Response('{"results":{}}', { status: 200 })
                }),
                [message({ properties: { value: 'compressible'.repeat(200) } })],
                '1.2.3',
                { compressionEnabled: true, compressionThresholdBytes: 0 }
            )

            expect(result).toMatchObject({ statusCode: 200, retry: [], drops: [] })
            expect(request?.headers).toMatchObject({ 'Content-Encoding': 'gzip', 'Content-Type': 'application/json' })
            expect(request?.body).toBeInstanceOf(Blob)
            const decompressed = await new Response(
                (request?.body as Blob).stream().pipeThrough(new DecompressionStream('gzip'))
            ).json()
            expect(decompressed).toMatchObject({ batch: [{ uuid: 'event-uuid' }] })
        })

        it('does not compress a body below the configured threshold', async () => {
            const compress = jest.fn(async () => new Blob(['gzip']))
            let request: RequestInit | undefined
            await sendCaptureV1Batch(
                runtime(async (_input, init = {}) => {
                    request = init
                    return new Response('{"results":{}}', { status: 200 })
                }),
                [message()],
                '1.2.3',
                { compressionEnabled: true, compressionThresholdBytes: Number.MAX_SAFE_INTEGER, compress }
            )

            expect(compress).not.toHaveBeenCalled()
            expect(request?.body).toEqual(expect.any(String))
            expect(request?.headers).not.toHaveProperty('Content-Encoding')
        })

        it.each([
            ['failure', () => Promise.reject(new Error('compression failed'))],
            ['expansion', (payload: string) => Promise.resolve(new Blob([payload, payload]))],
        ])('falls back to the unchanged JSON body on compression %s', async (_label, compress) => {
            let request: RequestInit | undefined
            await sendCaptureV1Batch(
                runtime(async (_input, init = {}) => {
                    request = init
                    return new Response('{"results":{}}', { status: 200 })
                }),
                [message()],
                '1.2.3',
                { compressionEnabled: true, compressionThresholdBytes: 0, compress }
            )

            expect(request?.body).toEqual(expect.any(String))
            expect(JSON.parse(String(request?.body)).batch).toHaveLength(1)
            expect(request?.headers).not.toHaveProperty('Content-Encoding')
            expect((request?.headers as Record<string, string>)['PostHog-Attempt']).toBe('1')
        })

        it('falls back when the native compression capability is hostile', async () => {
            const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'CompressionStream')
            let request: RequestInit | undefined
            try {
                Object.defineProperty(globalThis, 'CompressionStream', {
                    configurable: true,
                    get() {
                        throw new Error('blocked capability')
                    },
                })
                await sendCaptureV1Batch(
                    runtime(async (_input, init = {}) => {
                        request = init
                        return new Response('{"results":{}}', { status: 200 })
                    }),
                    [message({ properties: { value: 'x'.repeat(2_000) } })],
                    '1.2.3',
                    { compressionEnabled: true, compressionThresholdBytes: 0 }
                )
            } finally {
                if (descriptor) {
                    Object.defineProperty(globalThis, 'CompressionStream', descriptor)
                } else {
                    delete (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream
                }
            }

            expect(request?.body).toEqual(expect.any(String))
            expect(request?.headers).not.toHaveProperty('Content-Encoding')
        })

        it('stops before Fetch when continuation is revoked during compression without a signal', async () => {
            let allowed = true
            let startCompression: (() => void) | undefined
            let finishCompression: ((body: Blob) => void) | undefined
            const compressionStarted = new Promise<void>((resolve) => {
                startCompression = resolve
            })
            const compression = new Promise<Blob>((resolve) => {
                finishCompression = resolve
            })
            const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            const delivery = sendCaptureV1Batch(
                runtime(fetch),
                [message({ properties: { value: 'x'.repeat(2_000) } })],
                '1.2.3',
                {
                    compressionEnabled: true,
                    compressionThresholdBytes: 0,
                    canRetry: () => allowed,
                    compress: () => {
                        startCompression?.()
                        return compression
                    },
                }
            )

            await compressionStarted
            allowed = false
            finishCompression?.(new Blob([new Uint8Array([0])]))
            const result = await delivery

            expect(fetch).not.toHaveBeenCalled()
            expect(result.retry).toEqual(['event-uuid'])
            expect(result.error).toHaveProperty('message', 'Capture V1 retry was cancelled')
        })

        it('falls back when native compression returns malformed gzip', async () => {
            const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'CompressionStream')
            let request: RequestInit | undefined
            try {
                class MalformedCompressionStream {
                    readonly readable = new ReadableStream<Uint8Array>({
                        start(controller) {
                            controller.enqueue(new Uint8Array([0x1f, 0x8b, 0x08]))
                            controller.close()
                        },
                    })
                    readonly writable = new WritableStream<Uint8Array>()
                }
                Object.defineProperty(globalThis, 'CompressionStream', {
                    configurable: true,
                    value: MalformedCompressionStream,
                })
                await sendCaptureV1Batch(
                    runtime(async (_input, init = {}) => {
                        request = init
                        return new Response('{"results":{}}', { status: 200 })
                    }),
                    [message({ properties: { value: 'x'.repeat(2_000) } })],
                    '1.2.3',
                    { compressionEnabled: true, compressionThresholdBytes: 0 }
                )
            } finally {
                if (descriptor) {
                    Object.defineProperty(globalThis, 'CompressionStream', descriptor)
                } else {
                    delete (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream
                }
            }

            expect(request?.body).toEqual(expect.any(String))
            expect(request?.headers).not.toHaveProperty('Content-Encoding')
        })

        it('bounds stalled compression and sends the original request without consuming an attempt', async () => {
            jest.useFakeTimers()
            try {
                const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>(
                    async () => new Response('{"results":{}}', { status: 200 })
                )
                const delivery = sendCaptureV1Batch(
                    runtime(fetch),
                    [message({ properties: { value: 'x'.repeat(2_000) } })],
                    '1.2.3',
                    {
                        compressionEnabled: true,
                        compressionThresholdBytes: 0,
                        compressionTimeoutMs: 10,
                        compress: () => new Promise(() => {}),
                    }
                )
                await jest.advanceTimersByTimeAsync(10)
                const result = await delivery

                expect(fetch).toHaveBeenCalledTimes(1)
                expect(fetch.mock.calls[0]?.[1]?.body).toEqual(expect.any(String))
                expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Content-Encoding')
                expect(result).toMatchObject({ statusCode: 200, retry: [], drops: [] })
            } finally {
                jest.useRealTimers()
            }
        })

        it('recompresses only the pruned partial-retry envelope with stable logical metadata', async () => {
            const payloads: string[] = []
            const requests: RequestInit[] = []
            const compress = jest.fn(async (payload: string) => {
                payloads.push(payload)
                return new Blob([new Uint8Array([0])])
            })
            const fetch: BrowserFetch = async (_input, init = {}) => {
                requests.push(init)
                return requests.length === 1
                    ? new Response('{"results":{"retry":{"result":"retry"}}}', { status: 200 })
                    : new Response('{"results":{}}', { status: 200 })
            }

            const result = await sendCaptureV1Batch(
                runtime(fetch),
                [message({ uuid: 'accepted' }), message({ uuid: 'retry' })],
                '1.2.3',
                {
                    compressionEnabled: true,
                    compressionThresholdBytes: 0,
                    compress,
                    sleep: async () => {},
                    random: () => 0.5,
                    generateRequestId: () => 'stable-request',
                }
            )

            expect(
                payloads.map((payload) => JSON.parse(payload).batch.map(({ uuid }: CaptureV1Message) => uuid))
            ).toEqual([['accepted', 'retry'], ['retry']])
            expect(requests.map(({ headers }) => (headers as Record<string, string>)['PostHog-Request-Id'])).toEqual([
                'stable-request',
                'stable-request',
            ])
            expect(payloads.map((payload) => JSON.parse(payload).created_at)).toEqual([
                JSON.parse(payloads[0]!).created_at,
                JSON.parse(payloads[0]!).created_at,
            ])
            expect(result).toMatchObject({ statusCode: 200, retry: [], drops: [] })
        })
    })

    it.each(['ok', 'warning', 'future-result'])('accepts the %s result without retrying', async (code) => {
        const fetch: BrowserFetch = async () =>
            new Response(JSON.stringify({ results: { 'event-uuid': { result: code } } }), { status: 200 })

        const result = await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3')

        expect(result).toMatchObject({ statusCode: 200, retry: [], drops: [] })
        expect(result).not.toHaveProperty('error')
    })

    it.each([
        ['a missing UUID result', { results: { other: { result: 'retry' } } }],
        ['an omitted results map', { status: 1 }],
    ])('accepts %s', async (_label, body) => {
        const fetch: BrowserFetch = async () => new Response(JSON.stringify(body), { status: 200 })

        const result = await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3')

        expect(result).toMatchObject({ statusCode: 200, retry: [], drops: [] })
        expect(result).not.toHaveProperty('error')
    })

    it('classifies retry and drop results without throwing', async () => {
        const fetch: BrowserFetch = async () =>
            new Response(
                JSON.stringify({
                    results: {
                        retry: { result: 'retry' },
                        drop: { result: 'drop', details: 'invalid event' },
                    },
                }),
                { status: 200 }
            )

        const result = await sendCaptureV1Batch(
            runtime(fetch),
            [message({ uuid: 'accepted' }), message({ uuid: 'retry' }), message({ uuid: 'drop' })],
            '1.2.3',
            { maxAttempts: 1 }
        )

        expect(result.retry).toEqual(['retry'])
        expect(result.drops).toEqual([{ uuid: 'drop', details: 'invalid event' }])
        expect(result.error).toBeInstanceOf(Error)
    })

    it.each([
        ['missing Fetch', undefined],
        ['a rejected Fetch', (() => Promise.reject(new Error('offline'))) as BrowserFetch],
    ])('contains %s failures', async (_label, fetch) => {
        await expect(
            sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', { maxAttempts: 1 })
        ).resolves.toMatchObject({
            statusCode: 0,
            retry: ['event-uuid'],
            drops: [],
            error: expect.anything(),
        })
    })

    it.each([
        ['invalid JSON', 'not-json'],
        ['a non-object body', '[]'],
        ['a non-object results map', '{"results":[]}'],
    ])('treats %s in a 2xx response as a terminal failure', async (_label, body) => {
        const fetch: BrowserFetch = async () => new Response(body, { status: 200 })

        await expect(sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3')).resolves.toMatchObject({
            statusCode: 200,
            retry: [],
            drops: [],
            error: expect.anything(),
        })
    })

    it.each([408, 500, 502, 503, 504])('classifies HTTP %s as retryable without retrying yet', async (status) => {
        const fetch: BrowserFetch = async () => new Response('{}', { status })

        await expect(
            sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', { maxAttempts: 1 })
        ).resolves.toMatchObject({
            statusCode: status,
            retry: ['event-uuid'],
            drops: [],
        })
    })

    it.each([400, 401, 402, 403, 413, 415, 429])('treats HTTP %s as terminal', async (status) => {
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status }))

        await expect(sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3')).resolves.toMatchObject({
            statusCode: status,
            retry: [],
            drops: [],
            error: expect.anything(),
        })
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it.each([
        [429, []],
        [503, ['event-uuid']],
    ])('preserves HTTP %s classification when reading its body fails', async (status, retry) => {
        const fetch: BrowserFetch = async () =>
            ({
                ok: false,
                status,
                text: () => Promise.reject(new Error('body stream failed')),
            }) as Response

        await expect(
            sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', { maxAttempts: 1 })
        ).resolves.toMatchObject({
            statusCode: status,
            retry,
            drops: [],
            error: expect.anything(),
        })
    })

    it.each([200, 503])('retries HTTP %s when reading its body fails', async (status) => {
        const failedBodyResponse = {
            status,
            headers: new Headers(),
            text: () => Promise.reject(new Error('body stream failed')),
        } as Response
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValueOnce(failedBodyResponse)
            .mockResolvedValueOnce(new Response('{"results":{}}', { status: 200 }))
        const sleep = jest.fn().mockResolvedValue(undefined)

        const result = await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
            maxAttempts: 2,
            sleep,
            random: () => 0.5,
        })

        expect(fetch).toHaveBeenCalledTimes(2)
        expect(sleep).toHaveBeenCalledWith(3_000)
        expect(result).toMatchObject({ statusCode: 200, retry: [], drops: [] })
    })

    it('retries only instructed events while preserving logical batch metadata', async () => {
        const requests: RequestInit[] = []
        const fetch: BrowserFetch = async (_input, init = {}) => {
            requests.push(init)
            return requests.length === 1
                ? new Response(
                      JSON.stringify({
                          results: {
                              accepted: { result: 'ok' },
                              retry: { result: 'retry' },
                              drop: { result: 'drop', details: 'invalid event' },
                          },
                      }),
                      { status: 200 }
                  )
                : new Response(JSON.stringify({ results: { retry: { result: 'ok' } } }), { status: 200 })
        }
        const times = [
            Date.parse('2026-01-01T00:00:00.000Z'),
            Date.parse('2026-01-01T00:00:01.000Z'),
            Date.parse('2026-01-01T00:00:02.000Z'),
        ]
        const sleep = jest.fn().mockResolvedValue(undefined)

        const result = await sendCaptureV1Batch(
            runtime(fetch),
            [message({ uuid: 'accepted' }), message({ uuid: 'retry' }), message({ uuid: 'drop' })],
            '1.2.3',
            {
                now: () => times.shift() ?? 0,
                random: () => 0.5,
                sleep,
                generateRequestId: () => 'request-id',
            }
        )

        expect(requests).toHaveLength(2)
        const firstBody = JSON.parse(String(requests[0]?.body)) as {
            created_at: string
            batch: CaptureV1Message[]
        }
        const secondBody = JSON.parse(String(requests[1]?.body)) as typeof firstBody
        expect(firstBody.batch.map(({ uuid }) => uuid)).toEqual(['accepted', 'retry', 'drop'])
        expect(secondBody.batch.map(({ uuid }) => uuid)).toEqual(['retry'])
        expect(secondBody.created_at).toBe(firstBody.created_at)
        expect(secondBody.batch[0]).toMatchObject(firstBody.batch[1] ?? {})

        const firstHeaders = requests[0]?.headers as Record<string, string>
        const secondHeaders = requests[1]?.headers as Record<string, string>
        expect(firstHeaders['PostHog-Request-Id']).toBe('request-id')
        expect(secondHeaders['PostHog-Request-Id']).toBe('request-id')
        expect(firstHeaders['PostHog-Attempt']).toBe('1')
        expect(secondHeaders['PostHog-Attempt']).toBe('2')
        expect(firstHeaders['PostHog-Request-Timestamp']).not.toBe(secondHeaders['PostHog-Request-Timestamp'])
        expect(sleep).toHaveBeenCalledWith(3_000)
        expect(result.retry).toEqual([])
        expect(result.drops).toEqual([{ uuid: 'drop', details: 'invalid event' }])
        expect(result.outcomes).toEqual({
            accepted: { result: 'ok' },
            retry: { result: 'ok' },
            drop: { result: 'drop', details: 'invalid event' },
        })
        expect(result.error).toBeInstanceOf(Error)
        expect(result.terminalError).toBeUndefined()
    })

    it.each([408, 500, 502, 503, 504])('retries transient HTTP %s and then succeeds', async (status) => {
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValueOnce(new Response('{}', { status }))
            .mockResolvedValueOnce(new Response('{"results":{}}', { status: 200 }))
        const sleep = jest.fn().mockResolvedValue(undefined)

        const result = await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
            maxAttempts: 2,
            sleep,
            random: () => 0.5,
        })

        expect(fetch).toHaveBeenCalledTimes(2)
        expect(sleep).toHaveBeenCalledWith(3_000)
        expect(result).toMatchObject({ statusCode: 200, retry: [], drops: [] })
        expect(result).not.toHaveProperty('error')
    })

    it('retries a transport failure and then succeeds', async () => {
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(new Response('{"results":{}}', { status: 200 }))
        const sleep = jest.fn().mockResolvedValue(undefined)

        const result = await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
            maxAttempts: 2,
            sleep,
            random: () => 0.5,
        })

        expect(fetch).toHaveBeenCalledTimes(2)
        expect(sleep).toHaveBeenCalledWith(3_000)
        expect(result).toMatchObject({ statusCode: 200, retry: [], drops: [] })
    })

    it.each([
        [0, 1_500],
        [0.5, 3_000],
        [1, 4_500],
    ])('applies bounded jitter for random value %s', async (randomValue, expectedDelay) => {
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValueOnce(new Response('{}', { status: 503 }))
            .mockResolvedValueOnce(new Response('{"results":{}}', { status: 200 }))
        const sleep = jest.fn().mockResolvedValue(undefined)

        await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
            maxAttempts: 2,
            sleep,
            random: () => randomValue,
        })

        expect(sleep).toHaveBeenCalledWith(expectedDelay)
    })

    it.each([
        [
            'delta seconds on a partial retry',
            () =>
                new Response('{"results":{"event-uuid":{"result":"retry"}}}', {
                    status: 200,
                    headers: { 'Retry-After': '10' },
                }),
            Date.parse('2026-01-01T00:00:00.000Z'),
            10_000,
        ],
        [
            'an HTTP date on a transient response',
            () =>
                new Response('{}', {
                    status: 503,
                    headers: { 'Retry-After': 'Thu, 01 Jan 2026 00:00:20 GMT' },
                }),
            Date.parse('2026-01-01T00:00:00.000Z'),
            20_000,
        ],
    ] as const)('honors %s', async (_label, firstResponse, now, expectedDelay) => {
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValueOnce(firstResponse())
            .mockResolvedValueOnce(new Response('{"results":{}}', { status: 200 }))
        const sleep = jest.fn().mockResolvedValue(undefined)

        await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
            maxAttempts: 2,
            now: () => now,
            sleep,
            random: () => 0.5,
        })

        expect(sleep).toHaveBeenCalledWith(expectedDelay)
    })

    it('ignores an overflowing Retry-After value', async () => {
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValueOnce(
                new Response('{}', { status: 503, headers: { 'Retry-After': `9${'0'.repeat(305)}` } })
            )
            .mockResolvedValueOnce(new Response('{"results":{}}', { status: 200 }))
        const sleep = jest.fn().mockResolvedValue(undefined)

        await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
            maxAttempts: 2,
            sleep,
            random: () => 0.5,
        })

        expect(sleep).toHaveBeenCalledWith(3_000)
    })

    it('clamps Retry-After to the maximum backoff', async () => {
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValueOnce(new Response('{}', { status: 503, headers: { 'Retry-After': '120' } }))
            .mockResolvedValueOnce(new Response('{"results":{}}', { status: 200 }))
        const sleep = jest.fn().mockResolvedValue(undefined)

        await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
            maxAttempts: 2,
            maxBackoffMs: 30_000,
            sleep,
            random: () => 0.5,
        })

        expect(sleep).toHaveBeenCalledWith(30_000)
    })

    it('surfaces only the remaining UUIDs after retry exhaustion', async () => {
        const requests: RequestInit[] = []
        const fetch: BrowserFetch = async (_input, init = {}) => {
            requests.push(init)
            return new Response('{"results":{"retry":{"result":"retry"}}}', { status: 200 })
        }
        const sleep = jest.fn().mockResolvedValue(undefined)

        const result = await sendCaptureV1Batch(
            runtime(fetch),
            [message({ uuid: 'accepted' }), message({ uuid: 'retry' })],
            '1.2.3',
            { maxAttempts: 3, initialRetryDelayMs: 100, sleep, random: () => 0.5 }
        )

        expect(requests).toHaveLength(3)
        expect(
            requests.map(({ body }) =>
                (JSON.parse(String(body)) as { batch: CaptureV1Message[] }).batch.map(({ uuid }) => uuid)
            )
        ).toEqual([['accepted', 'retry'], ['retry'], ['retry']])
        expect(sleep.mock.calls).toEqual([[100], [200]])
        expect(result.retry).toEqual(['retry'])
        expect(result.error).toBeInstanceOf(Error)
    })

    it.each([
        [Number.NaN, 4],
        [Number.POSITIVE_INFINITY, 4],
        [-1, 1],
        [2.9, 2],
    ])('normalizes an attempt budget of %s to %s attempts', async (maxAttempts, expectedAttempts) => {
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 503 }))

        await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
            maxAttempts,
            initialRetryDelayMs: 0,
            maxBackoffMs: 0,
            elapsedNow: () => 0,
            sleep: async () => {},
        })

        expect(fetch).toHaveBeenCalledTimes(expectedAttempts)
    })

    it('always makes one attempt when the attempt budget is zero', async () => {
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 503 }))
        const sleep = jest.fn().mockResolvedValue(undefined)

        const result = await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', { maxAttempts: 0, sleep })

        expect(fetch).toHaveBeenCalledTimes(1)
        expect(sleep).not.toHaveBeenCalled()
        expect(result.retry).toEqual(['event-uuid'])
    })

    it('stops before backoff when retry permission is revoked', async () => {
        let canRetry = true
        const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>().mockImplementation(async () => {
            canRetry = false
            return new Response('{}', { status: 503 })
        })
        const sleep = jest.fn().mockResolvedValue(undefined)

        const result = await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
            sleep,
            canRetry: () => canRetry,
        })

        expect(fetch).toHaveBeenCalledTimes(1)
        expect(sleep).not.toHaveBeenCalled()
        expect(result.retry).toEqual(['event-uuid'])
        expect(result.error).toBeInstanceOf(Error)
    })

    it('rechecks retry permission after backoff', async () => {
        let canRetry = true
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 503 }))
        const sleep = jest.fn().mockImplementation(async () => {
            canRetry = false
        })

        const result = await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
            sleep,
            canRetry: () => canRetry,
        })

        expect(fetch).toHaveBeenCalledTimes(1)
        expect(sleep).toHaveBeenCalledTimes(1)
        expect(result.retry).toEqual(['event-uuid'])
        expect(result.error).toBeInstanceOf(Error)
    })

    it('aborts a request that stalls before response headers', async () => {
        jest.useFakeTimers()
        try {
            let signal: AbortSignal | undefined
            const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>().mockImplementation(
                async (_input, init = {}) =>
                    new Promise<Response>((_resolve, reject) => {
                        signal = init.signal ?? undefined
                        if (signal) {
                            signal.onabort = () => reject(new Error('Fetch observed abort'))
                        }
                    })
            )

            const delivery = sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
                maxAttempts: 1,
                requestTimeoutMs: 1_000,
                maxElapsedMs: 5_000,
            })
            await jest.advanceTimersByTimeAsync(999)
            expect(fetch).toHaveBeenCalledTimes(1)

            await jest.advanceTimersByTimeAsync(1)
            const result = await delivery

            expect(signal?.aborted).toBe(true)
            expect(result).toMatchObject({ statusCode: 0, retry: ['event-uuid'], error: expect.anything() })
            expect(result.error).toMatchObject({
                name: 'AbortError',
                message: 'Capture V1 request timed out waiting for response headers after 1000ms',
            })
            expect(jest.getTimerCount()).toBe(0)
        } finally {
            jest.useRealTimers()
        }
    })

    it('cancels an active request when the owning lane aborts', async () => {
        jest.useFakeTimers()
        try {
            const controller = new AbortController()
            let requestSignal: AbortSignal | undefined
            const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>().mockImplementation(
                async (_input, init = {}) =>
                    new Promise<Response>((_resolve, reject) => {
                        requestSignal = init.signal ?? undefined
                        if (requestSignal) {
                            requestSignal.onabort = () => reject(new Error('Fetch observed abort'))
                        }
                    })
            )

            const delivery = sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
                maxAttempts: 4,
                requestTimeoutMs: 10_000,
                maxElapsedMs: 60_000,
                signal: controller.signal,
            })
            await jest.advanceTimersByTimeAsync(0)
            controller.abort()
            const result = await delivery

            expect(requestSignal?.aborted).toBe(true)
            expect(fetch).toHaveBeenCalledTimes(1)
            expect(result.retry).toEqual(['event-uuid'])
            expect(result.error).toHaveProperty('message', 'Capture V1 retry was cancelled')
            expect(jest.getTimerCount()).toBe(0)
        } finally {
            jest.useRealTimers()
        }
    })

    it('cancels the body when an injected Fetch resolves after its timeout', async () => {
        jest.useFakeTimers()
        try {
            let resolveFetch: ((response: Response) => void) | undefined
            const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>().mockImplementation(
                () =>
                    new Promise<Response>((resolve) => {
                        resolveFetch = resolve
                    })
            )

            const delivery = sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
                maxAttempts: 1,
                requestTimeoutMs: 1_000,
                maxElapsedMs: 5_000,
            })
            await jest.advanceTimersByTimeAsync(1_000)
            await delivery

            const cancel = jest.fn().mockResolvedValue(undefined)
            resolveFetch?.({ body: { cancel } } as unknown as Response)
            await Promise.resolve()

            expect(cancel).toHaveBeenCalledTimes(1)
            expect(jest.getTimerCount()).toBe(0)
        } finally {
            jest.useRealTimers()
        }
    })

    it('retries when reading a successful response body times out', async () => {
        jest.useFakeTimers()
        try {
            const cancel = jest.fn().mockResolvedValue(undefined)
            const stalledResponse = {
                status: 200,
                headers: new Headers(),
                body: { cancel },
                text: () => new Promise<string>(() => {}),
            } as unknown as Response
            const fetch = jest
                .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
                .mockResolvedValueOnce(stalledResponse)
                .mockResolvedValueOnce(new Response('{"results":{}}', { status: 200 }))
            const sleep = jest.fn().mockResolvedValue(undefined)

            const delivery = sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
                maxAttempts: 2,
                requestTimeoutMs: 1_000,
                maxElapsedMs: 5_000,
                sleep,
                random: () => 0.5,
            })
            await jest.advanceTimersByTimeAsync(1_000)
            const result = await delivery

            expect(cancel).toHaveBeenCalledTimes(1)
            expect(fetch).toHaveBeenCalledTimes(2)
            expect(sleep).toHaveBeenCalledWith(3_000)
            expect(result).toMatchObject({ statusCode: 200, retry: [], drops: [] })
            expect(jest.getTimerCount()).toBe(0)
        } finally {
            jest.useRealTimers()
        }
    })

    it('clamps an attempt timeout to the remaining elapsed budget', async () => {
        jest.useFakeTimers()
        try {
            const fetch = jest
                .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
                .mockImplementation(async () => new Promise<Response>(() => {}))

            const delivery = sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
                maxAttempts: 1,
                requestTimeoutMs: 1_000,
                maxElapsedMs: 500,
            })
            await jest.advanceTimersByTimeAsync(499)
            expect(fetch).toHaveBeenCalledTimes(1)

            await jest.advanceTimersByTimeAsync(1)
            const result = await delivery

            expect(result.error).toMatchObject({
                name: 'AbortError',
                message: 'Capture V1 request timed out waiting for response headers after 500ms',
            })
            expect(jest.getTimerCount()).toBe(0)
        } finally {
            jest.useRealTimers()
        }
    })

    it('does not start Fetch when request setup exhausts the elapsed budget', async () => {
        let elapsed = 0
        const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
        const properties = {
            nested: {
                toJSON: () => {
                    elapsed = 100
                    return {}
                },
            },
        }

        const result = await sendCaptureV1Batch(runtime(fetch), [message({ properties })], '1.2.3', {
            maxElapsedMs: 50,
            elapsedNow: () => elapsed,
        })

        expect(fetch).not.toHaveBeenCalled()
        expect(result.retry).toEqual(['event-uuid'])
        expect(result.error).toHaveProperty('message', 'Capture V1 exhausted its elapsed retry budget')
    })

    it('does not start a backoff that would consume the remaining elapsed budget', async () => {
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 503, headers: { 'Retry-After': '10' } }))
        const sleep = jest.fn().mockResolvedValue(undefined)

        const result = await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
            maxElapsedMs: 5_000,
            elapsedNow: () => 0,
            sleep,
            random: () => 0.5,
        })

        expect(fetch).toHaveBeenCalledTimes(1)
        expect(sleep).not.toHaveBeenCalled()
        expect(result.retry).toEqual(['event-uuid'])
        expect(result.error).toHaveProperty('message', 'Capture V1 exhausted its elapsed retry budget')
    })

    it('does not start another attempt after backoff exhausts the elapsed budget', async () => {
        let elapsed = 0
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 503 }))
        const sleep = jest.fn().mockImplementation(async () => {
            elapsed = 5_000
        })

        const result = await sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
            maxElapsedMs: 4_000,
            elapsedNow: () => elapsed,
            sleep,
            random: () => 0.5,
        })

        expect(sleep).toHaveBeenCalledWith(3_000)
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(result.retry).toEqual(['event-uuid'])
        expect(result.error).toHaveProperty('message', 'Capture V1 exhausted its elapsed retry budget')
    })

    it('contains backoff failures', async () => {
        const fetch: BrowserFetch = async () => new Response('{}', { status: 503 })

        await expect(
            sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3', {
                sleep: () => Promise.reject(new Error('timer unavailable')),
            })
        ).resolves.toMatchObject({ retry: ['event-uuid'], error: expect.anything() })
    })

    it('contains serialization failures', async () => {
        const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()

        await expect(
            sendCaptureV1Batch(runtime(fetch), [message({ properties: { invalid: 1n } })], '1.2.3')
        ).resolves.toMatchObject({ statusCode: 0, retry: ['event-uuid'], error: expect.anything() })
        expect(fetch).not.toHaveBeenCalled()
    })
})
