import type { Client } from '@posthog/browser-common'
import { createPostHog, FeatureFlagsExtension } from '../src'
import { createPostHog as createCore } from '../src/core'
import { logs } from '../src/logs'
import type { LogsExtension, LogsOptions } from '../src/logs'
import type { PostHog, PostHogOptions } from '../src/types'
import type { OtlpLogsPayload } from '@posthog/types'
import { MemoryStorage } from './helpers'

const clients: PostHog[] = []
const extensions = new WeakMap<PostHog, LogsExtension>()
const getLogs = (client: PostHog): LogsExtension => {
    const extension = extensions.get(client) ?? client.getExtension<LogsExtension>('logs')!
    extensions.set(client, extension)
    return extension
}
const defaults = {
    projectToken: 'ph_logs',
    storage: false,
    navigator: false,
    flags: false,
    analytics: false,
    capturePageview: false,
} as const
const remoteConfig = {
    toolbarParams: {},
    toolbarVersion: 'toolbar' as const,
    isAuthenticated: false,
    siteApps: [],
    supportedCompression: [],
}
const create = async (options: Partial<PostHogOptions> = {}) => {
    const client = await createPostHog({
        ...defaults,
        remoteConfig,
        fetch: false,
        ...options,
    })
    clients.push(client)
    return client
}
const records = (payload: OtlpLogsPayload) =>
    payload.resourceLogs.flatMap((resource) => resource.scopeLogs.flatMap((scope) => scope.logRecords))
