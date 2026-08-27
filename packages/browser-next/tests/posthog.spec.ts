import { createPostHog as createAutomaticPostHog } from '../src'
import { analytics as createAnalytics } from '../src/analytics'
import { createPostHog, type BrowserFetch, type CorePostHogOptions, type RemoteConfig } from '../src/core'
import { createFetch, MemoryStorage, type SentRequest } from './helpers'

const createRemoteConfig = (overrides: Partial<RemoteConfig> = {}): RemoteConfig =>
    ({
        supportedCompression: [],
        toolbarParams: {},
        toolbarVersion: 'toolbar',
        isAuthenticated: false,
        siteApps: [],
        ...overrides,
    }) as RemoteConfig

const captureEvent = (request: SentRequest | undefined): Record<string, unknown> | undefined =>
    (request?.body?.batch as Record<string, unknown>[] | undefined)?.[0]

const analytics = () => createAnalytics({ flushAt: 1, flushInterval: 0 })
const immediateAnalytics = analytics
const createPostHogWithAnalytics = (options: CorePostHogOptions) =>
    createPostHog({ ...options, extensions: [immediateAnalytics(), ...(options.extensions ?? [])] })

describe('@posthog/browser core', () => {
    it('requires a project token in options', async () => {
        // @ts-expect-error Verify the runtime guard for untyped JavaScript consumers.
        await expect(createPostHog()).rejects.toThrow('A PostHog project token is required')
        // @ts-expect-error Verify the runtime guard for untyped JavaScript consumers.
        await expect(createPostHog({})).rejects.toThrow('A PostHog project token is required')
        await expect(createPostHog({ projectToken: '' })).rejects.toThrow('A PostHog project token is required')
    })

    it('buffers capture without configured analytics delivery', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await posthog.capture('queued', undefined, {
            uuid: 'queued-uuid',
            timestamp: new Date('2026-01-02T03:04:05.000Z'),
        })
        await posthog.flush()

        expect(requests).toHaveLength(0)
        expect(posthog.getExtension('analytics')).toBeUndefined()
        await posthog.dispose()
    })

    it('supports configurable analytics count and interval thresholds', async () => {
        jest.useFakeTimers()
        try {
            const requests: SentRequest[] = []
            const posthog = await createPostHog({
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
                extensions: [createAnalytics({ flushAt: 3, flushInterval: 100 })],
            })

            await posthog.capture('first')
            await posthog.capture('second')
            await jest.advanceTimersByTimeAsync(99)
            expect(requests).toHaveLength(0)

            await posthog.capture('third')
            await jest.advanceTimersByTimeAsync(0)
            expect(requests).toHaveLength(1)
            expect((requests[0]?.body?.batch as Array<{ event: string }>).map(({ event }) => event)).toEqual([
                'first',
                'second',
                'third',
            ])

            await posthog.capture('interval')
            await jest.advanceTimersByTimeAsync(99)
            expect(requests).toHaveLength(1)
            await jest.advanceTimersByTimeAsync(1)
            expect(requests).toHaveLength(2)
            await posthog.shutdown(0)
        } finally {
            jest.useRealTimers()
        }
    })

    it('normalizes hostile analytics scheduling options without throwing', async () => {
        const options = Object.defineProperties(
            {},
            {
                flushAt: {
                    get() {
                        throw new Error('flushAt failed')
                    },
                },
                flushInterval: { value: Number.NaN },
            }
        )
        expect(() => createAnalytics(options)).not.toThrow()
    })

    it('does not wait for compression remote config and enables gzip after it arrives', async () => {
        const requests: RequestInit[] = []
        let resolveRemoteConfig: ((config: RemoteConfig) => void) | undefined
        const remoteConfig = new Promise<RemoteConfig>((resolve) => {
            resolveRemoteConfig = resolve
        })
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch: async (_input, init = {}) => {
                requests.push(init)
                return new Response('{"results":{}}', { status: 200 })
            },
            remoteConfigLoader: () => remoteConfig,
        })

        await posthog.capture('before_config', { value: 'x'.repeat(2_000) })
        await posthog.flush()
        expect(requests).toHaveLength(1)
        expect(requests[0]?.body).toEqual(expect.any(String))
        expect(requests[0]?.headers).not.toHaveProperty('Content-Encoding')

        resolveRemoteConfig?.(createRemoteConfig({ supportedCompression: ['gzip-js'] }))
        await posthog.getRemoteConfig()
        await posthog.capture('after_config', { value: 'x'.repeat(2_000) })
        await posthog.flush()

        expect(requests).toHaveLength(2)
        expect(requests[1]?.body).toBeInstanceOf(Blob)
        expect(requests[1]?.headers).toMatchObject({ 'Content-Encoding': 'gzip' })
        const body = await new Response(
            (requests[1]?.body as Blob).stream().pipeThrough(new DecompressionStream('gzip'))
        ).json()
        expect(body).toMatchObject({ batch: [{ event: 'after_config' }] })
    })

    it('purges buffered capture when consent is revoked', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await posthog.capture('private')
        posthog.optOut()
        posthog.optIn()
        await posthog.flush()

        expect(requests).toHaveLength(0)
    })

    it('does not send a staged event after opt-out followed immediately by opt-in', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        const capture = posthog.capture('private')
        posthog.optOut()
        posthog.optIn()
        await capture
        await posthog.flush()

        expect(requests).toHaveLength(0)
    })

    it('builds and sends a protected event envelope', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })
        const observed: Array<{ event: string; properties: Record<string, unknown> }> = []
        posthog.onEvent((event) => observed.push(event))
        posthog.registerDynamicEventProperties(() => ({ dynamic: 'yes', token: 'bad-token' }))

        await posthog.capture(
            'signed_up',
            { plan: 'pro', distinct_id: 'bad-id' },
            {
                uuid: 'event-uuid',
                timestamp: new Date('2026-01-02T03:04:05.000Z'),
                set: { email: 'person@example.com' },
                setOnce: { source: 'docs' },
            }
        )

        expect(requests).toHaveLength(1)
        expect(requests[0]?.url.pathname).toBe('/i/v1/analytics/events')
        expect(requests[0]?.url.search).toBe('')
        expect(requests[0]?.init.headers).toMatchObject({
            'Content-Type': 'application/json',
            Authorization: 'Bearer ph_test',
            'PostHog-Sdk-Info': expect.stringMatching(/^posthog-js\//),
            'PostHog-Attempt': '1',
            'PostHog-Request-Id': expect.any(String),
            'PostHog-Request-Timestamp': expect.any(String),
        })
        expect(requests[0]?.body).toMatchObject({
            created_at: expect.any(String),
            batch: [
                {
                    uuid: 'event-uuid',
                    event: 'signed_up',
                    distinct_id: posthog.distinctId,
                    timestamp: '2026-01-02T03:04:05.000Z',
                    session_id: posthog.session.sessionId,
                    window_id: posthog.session.windowId,
                    options: {},
                    properties: {
                        dynamic: 'yes',
                        plan: 'pro',
                        $device_id: posthog.deviceId,
                        $set: { email: 'person@example.com' },
                        $set_once: { source: 'docs' },
                    },
                },
            ],
        })
        expect(requests[0]?.body?.batch).not.toMatchObject([
            { properties: { token: expect.anything(), distinct_id: expect.anything(), $lib: expect.anything() } },
        ])
        expect(observed).toHaveLength(1)
    })

    it('waits for active capture delivery when flush runs', async () => {
        let finishRequest: ((response: Response) => void) | undefined
        const fetch: BrowserFetch = () =>
            new Promise<Response>((resolve) => {
                finishRequest = resolve
            })
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch,
        })

        const capture = posthog.capture('pending')
        let flushed = false
        const flush = posthog.flush().then(() => {
            flushed = true
        })
        await Promise.resolve()
        expect(flushed).toBe(false)

        finishRequest?.(new Response('{}', { status: 200 }))
        await capture
        await flush
        expect(flushed).toBe(true)
    })

    it('migrates persisted version-1 state without a device ID', async () => {
        const storage = new MemoryStorage()
        const stateKey = 'ph_ph_test_posthog_browser_v2'
        storage.setItem(
            stateKey,
            JSON.stringify({
                version: 1,
                anonymousId: 'legacy-anonymous',
                distinctId: 'legacy-user',
                isIdentified: true,
                groups: {},
                session: {
                    sessionId: 'legacy-session',
                    sessionStartTimestamp: 1,
                    lastActivityTimestamp: 1,
                },
                extensionData: {},
            })
        )

        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
        })

        expect(posthog.deviceId).toBe('legacy-anonymous')
        expect(posthog.anonymousId).toBe('legacy-anonymous')
        expect(posthog.distinctId).toBe('legacy-user')
        expect(JSON.parse(storage.getItem(stateKey) ?? '{}')).toMatchObject({ deviceId: 'legacy-anonymous' })
    })

    it('persists identity, groups, and core key-value data', async () => {
        const storage = new MemoryStorage()
        const requests: SentRequest[] = []
        const first = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
        })

        await first.identify('user-123')
        await first.group('organization', 'org-123')
        first.kv.set('key', { value: 1 })
        const anonymousId = first.anonymousId
        await first.dispose()

        const second = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
        })
        expect(second.anonymousId).toBe(anonymousId)
        expect(second.deviceId).toBe(anonymousId)
        expect(second.distinctId).toBe('user-123')
        expect(second.groups).toEqual({ organization: 'org-123' })
        expect(second.kv.get('key')).toEqual({ value: 1 })
    })

    it('implements synchronous key-value initialization and batch operations', async () => {
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
        })

        expect(posthog.kv.initialize()).toBeUndefined()
        posthog.kv.set({ first: true, second: 'value', ['__proto__']: { safe: true } })
        expect(
            posthog.kv.get<{ first: boolean; second: string; missing: unknown }>(['first', 'missing', 'second'])
        ).toEqual({
            first: true,
            second: 'value',
        })
        const prototypeKey = posthog.kv.get<{ __proto__: { safe: boolean } }>(['__proto__'])
        expect(Object.prototype.hasOwnProperty.call(prototypeKey, '__proto__')).toBe(true)
        expect(prototypeKey['__proto__']).toEqual({ safe: true })
        expect(Object.getPrototypeOf(prototypeKey)).toBeNull()
        posthog.kv.remove(['first', 'second', '__proto__'])
        expect(posthog.kv.get<{ first: boolean; second: string }>(['first', 'second'])).toEqual({})
    })

    it('copies key-value data at the storage boundary', async () => {
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
        })
        const input = { nested: { value: 1 } }
        posthog.kv.set('object', input)
        input.nested.value = 2

        const firstRead = posthog.kv.get<typeof input>('object')
        expect(firstRead).toEqual({ nested: { value: 1 } })
        if (firstRead) {
            firstRead.nested.value = 3
        }
        expect(posthog.kv.get('object')).toEqual({ nested: { value: 1 } })
    })

    it('does not turn default capture into explicit consent', async () => {
        const storage = new MemoryStorage()
        const first = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
        })
        await first.dispose()

        expect(storage.values.has('ph_ph_test_posthog_browser_v2_consent')).toBe(false)

        const second = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
            optOutByDefault: true,
        })
        expect(second.hasOptedOut()).toBe(true)
    })

    it('retains identity changes before explicit opt-in while blocking analytics', async () => {
        const requests: SentRequest[] = []
        const storage = new MemoryStorage()
        const posthog = await createAutomaticPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
            optOutByDefault: true,
            analytics: { flushAt: 1, flushInterval: 0 },
        })
        const anonymousId = posthog.anonymousId
        expect(anonymousId).not.toBe('')

        await posthog.identify('user-before-consent')
        await posthog.group('organization', 'group-before-consent')
        await posthog.capture('before_consent')
        expect(requests).toHaveLength(0)
        expect(posthog.distinctId).toBe('user-before-consent')
        expect(posthog.anonymousId).toBe(anonymousId)
        expect(posthog.groups).toEqual({ organization: 'group-before-consent' })
        expect(storage.values.has('ph_ph_test_posthog_browser_v2')).toBe(true)

        posthog.optIn()
        await posthog.capture('after_consent')
        await posthog.flush()

        expect(captureEvent(requests[0])).toMatchObject({
            distinct_id: 'user-before-consent',
            properties: { $groups: { organization: 'group-before-consent' } },
        })
    })

    it('does not retry analytics after consent is revoked', async () => {
        const client: { current?: Awaited<ReturnType<typeof createPostHog>> } = {}
        const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>().mockImplementation(async () => {
            client.current?.optOut()
            return new Response('{}', { status: 503 })
        })
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch,
        })
        client.current = posthog

        await posthog.capture('consent_revoked_during_delivery')

        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('settles capture and flush without retrying when consent is revoked during real backoff', async () => {
        jest.useFakeTimers()
        try {
            const fetch = jest
                .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
                .mockResolvedValue(new Response('{}', { status: 503 }))
            const posthog = await createPostHogWithAnalytics({
                projectToken: 'ph_test',
                storage: false,
                navigator: false,
                fetch,
            })

            let captureSettled = false
            let flushSettled = false
            const capture = posthog.capture('consent_revoked_during_backoff').then(() => {
                captureSettled = true
            })
            const flush = posthog.flush().then(() => {
                flushSettled = true
            })
            await jest.advanceTimersByTimeAsync(0)
            expect(fetch).toHaveBeenCalledTimes(1)
            expect(jest.getTimerCount()).toBe(1)
            expect(captureSettled).toBe(true)
            expect(flushSettled).toBe(false)

            posthog.optOut()
            await jest.runOnlyPendingTimersAsync()
            await Promise.all([capture, flush])

            expect(fetch).toHaveBeenCalledTimes(1)
            expect(captureSettled).toBe(true)
            expect(flushSettled).toBe(true)
        } finally {
            jest.useRealTimers()
        }
    })

    it('permanently cancels retry when consent is revoked and restored during backoff', async () => {
        jest.useFakeTimers()
        try {
            const fetch = jest
                .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
                .mockResolvedValue(new Response('{}', { status: 503 }))
            const posthog = await createPostHogWithAnalytics({
                projectToken: 'ph_test',
                storage: false,
                navigator: false,
                fetch,
            })

            await posthog.capture('revoked_and_restored')
            await jest.advanceTimersByTimeAsync(0)
            expect(fetch).toHaveBeenCalledTimes(1)
            expect(jest.getTimerCount()).toBe(1)

            posthog.optOut()
            posthog.optIn()
            await jest.advanceTimersByTimeAsync(0)
            await posthog.flush()

            expect(fetch).toHaveBeenCalledTimes(1)
            expect(jest.getTimerCount()).toBe(0)
        } finally {
            jest.useRealTimers()
        }
    })

    it('retains retry-exhausted events for a later explicit flush without hot-looping', async () => {
        jest.useFakeTimers()
        try {
            const fetch = jest
                .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
                .mockResolvedValue(new Response('{}', { status: 503 }))
            const posthog = await createPostHog({
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch,
                extensions: [createAnalytics({ flushAt: 1, flushInterval: 0 })],
            })

            await posthog.capture('retained', undefined, { uuid: 'retained-uuid' })
            const firstFlush = posthog.flush()
            await jest.runAllTimersAsync()
            await firstFlush
            expect(fetch).toHaveBeenCalledTimes(4)
            expect(jest.getTimerCount()).toBe(0)

            await jest.advanceTimersByTimeAsync(60_000)
            expect(fetch).toHaveBeenCalledTimes(4)

            const secondFlush = posthog.flush()
            await jest.runAllTimersAsync()
            await secondFlush
            expect(fetch).toHaveBeenCalledTimes(8)
            expect(
                fetch.mock.calls.map(([, init]) => {
                    const body = JSON.parse(String(init?.body)) as { batch: Array<{ uuid: string }> }
                    return body.batch[0]?.uuid
                })
            ).toEqual(Array(8).fill('retained-uuid'))
            posthog.optOut()
            await posthog.dispose()
        } finally {
            jest.useRealTimers()
        }
    })

    it('uses the bounded sender retry budget before disposal purges undelivered work', async () => {
        jest.useFakeTimers()
        try {
            const fetch = jest
                .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
                .mockResolvedValue(new Response('{}', { status: 503 }))
            const posthog = await createPostHogWithAnalytics({
                projectToken: 'ph_test',
                storage: false,
                navigator: false,
                fetch,
            })

            const capture = posthog.capture('disposed_during_backoff')
            await jest.advanceTimersByTimeAsync(0)
            expect(fetch).toHaveBeenCalledTimes(1)
            expect(jest.getTimerCount()).toBe(1)

            let disposalSettled = false
            const disposal = Promise.resolve(posthog.dispose()).then(() => {
                disposalSettled = true
            })
            await Promise.resolve()
            expect(disposalSettled).toBe(false)
            await jest.runOnlyPendingTimersAsync()
            await Promise.all([capture, disposal])

            expect(fetch).toHaveBeenCalledTimes(4)
            expect(disposalSettled).toBe(true)
        } finally {
            jest.useRealTimers()
        }
    })

    it('flushes below-threshold work before shutdown and disables future capture', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
            extensions: [createAnalytics({ flushAt: 20, flushInterval: 0 })],
        })
        await posthog.capture('before_shutdown')
        expect(requests).toHaveLength(0)

        const first = posthog.shutdown()
        const second = posthog.shutdown()
        expect(second).toBe(first)
        await first

        expect(requests).toHaveLength(1)
        expect(captureEvent(requests[0])).toMatchObject({ event: 'before_shutdown' })
        await posthog.capture('after_shutdown')
        expect(requests).toHaveLength(1)
    })

    it('bounds shutdown and aborts a stalled active request', async () => {
        jest.useFakeTimers()
        try {
            const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>(() => new Promise(() => {}))
            const posthog = await createPostHog({
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch,
                extensions: [immediateAnalytics()],
            })
            await posthog.capture('stalled')
            await jest.advanceTimersByTimeAsync(0)
            expect(fetch).toHaveBeenCalledTimes(1)

            let settled = false
            const shutdown = posthog.shutdown(5).then(() => {
                settled = true
            })
            await jest.advanceTimersByTimeAsync(5)
            await shutdown

            expect(settled).toBe(true)
            expect(jest.getTimerCount()).toBe(0)
        } finally {
            jest.useRealTimers()
        }
    })

    it('cancels a pending remote-config wait during shutdown', async () => {
        jest.useFakeTimers()
        try {
            const loader = jest.fn(() => new Promise<RemoteConfig>(() => {}))
            const posthog = await createPostHog({
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: false,
                remoteConfigLoader: loader,
            })
            posthog.onRemoteConfig(() => {})
            await Promise.resolve()
            expect(loader).toHaveBeenCalledTimes(1)
            expect(jest.getTimerCount()).toBe(1)

            await posthog.shutdown()

            expect(jest.getTimerCount()).toBe(0)
        } finally {
            jest.useRealTimers()
        }
    })

    it('bounds shutdown when an extension cleanup never settles', async () => {
        jest.useFakeTimers()
        try {
            const posthog = await createPostHog({
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: false,
                extensions: [{ name: 'stalled-cleanup', setup() {}, dispose: () => new Promise(() => {}) }],
            })

            let settled = false
            const shutdown = posthog.shutdown(5).then(() => {
                settled = true
            })
            await jest.advanceTimersByTimeAsync(5)
            await shutdown

            expect(settled).toBe(true)
            await posthog.capture('after_shutdown')
            expect(posthog.session.sessionId).toBe('')
        } finally {
            jest.useRealTimers()
        }
    })

    it('rate limits a runaway capture loop and emits one bypassed aggregate warning', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        const now = jest.spyOn(Date, 'now').mockReturnValue(1_000)
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch: false,
            debug: true,
        })
        const observed: string[] = []
        posthog.onEvent(({ event }) => observed.push(event))

        for (let index = 0; index < 102; index++) {
            await posthog.capture(`event-${index}`)
        }
        expect(observed.slice(0, 100)).toEqual(Array.from({ length: 100 }, (_, index) => `event-${index}`))
        expect(observed.slice(100)).toEqual(['$$client_ingestion_warning'])
        expect(warn).toHaveBeenCalledTimes(1)

        now.mockReturnValue(1_100)
        await posthog.capture('after_refill')
        expect(observed.at(-1)).toBe('after_refill')
        await posthog.dispose()
    })

    it('persists opt-out without clearing identity state', async () => {
        const storage = new MemoryStorage()
        const requests: SentRequest[] = []
        const first = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
        })
        const firstAnonymousId = first.anonymousId

        first.optOut()
        await first.capture('blocked')
        expect(requests).toHaveLength(0)
        expect(new Set(storage.values.keys())).toEqual(
            new Set(['ph_ph_test_posthog_browser_v2', '__ph_opt_in_out_ph_test'])
        )

        const second = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
        })
        expect(second.hasOptedOut()).toBe(true)
        expect(second.anonymousId).toBe(firstAnonymousId)
    })

    it('drops capture for a blocked user agent while keeping state usable only in memory', async () => {
        const requests: SentRequest[] = []
        const storage = new MemoryStorage()
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage,
            navigator: { userAgent: 'Googlebot/2.1' },
            fetch: createFetch(requests),
        })

        const distinctId = posthog.distinctId
        const session = posthog.session
        await posthog.capture('blocked')
        await posthog.identify('blocked-user')
        await posthog.group('organization', 'blocked-org')
        posthog.reset()
        posthog.kv.set('blocked', true)

        expect(requests).toHaveLength(0)
        expect(posthog.distinctId).not.toBe(distinctId)
        expect(posthog.groups).toEqual({})
        expect(posthog.session).toEqual(session)
        expect(posthog.kv.get('blocked')).toBe(true)
        expect(storage.values.size).toBe(0)
    })

    it('falls back to keepalive fetch when sendBeacon rejects a payload', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            fetch: createFetch(requests),
            navigator: { sendBeacon: () => false },
        })

        const response = await posthog.sendRequest('/e/', {
            method: 'POST',
            body: { event: 'unload' },
            transport: 'sendBeacon',
        })
        expect(response.statusCode).toBe(200)
        expect(requests).toHaveLength(1)
        expect(requests[0]?.init.keepalive).toBe(true)
    })

    it('rejects request URLs outside the configured API origin', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await expect(posthog.sendRequest('https://example.com/collect')).resolves.toMatchObject({ statusCode: 0 })
        await expect(posthog.sendRequest('//example.com/collect')).resolves.toMatchObject({ statusCode: 0 })
        await expect(posthog.sendRequest('/\\example.com/collect')).resolves.toMatchObject({ statusCode: 0 })
        expect(requests).toHaveLength(0)
    })

    it('routes requests through the configured target host', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            apiHost: 'https://api.example.com',
            flagsHost: 'https://flags.example.com',
            assetsHost: 'https://assets.example.com',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await posthog.sendRequest('/decide/', { target: 'flags' })
        await posthog.sendRequest('/static/extension.js', { target: 'assets' })

        expect(requests.map(({ url }) => url.origin)).toEqual([
            'https://flags.example.com',
            'https://assets.example.com',
        ])
    })

    it('contains throwing caller-property getters before session or persistence mutation', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-01-02T03:04:05.000Z'))
        try {
            const requests: SentRequest[] = []
            const storage = new MemoryStorage()
            const posthog = await createPostHogWithAnalytics({
                projectToken: 'ph_test',
                storage,
                navigator: false,
                fetch: createFetch(requests),
            })
            const events: string[] = []
            posthog.onEvent(({ event }) => events.push(event))
            const session = { ...posthog.session }
            const persisted = new Map(storage.values)
            const properties = Object.defineProperty({}, 'hostile', {
                enumerable: true,
                get() {
                    throw new Error('property getter failed')
                },
            })
            jest.advanceTimersByTime(1_000)

            await expect(posthog.capture('hostile_properties', properties)).resolves.toBeUndefined()

            expect(posthog.session).toEqual(session)
            expect(storage.values).toEqual(persisted)
            expect(events).toEqual([])
            expect(requests).toEqual([])
        } finally {
            jest.useRealTimers()
        }
    })

    it.each<[string, unknown]>([
        ['null', null],
        ['a primitive', 'invalid'],
        ['an array', []],
        ['a thrown error', new Error('toJSON failed')],
    ])('rejects properties whose toJSON returns %s before session or persistence mutation', async (_name, result) => {
        jest.useFakeTimers().setSystemTime(new Date('2026-01-02T03:04:05.000Z'))
        try {
            const requests: SentRequest[] = []
            const storage = new MemoryStorage()
            const posthog = await createPostHogWithAnalytics({
                projectToken: 'ph_test',
                storage,
                navigator: false,
                fetch: createFetch(requests),
            })
            const events: string[] = []
            posthog.onEvent(({ event }) => events.push(event))
            const session = { ...posthog.session }
            const persisted = new Map(storage.values)
            const properties = {
                toJSON() {
                    if (result instanceof Error) {
                        throw result
                    }
                    return result
                },
            }
            jest.advanceTimersByTime(1_000)

            await expect(posthog.capture('hostile_to_json', properties)).resolves.toBeUndefined()

            expect(posthog.session).toEqual(session)
            expect(storage.values).toEqual(persisted)
            expect(events).toEqual([])
            expect(requests).toEqual([])
        } finally {
            jest.useRealTimers()
        }
    })

    it('accepts record-valued toJSON output while preserving protected property precedence', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await posthog.capture('valid_to_json', {
            toJSON: () => ({ source: 'toJSON', token: 'caller-token', distinct_id: 'caller-id' }),
        })
        await posthog.flush()

        expect(captureEvent(requests[0])).toMatchObject({
            event: 'valid_to_json',
            distinct_id: posthog.distinctId,
            properties: { source: 'toJSON' },
        })
        expect(captureEvent(requests[0])?.properties).not.toMatchObject({
            token: expect.anything(),
            distinct_id: expect.anything(),
        })
    })

    it('contains throwing capture-option getters before session or persistence mutation', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-01-02T03:04:05.000Z'))
        try {
            const requests: SentRequest[] = []
            const storage = new MemoryStorage()
            const posthog = await createPostHogWithAnalytics({
                projectToken: 'ph_test',
                storage,
                navigator: false,
                fetch: createFetch(requests),
            })
            const events: string[] = []
            posthog.onEvent(({ event }) => events.push(event))
            const session = { ...posthog.session }
            const persisted = new Map(storage.values)
            jest.advanceTimersByTime(1_000)

            for (const option of ['set', 'setOnce', 'uuid', 'timestamp']) {
                const options = Object.defineProperty({}, option, {
                    get() {
                        throw new Error(`${option} getter failed`)
                    },
                }) as Parameters<typeof posthog.capture>[2]
                await expect(posthog.capture(`hostile_${option}`, undefined, options)).resolves.toBeUndefined()
            }

            expect(posthog.session).toEqual(session)
            expect(storage.values).toEqual(persisted)
            expect(events).toEqual([])
            expect(requests).toEqual([])
        } finally {
            jest.useRealTimers()
        }
    })

    it('does not let event observers mutate caller-owned nested properties', async () => {
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
        })
        const properties = { nested: { value: 1 } }
        posthog.onEvent((event) => {
            const nested = event.properties.nested as { value: number }
            nested.value = 2
        })

        await posthog.capture('event', properties)
        expect(properties).toEqual({ nested: { value: 1 } })
    })

    it('publishes the same immutable payload to later event observers', async () => {
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
        })
        const observed: unknown[] = []
        posthog.onEvent((event) => {
            ;(event as { event: string }).event = 'replaced'
        })
        posthog.onEvent((event) => {
            ;(event as { properties: Record<string, unknown> }).properties = { nested: { value: 2 } }
        })
        posthog.onEvent((event) => {
            ;(event.properties.nested as { value: number }).value = 3
        })
        posthog.onEvent((event) => observed.push(event))

        await posthog.capture('event', { nested: { value: 1 } })

        expect(observed).toEqual([{ event: 'event', properties: expect.objectContaining({ nested: { value: 1 } }) }])
    })

    it('does not let event observers replace protected delivery fields', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })
        posthog.onEvent(({ properties }) => {
            const mutableProperties = properties as Record<string, unknown>
            mutableProperties.token = 'replaced'
            mutableProperties.distinct_id = 'replaced'
        })

        await posthog.capture('event')

        expect(captureEvent(requests[0])).toMatchObject({ distinct_id: posthog.distinctId })
        expect(captureEvent(requests[0])?.properties).not.toMatchObject({
            token: expect.anything(),
            distinct_id: expect.anything(),
        })
    })

    it('continues event notification after one observer throws', async () => {
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
        })
        const events: string[] = []
        posthog.onEvent(() => {
            throw new Error('listener failed')
        })
        posthog.onEvent(({ event }) => events.push(event))

        await posthog.capture('event')
        expect(events).toEqual(['event'])
    })

    it.each(['', '   ', '\t', '$posthog_cookieless', 'distinct_id', 'DISTINCTID', 'undefined', 'NULL'])(
        'rejects invalid distinct ID %j without state or delivery changes',
        async (distinctId) => {
            const requests: SentRequest[] = []
            const posthog = await createPostHogWithAnalytics({
                projectToken: 'ph_test',
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
            })
            const identity = {
                anonymousId: posthog.anonymousId,
                distinctId: posthog.distinctId,
            }

            await posthog.identify(distinctId)

            expect(requests).toHaveLength(0)
            expect(posthog.anonymousId).toBe(identity.anonymousId)
            expect(posthog.distinctId).toBe(identity.distinctId)
        }
    )

    it.each(['', '   ', '\t'])('rejects invalid group type %j without state or delivery changes', async (type) => {
        const requests: SentRequest[] = []
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await posthog.group(type, 'group-key')

        expect(requests).toHaveLength(0)
        expect(posthog.groups).toEqual({})
    })

    it.each(['', '   ', '\t'])('rejects invalid group key %j without state or delivery changes', async (key) => {
        const requests: SentRequest[] = []
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await posthog.group('organization', key)

        expect(requests).toHaveLength(0)
        expect(posthog.groups).toEqual({})
    })

    it.each(['', '   ', '\t'])('rejects invalid event name %j without session or delivery changes', async (event) => {
        const requests: SentRequest[] = []
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })
        const session = posthog.session

        await posthog.capture(event)

        expect(requests).toHaveLength(0)
        expect(posthog.session).toEqual(session)
    })

    it('marks same-ID anonymous identify as identified without later relinking it', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })
        const anonymousId = posthog.distinctId

        await posthog.identify(anonymousId)
        await posthog.identify('later-user')

        expect(requests).toHaveLength(1)
        expect(captureEvent(requests[0])).toMatchObject({
            event: '$set',
            distinct_id: anonymousId,
            properties: { $set: {}, $set_once: {} },
        })
        expect(posthog.distinctId).toBe('later-user')
    })

    it('does not repeat group-identify for an unchanged group without properties', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await posthog.group('organization', 'org-123')
        await posthog.group('organization', 'org-123')
        await posthog.group('organization', 'org-123', { name: 'Acme' })

        await posthog.flush()
        const events = requests.flatMap((request) => request.body?.batch as Record<string, unknown>[])
        expect(events.map((event) => event.event)).toEqual(['$groupidentify', '$groupidentify'])
        expect(events[0]?.properties).not.toHaveProperty('$group_set')
        expect(events[1]?.properties).toMatchObject({ $group_set: { name: 'Acme' } })
    })

    it('does not merge a second identified user with the anonymous id', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await posthog.identify('user-one')
        await posthog.identify('user-two')

        expect(requests).toHaveLength(1)
        expect(captureEvent(requests[0])).toMatchObject({
            event: '$identify',
            distinct_id: 'user-one',
        })
        expect(posthog.distinctId).toBe('user-two')
    })

    it('stops waiting for remote configuration after the timeout', async () => {
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            remoteConfigTimeoutMs: 1,
            remoteConfigLoader: () => new Promise(() => {}),
        })

        await expect(posthog.getRemoteConfig()).resolves.toBeUndefined()
    })

    it('turns a synchronous remote configuration failure into undefined', async () => {
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            remoteConfigLoader: () => {
                throw new Error('sync failure')
            },
        })

        await expect(posthog.getRemoteConfig()).resolves.toBeUndefined()
    })

    it('loads remote configuration once and publishes it', async () => {
        const remoteConfig = createRemoteConfig({ hasFeatureFlags: true })
        const loader = jest.fn(async () => remoteConfig)
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            remoteConfigLoader: loader,
        })
        const changes: unknown[] = []
        posthog.onRemoteConfig((value) => changes.push(value))

        await expect(posthog.getRemoteConfig()).resolves.toBe(remoteConfig)
        await expect(posthog.getRemoteConfig()).resolves.toBe(remoteConfig)
        expect(loader).toHaveBeenCalledTimes(1)
        expect(changes).toEqual([{ ok: true, config: remoteConfig }])
    })

    it('loads remote configuration when an extension-facing listener subscribes', async () => {
        const remoteConfig = createRemoteConfig({ hasFeatureFlags: true })
        const loader = jest.fn(async () => remoteConfig)
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            remoteConfigLoader: loader,
        })

        const notification = new Promise<unknown>((resolve) => posthog.onRemoteConfig(resolve))
        await expect(notification).resolves.toEqual({ ok: true, config: remoteConfig })
        expect(loader).toHaveBeenCalledTimes(1)
    })

    it('blocks registration, requests, and persisted key-value mutation after disposal', async () => {
        const requests: SentRequest[] = []
        const storage = new MemoryStorage()
        const remoteConfigLoader = jest.fn(async () => createRemoteConfig())
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
            remoteConfigLoader,
        })
        const events: string[] = []
        posthog.kv.set('before_dispose', true)
        const disposal = posthog.dispose()
        posthog.kv.set('while_closing', true)
        posthog.kv.remove('before_dispose')
        expect(posthog.kv.get('before_dispose')).toBeUndefined()
        expect(posthog.kv.get('while_closing')).toBeUndefined()
        await disposal

        posthog.onEvent(({ event }) => events.push(event))
        posthog.registerDynamicEventProperties(() => ({ after_dispose: true }))
        await expect(posthog.sendRequest('/flags/')).resolves.toMatchObject({ statusCode: 0 })
        await expect(posthog.getRemoteConfig()).resolves.toBeUndefined()
        await posthog.capture('after_dispose')
        posthog.kv.set('after_dispose', true)
        posthog.kv.remove('before_dispose')

        expect(posthog.kv.get('before_dispose')).toBeUndefined()
        expect(posthog.kv.get('after_dispose')).toBeUndefined()
        const reloaded = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
        })
        expect(reloaded.kv.get('before_dispose')).toBe(true)
        expect(reloaded.kv.get('while_closing')).toBeUndefined()
        expect(reloaded.kv.get('after_dispose')).toBeUndefined()
        expect(requests).toHaveLength(0)
        expect(remoteConfigLoader).toHaveBeenCalledTimes(1)
        expect(events).toHaveLength(0)
    })

    it('uses sendBeacon for unload requests', async () => {
        const sent: Array<{ url: string; data: BodyInit | null | undefined }> = []
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            fetch: false,
            navigator: {
                sendBeacon: (url, data) => {
                    sent.push({ url, data })
                    return true
                },
            },
        })

        const response = await posthog.sendRequest('/e/', {
            method: 'POST',
            body: { event: 'unload' },
            transport: 'sendBeacon',
        })
        expect(response).toMatchObject({ statusCode: 202 })
        expect(sent).toHaveLength(1)
        expect(new URL(sent[0]?.url ?? '').searchParams.get('token')).toBe('ph_test')
    })

    it('uses a different window id for each client in the same session', async () => {
        const storage = new MemoryStorage()
        const first = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
        })
        const second = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
        })
        await first.capture('first')
        await second.capture('second')

        expect(second.session.sessionId).toBe(first.session.sessionId)
        expect(second.session.windowId).not.toBe(first.session.windowId)
    })

    it('rotates an idle session when capture runs', async () => {
        const now = Date.now()
        const clock = jest.spyOn(Date, 'now').mockReturnValue(now)
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
        })
        const sessions: string[] = []
        posthog.onNewSession((session) => sessions.push(session.reason))
        await posthog.capture('before_idle')

        clock.mockReturnValue(now + 31 * 60 * 1000)
        await posthog.capture('after_idle')

        expect(sessions).toEqual(['idleTimeout'])
        clock.mockRestore()
    })

    it('preserves the device ID while rotating the anonymous ID on reset', async () => {
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
        })
        const deviceId = posthog.deviceId

        posthog.reset()

        expect(posthog.deviceId).toBe(deviceId)
        expect(posthog.anonymousId).not.toBe(deviceId)
    })

    it('rotates identity and publishes reset session details on the next capture', async () => {
        const posthog = await createPostHogWithAnalytics({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
        })
        await posthog.capture('before_reset')
        const originalId = posthog.anonymousId
        const sessions: string[] = []
        posthog.onNewSession((session) => sessions.push(`${session.reason}:${session.sessionId}`))

        posthog.reset()

        expect(posthog.anonymousId).not.toBe(originalId)
        expect(posthog.distinctId).toBe(posthog.anonymousId)
        expect(posthog.session.sessionId).toBe('')
        expect(sessions).toEqual([])

        await posthog.capture('after_reset')
        expect(sessions).toEqual([`reset:${posthog.session.sessionId}`])
    })
})
