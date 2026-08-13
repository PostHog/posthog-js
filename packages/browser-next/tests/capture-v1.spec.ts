import { buildCaptureV1Event, sendCaptureV1Batch, type CaptureV1Message } from '../src/capture-v1'
import type { RequestRuntime } from '../src/request'
import type { BrowserFetch } from '../src/types'

const message = (overrides: Partial<CaptureV1Message> = {}): CaptureV1Message => ({
    event: 'signed_up',
    uuid: 'event-uuid',
    distinctId: 'person-1',
    timestamp: '2026-01-02T03:04:05.000Z',
    properties: {},
    ...overrides,
})

const runtime = (fetch: BrowserFetch | undefined): RequestRuntime => ({
    hosts: {
        api: 'https://example.com/proxy',
        flags: 'https://example.com/proxy',
        assets: 'https://example.com/proxy',
    },
    projectToken: 'ph_test',
    fetch,
    navigator: undefined,
})

describe('Capture Analytics V1', () => {
    it('builds the root event shape without mutating the normalized message', () => {
        const input = message({
            set: { email: 'person@example.com' },
            setOnce: { source: 'docs' },
            properties: {
                token: 'ph_test',
                distinct_id: 'person-1',
                plan: 'pro',
                $device_id: 'device-1',
                $groups: { company: 'posthog' },
                $unset: ['old_property'],
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
            '1.2.3'
        )

        expect(result.retry).toEqual(['retry'])
        expect(result.drops).toEqual([{ uuid: 'drop', details: 'invalid event' }])
        expect(result.error).toBeInstanceOf(Error)
    })

    it.each([
        ['missing Fetch', undefined],
        ['a rejected Fetch', (() => Promise.reject(new Error('offline'))) as BrowserFetch],
    ])('contains %s failures', async (_label, fetch) => {
        await expect(sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3')).resolves.toMatchObject({
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

        await expect(sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3')).resolves.toMatchObject({
            statusCode: status,
            retry: ['event-uuid'],
            drops: [],
        })
    })

    it('treats HTTP 429 as terminal', async () => {
        const fetch: BrowserFetch = async () => new Response('{}', { status: 429 })

        await expect(sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3')).resolves.toMatchObject({
            statusCode: 429,
            retry: [],
            drops: [],
        })
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

        await expect(sendCaptureV1Batch(runtime(fetch), [message()], '1.2.3')).resolves.toMatchObject({
            statusCode: status,
            retry,
            drops: [],
            error: expect.anything(),
        })
    })

    it('contains serialization failures', async () => {
        const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()

        await expect(
            sendCaptureV1Batch(runtime(fetch), [message({ properties: { invalid: 1n } })], '1.2.3')
        ).resolves.toMatchObject({ statusCode: 0, retry: ['event-uuid'], error: expect.anything() })
        expect(fetch).not.toHaveBeenCalled()
    })
})