const browser = () => {
    const output = { debug: vi.fn(), log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const window = Object.assign(new EventTarget(), {
        console: output,
        location: { host: 'example.test', href: 'https://example.test/path#secret' },
    })
    vi.stubGlobal('window', window)
    return { window, output }
}
beforeEach(() => {
    vi.useFakeTimers()
})
afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.shutdown(0)))
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('logs', () => {
    it('contains caller-property errors and continues capturing through the extension reference', async () => {
        const fetch = vi.fn(async () => new Response('{}'))
        const client = await create({ fetch })
        const logger = getLogs(client)
        const failure = new Error('unavailable')
        expect(() =>
            logger.captureLog({
                get body(): string {
                    throw failure
                },
            })
        ).not.toThrow()
        logger.captureLog({ body: 'next record' })
        await logger.flush()
        expect(fetch).toHaveBeenCalledOnce()
    })

    it('does not ingest SDK diagnostics through the browser console', async () => {
        const { output } = browser()
        vi.stubGlobal('console', output)
        const bodies: OtlpLogsPayload[] = []
        const client = await create({
            debug: true,
            logs: { captureConsoleLogs: true },
            fetch: async (_url, init) => {
                bodies.push(JSON.parse(String(init?.body)))
                return new Response('{}')
            },
        })
        client.logger.error('SDK diagnostic')
        output.log('application log')
        await getLogs(client).flush()
        expect(bodies.flatMap(records).map((record) => record.body)).toEqual([{ stringValue: '"application log"' }])
    })

    it('loads by default but does not enable console capture without local or remote permission', async () => {
        const { output } = browser()
        const original = output.log
        const client = await create()
        expect(client.getExtension('logs')).toBeDefined()
        expect(output.log).toBe(original)
    })

    it('keeps disabled and manual core clients free of automatic logs', async () => {
        const fetch = vi.fn()
        const disabled = await create({ logs: false, fetch })
        const core = await createCore({ ...defaults, fetch: false })
        clients.push(core)
        expect(disabled.getExtension('logs')).toBeUndefined()
        expect(core.getExtension('logs')).toBeUndefined()
        await disabled.flush()
        expect(fetch).not.toHaveBeenCalled()
    })

    it.each(['static', 'dynamic'])(
        'uses %s configuration, preserves beforeSend and sends OTLP outside analytics',
        async (mode) => {
            const bodies: OtlpLogsPayload[] = []
            const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
                bodies.push(JSON.parse(String(init?.body)))
                return new Response('{}')
            })
            const beforeSend = vi.fn((record) => ({ ...record, body: `filtered ${record.body}` }))
            const config: LogsOptions = {
                serviceName: 'site',
                resourceAttributes: { region: 'us' },
                beforeSend,
                flushIntervalMs: 3000,
            }
            const extension = logs(config)
            const client = await create({
                fetch,
                ...(mode === 'static' ? { logs: false, extensions: [extension] } : { logs: config }),
            })
            config.serviceName = 'mutated'
            config.resourceAttributes!.region = 'changed'
            const captured = vi.fn()
            client.onEvent(captured)
            getLogs(client).captureLog({ body: 'hello', level: 'warn', attributes: { custom: 1 } })
            await getLogs(client).flush()
            expect(beforeSend).toHaveBeenCalledOnce()
            expect(captured).not.toHaveBeenCalled()
            expect(fetch).toHaveBeenCalledOnce()
            const [url, init] = fetch.mock.calls[0]!
            expect(String(url)).toBe('https://us.i.posthog.com/i/v1/logs?token=ph_logs')
            expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
            expect(records(bodies[0]!)[0]?.body).toEqual({ stringValue: 'filtered hello' })
            expect(bodies[0]?.resourceLogs[0]?.scopeLogs[0]?.scope.name).toBe(client.library.name)
            expect(bodies[0]?.resourceLogs[0]?.resource.attributes).toEqual(
                expect.arrayContaining([
                    { key: 'service.name', value: { stringValue: 'site' } },
                    { key: 'region', value: { stringValue: 'us' } },
                ])
            )
        }
    )

    it.each(['local', 'remote'])(
        'captures console through %s enablement and keeps its resource and scope separate',
        async (mode) => {
            const { output } = browser()
            const original = output.log
            const bodies: OtlpLogsPayload[] = []
            const client = await create({
                logs: { captureConsoleLogs: mode === 'local' },
                remoteConfig: { ...remoteConfig, logs: { captureConsoleLogs: mode === 'remote' } },
                fetch: async (_url, init) => {
                    bodies.push(JSON.parse(String(init?.body)))
                    return new Response('{}')
                },
            })
            output.log('hello', { answer: 42 })
            getLogs(client).captureLog({ body: 'programmatic' })
            await getLogs(client).flush()
            expect(original).toHaveBeenCalledWith('hello', { answer: 42 })
            expect(bodies).toHaveLength(2)
            expect(bodies.map((body) => body.resourceLogs[0]?.scopeLogs[0]?.scope.name)).toEqual([
                client.library.name,
                'console',
            ])
            expect(records(bodies[1]!)[0]?.attributes).toEqual(
                expect.arrayContaining([
                    { key: 'log.source', value: { stringValue: 'console.log' } },
                    { key: 'host', value: { stringValue: 'example.test' } },
                    { key: 'url.full', value: { stringValue: 'https://example.test/path' } },
                ])
            )
            await client.dispose()
            expect(output.log).toBe(original)
        }
    )

    it('does not wait for remote config and captures once its enablement arrives', async () => {
        const { output } = browser()
        let resolve!: (value: Response) => void
        const loaded = new Promise<Response>((done) => {
            resolve = done
        })
        const client = await createPostHog({ ...defaults, fetch: () => loaded })
        clients.push(client)
        const original = output.log
        resolve(new Response(JSON.stringify({ ...remoteConfig, logs: { captureConsoleLogs: true } })))
        await client.getRemoteConfig()
        expect(output.log).not.toBe(original)
    })

    it('purges programmatic and console queues on denial/reset without resurrecting after regrant', async () => {
        const { output } = browser()
        const fetch = vi.fn(async () => new Response('{}'))
        const client = await create({ fetch, logs: { captureConsoleLogs: true } })
        getLogs(client).captureLog({ body: 'old' })
        output.log('old console')
        client.optOut()
        getLogs(client).captureLog({ body: 'denied' })
        output.log('denied console')
        client.optIn()
        await getLogs(client).flush()
        expect(fetch).not.toHaveBeenCalled()
        getLogs(client).captureLog({ body: 'before reset' })
        client.reset()
        await getLogs(client).flush()
        expect(fetch).not.toHaveBeenCalled()
        getLogs(client).captureLog({ body: 'fresh' })
        await client.shutdown()
        expect(fetch).toHaveBeenCalledOnce()
        getLogs(client).captureLog({ body: 'after shutdown' })
        await getLogs(client).flush()
        expect(fetch).toHaveBeenCalledOnce()
    })

    it.each([500, 0, 413])(
        'handles status %s without blocking analytics or leaking retries after disposal',
        async (status) => {
            const fetch = vi.fn(async () => {
                if (!status) throw new Error('network')
                return new Response('{}', { status })
            })
            const client = await create({ fetch })
            getLogs(client).captureLog({ body: 'record' })
            await getLogs(client).flush()
            expect(fetch).toHaveBeenCalledOnce()
            const captured = vi.fn()
            client.onEvent(captured)
            client.capture('analytics works')
            expect(captured).toHaveBeenCalledOnce()
            await client.shutdown(0)
            const count = fetch.mock.calls.length
            await vi.advanceTimersByTimeAsync(100_000)
            expect(fetch).toHaveBeenCalledTimes(count)
        }
    )

    it('stops capture before invoking a caller-supplied transport during shutdown', async () => {
        const fetch = vi.fn(async () => {
            getLogs(client).captureLog({ body: 'reentrant' })
            return new Response('{}')
        })
        const client = await create({ fetch })
        getLogs(client).captureLog({ body: 'before shutdown' })
        await client.shutdown()
        expect(fetch).toHaveBeenCalledOnce()
    })

    it('bounds shutdown while a stalled request retains its own timeout', async () => {
        let signal: AbortSignal | undefined
        const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
            signal = init?.signal ?? undefined
            return new Promise<Response>(() => {})
        })
        const client = await create({ fetch })
        getLogs(client).captureLog({ body: 'pending' })
        const closing = client.shutdown(10)
        getLogs(client).captureLog({ body: 'too late' })
        await vi.advanceTimersByTimeAsync(10)
        await closing
        expect(signal?.aborted).toBe(false)
        expect(fetch).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(90_000)
        expect(signal?.aborted).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('allows consented requests during shutdown without treating shutdown as a transport gate', async () => {
        let ordinary!: Client
        const fetch = vi.fn(async (_url: RequestInfo | URL) => new Response('{}'))
        const client = await create({
            fetch,
            extensions: [
                {
                    name: 'ordinary',
                    setup: (value) => {
                        ordinary = value
                    },
                },
            ],
        })
        getLogs(client).captureLog({ body: 'before closing' })
        const closing = client.shutdown(10)
        expect((await client.sendRequest('/ordinary')).statusCode).toBe(200)
        expect((await ordinary.sendRequest('/ordinary')).statusCode).toBe(200)
        await closing
        expect(fetch.mock.calls.some(([url]) => String(url).includes('/i/v1/logs'))).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('settles rejected requests and leaves the queue available to a later flush', async () => {
        const fetch = vi
            .fn()
            .mockRejectedValueOnce(new Error('network unavailable'))
            .mockResolvedValue(new Response('{}'))
        const client = await create({ fetch })
        getLogs(client).captureLog({ body: 'retry' })
        await getLogs(client).flush()
        await getLogs(client).flush()
        expect(fetch).toHaveBeenCalledTimes(2)
        await client.shutdown()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('keeps client flush analytics-only and hands off queued logs before disposal', async () => {
        const sendBeacon = vi.fn(() => true)
        const fetch = vi.fn(async () => new Response('{}'))
        const client = await create({ navigator: { sendBeacon }, disableBotDetection: true, fetch })
        getLogs(client).captureLog({ body: 'before shutdown' })
        await client.flush()
        expect(sendBeacon).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
        await client.shutdown()
        expect(sendBeacon).toHaveBeenCalledOnce()
        const body = (sendBeacon.mock.calls as unknown as Array<[string, Blob]>)[0]![1]
        expect(records(JSON.parse(await body.text())).map((record) => record.body)).toEqual([
            { stringValue: 'before shutdown' },
        ])
    })

    it('uses logs Beacon on pagehide, falls back to keepalive, and removes the listener', async () => {
        const { window } = browser()
        const sendBeacon = vi.fn(() => false)
        const fetch = vi.fn(async () => new Response('{}'))
        const client = await create({ navigator: { sendBeacon }, disableBotDetection: true, fetch })
        getLogs(client).captureLog({ body: 'teardown' })
        window.dispatchEvent(new Event('pagehide'))
        expect(sendBeacon).toHaveBeenCalledOnce()
        expect((fetch.mock.calls as unknown as Array<[unknown, RequestInit]>)[0]?.[1]).toMatchObject({
            keepalive: true,
        })
        await client.dispose()
        window.dispatchEvent(new Event('pagehide'))
        expect(sendBeacon).toHaveBeenCalledOnce()
    })

    it.each(['accepted', 'rejected', 'unavailable'] as const)(
        'hands off logs on pagehide during pending shutdown when Beacon is %s',
        async (beacon) => {
            const { window } = browser()
            const add = vi.spyOn(window, 'addEventListener')
            const remove = vi.spyOn(window, 'removeEventListener')
            const sendBeacon = vi.fn(() => beacon === 'accepted')
            const fetch = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => {}))
            const client = await create({
                navigator: beacon === 'unavailable' ? false : { sendBeacon },
                disableBotDetection: true,
                fetch,
                logs: { flushIntervalMs: 0 },
            })
            getLogs(client).captureLog({ body: 'pending' })
            const pending = getLogs(client).flush()
            expect(fetch).toHaveBeenCalledOnce()
            const closing = client.shutdown(10)
            try {
                expect(fetch.mock.calls[0]![1]?.keepalive).not.toBe(true)
                getLogs(client).captureLog({ body: 'too late' })
                window.dispatchEvent(new Event('pagehide'))
                if (beacon === 'accepted') {
                    expect(sendBeacon).toHaveBeenCalledOnce()
                    const blob = (sendBeacon.mock.calls as unknown as Array<[string, Blob]>)[0]![1]
                    expect(records(JSON.parse(await blob.text())).map((record) => record.body)).toEqual([
                        { stringValue: 'pending' },
                    ])
                    expect(fetch).toHaveBeenCalledOnce()
                } else {
                    expect(sendBeacon).toHaveBeenCalledTimes(beacon === 'unavailable' ? 0 : 1)
                    expect(fetch).toHaveBeenCalledTimes(2)
                    expect(fetch.mock.calls[1]![1]?.keepalive).toBe(true)
                    expect(
                        records(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).map((record) => record.body)
                    ).toEqual([{ stringValue: 'pending' }])
                }
            } finally {
                await vi.advanceTimersByTimeAsync(10)
                await closing
            }
            await vi.advanceTimersByTimeAsync(90_000)
            await pending
            expect(vi.getTimerCount()).toBe(0)
            for (const [type, listener] of add.mock.calls) {
                expect(
                    remove.mock.calls.some(([removedType, removed]) => removedType === type && removed === listener)
                ).toBe(true)
            }
            const attempts = fetch.mock.calls.length
            const beacons = sendBeacon.mock.calls.length
            window.dispatchEvent(new Event('pagehide'))
            expect(fetch).toHaveBeenCalledTimes(attempts)
            expect(sendBeacon).toHaveBeenCalledTimes(beacons)
        }
    )

    it('does not dispatch denied pagehide work or revive it after consent returns', async () => {
        const { window } = browser()
        const sendBeacon = vi.fn(() => true)
        const fetch = vi.fn(async () => new Response('{}'))
        const client = await create({ navigator: { sendBeacon }, disableBotDetection: true, fetch })
        getLogs(client).captureLog({ body: 'withdrawn' })
        client.optOut()
        window.dispatchEvent(new Event('pagehide'))
        expect(sendBeacon).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
        client.optIn()
        window.dispatchEvent(new Event('pagehide'))
        await getLogs(client).flush()
        expect(sendBeacon).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
        await client.dispose()
        window.dispatchEvent(new Event('pagehide'))
        expect(sendBeacon).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
    })

    it('contains synchronous transport failures and retires denied in-flight work', async () => {
        let finish!: (response: Response) => void
        const fetch = vi.fn(
            (_url: RequestInfo | URL, _init?: RequestInit) =>
                new Promise<Response>((resolve) => {
                    finish = resolve
                })
        )
        const client = await create({ fetch })
        getLogs(client).captureLog({ body: 'old' })
        const pending = getLogs(client).flush()
        client.optOut()
        client.optIn()
        finish(new Response('{}', { status: 500 }))
        await pending
        fetch.mockImplementation(() => {
            throw new Error('synchronous fetch')
        })
        getLogs(client).captureLog({ body: 'new' })
        await getLogs(client).flush()
        expect(fetch).toHaveBeenCalledTimes(2)
        const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as OtlpLogsPayload)
        expect(bodies.map((body) => records(body)[0]?.body)).toEqual([{ stringValue: 'old' }, { stringValue: 'new' }])
    })

    it('cleans console patches and listeners after partial setup failure', async () => {
        const { window, output } = browser()
        const original = output.log
        const add = window.addEventListener.bind(window)
        vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
            if (type === 'pagehide') throw new Error('page lifecycle unavailable')
            add(type, listener, options)
        })
        const remove = vi.spyOn(window, 'removeEventListener')
        const client = await create({ logs: { captureConsoleLogs: true } })
        expect(client.getExtension('logs')).toBeUndefined()
        expect(output.log).toBe(original)
        expect(remove.mock.calls.some(([type]) => type === 'online')).toBe(true)
        expect(client.getExtension('logs')).toBeUndefined()
    })

    it('reads active flag keys without exposure capture', async () => {
        const bodies: OtlpLogsPayload[] = []
        const client = await create({
            flags: { featureFlagEvaluation: false },
            fetch: async (_url, init) => {
                bodies.push(JSON.parse(String(init?.body)))
                return new Response('{}')
            },
        })
        client.getExtension(FeatureFlagsExtension)!.updateFlags({ enabled: true, disabled: false, variant: 'a' })
        const captured = vi.fn()
        client.onEvent(captured)
        getLogs(client).captureLog({ body: 'flags' })
        await getLogs(client).flush()
        expect(captured).not.toHaveBeenCalled()
        expect(records(bodies[0]!)[0]?.attributes).toEqual(
            expect.arrayContaining([
                {
                    key: 'feature_flags',
                    value: {
                        arrayValue: {
                            values: [
                                { stringValue: 'enabled' },
                                { stringValue: 'disabled' },
                                { stringValue: 'variant' },
                            ],
                        },
                    },
                },
            ])
        )
    })

    it('observes existing session context without creating or advancing sessions for logs', async () => {
        vi.setSystemTime(1_700_000_000_000)
        const bodies: OtlpLogsPayload[] = []
        const client = await create({
            fetch: async (_url, init) => {
                bodies.push(JSON.parse(String(init?.body)))
                return new Response('{}')
            },
        })
        getLogs(client).captureLog({ body: 'before session' })
        await getLogs(client).flush()
        expect(client.session).toBeUndefined()
        expect(records(bodies[0]!)[0]?.attributes?.some(({ key }) => key === 'sessionStartTimestamp')).toBe(false)
        client.capture('admitted')
        const session = client.session
        vi.setSystemTime(1_700_000_000_100)
        getLogs(client).captureLog({ body: 'with session' })
        await getLogs(client).flush()
        expect(records(bodies[1]!)[0]?.attributes).toEqual(
            expect.arrayContaining([
                { key: 'sessionStartTimestamp', value: { stringValue: '1700000000000' } },
                { key: 'lastActivityTimestamp', value: { stringValue: '1700000000000' } },
            ])
        )
        expect(client.session).toEqual(session)
    })

    it('persists console hints but does not record when capture is denied', async () => {
        const { output } = browser()
        const storage = new MemoryStorage()
        const client = await create({
            storage,
            optOutByDefault: true,
            remoteConfig: { ...remoteConfig, logs: { captureConsoleLogs: true } },
        })
        output.log('private')
        expect(client.getExtension('logs')).toBeDefined()
        expect([...storage.values.values()].join()).toContain('consoleCaptureEnabled')
    })
})
