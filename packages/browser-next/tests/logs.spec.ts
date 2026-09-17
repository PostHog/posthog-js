import type { Client } from '@posthog/browser-common'
import { createPostHog } from '../src'
import { createPostHog as createCore } from '../src/core'
import { logs } from '../src/logs'
import type { LogsOptions } from '../src/logs'
import type { PostHog, PostHogOptions } from '../src/types'
import type { OtlpLogsPayload } from '@posthog/types'
import { MemoryStorage } from './helpers'

const clients: PostHog[] = []
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
        ...(options.remoteConfigLoader ? {} : { remoteConfig }),
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
        await client.flush()
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
        disabled.captureLog({ body: 'ignored' })
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
            client.captureLog({ body: 'hello', level: 'warn', attributes: { custom: 1 } })
            await client.flush()
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
            client.captureLog({ body: 'programmatic' })
            await client.flush()
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
        let resolve!: (value: typeof remoteConfig & { logs: { captureConsoleLogs: boolean } }) => void
        const loaded = new Promise<typeof remoteConfig & { logs: { captureConsoleLogs: boolean } }>((done) => {
            resolve = done
        })
        const client = await create({ remoteConfigLoader: () => loaded })
        const original = output.log
        resolve({ ...remoteConfig, logs: { captureConsoleLogs: true } })
        await client.getRemoteConfig()
        expect(output.log).not.toBe(original)
    })

    it('purges programmatic and console queues on denial/reset without resurrecting after regrant', async () => {
        const { output } = browser()
        const fetch = vi.fn(async () => new Response('{}'))
        const client = await create({ fetch, logs: { captureConsoleLogs: true } })
        client.captureLog({ body: 'old' })
        output.log('old console')
        client.optOut()
        client.captureLog({ body: 'denied' })
        output.log('denied console')
        client.optIn()
        await client.flush()
        expect(fetch).not.toHaveBeenCalled()
        client.captureLog({ body: 'before reset' })
        client.reset()
        await client.flush()
        expect(fetch).not.toHaveBeenCalled()
        client.captureLog({ body: 'fresh' })
        await client.shutdown()
        expect(fetch).toHaveBeenCalledOnce()
        client.captureLog({ body: 'after shutdown' })
        await client.flush()
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
            client.captureLog({ body: 'record' })
            await client.flush()
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
            client.captureLog({ body: 'reentrant' })
            return new Response('{}')
        })
        const client = await create({ fetch })
        client.captureLog({ body: 'before shutdown' })
        await client.shutdown()
        expect(fetch).toHaveBeenCalledOnce()
    })

    it('bounds shutdown, aborts and settles a transport that never responds', async () => {
        let signal: AbortSignal | undefined
        const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
            signal = init?.signal ?? undefined
            return new Promise<Response>(() => {})
        })
        const client = await create({ fetch })
        client.captureLog({ body: 'pending' })
        const closing = client.shutdown(10)
        client.captureLog({ body: 'too late' })
        await vi.advanceTimersByTimeAsync(10)
        await closing
        expect(signal?.aborted).toBe(true)
        expect(fetch).toHaveBeenCalledOnce()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('keeps ordinary requests closed while admitted logs finish shutdown', async () => {
        let ordinary!: Client
        const fetch = vi.fn(() => new Promise<Response>(() => {}))
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
        client.captureLog({ body: 'before closing' })
        const closing = client.shutdown(10)
        expect((await client.sendRequest('/i/v1/logs')).statusCode).toBe(0)
        expect((await ordinary.sendRequest('/i/v1/logs')).statusCode).toBe(0)
        expect(fetch).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(10)
        await closing
        expect(vi.getTimerCount()).toBe(0)
    })

    it('settles rejected requests and leaves the queue available to a later flush', async () => {
        const fetch = vi
            .fn()
            .mockRejectedValueOnce(new Error('network unavailable'))
            .mockResolvedValue(new Response('{}'))
        const client = await create({ fetch })
        client.captureLog({ body: 'retry' })
        await client.flush()
        await client.flush()
        expect(fetch).toHaveBeenCalledTimes(2)
        await client.shutdown()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('uses logs Beacon on pagehide, falls back to keepalive, and removes the listener', async () => {
        const { window } = browser()
        const sendBeacon = vi.fn(() => false)
        const fetch = vi.fn(async () => new Response('{}'))
        const client = await create({ navigator: { sendBeacon }, disableBotDetection: true, fetch })
        client.captureLog({ body: 'teardown' })
        window.dispatchEvent(new Event('pagehide'))
        expect(sendBeacon).toHaveBeenCalledOnce()
        expect((fetch.mock.calls as unknown as Array<[unknown, RequestInit]>)[0]?.[1]).toMatchObject({
            keepalive: true,
        })
        await client.dispose()
        window.dispatchEvent(new Event('pagehide'))
        expect(sendBeacon).toHaveBeenCalledOnce()
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
        client.captureLog({ body: 'old' })
        const pending = client.flush()
        client.optOut()
        client.optIn()
        finish(new Response('{}', { status: 500 }))
        await pending
        fetch.mockImplementation(() => {
            throw new Error('synchronous fetch')
        })
        client.captureLog({ body: 'new' })
        await client.flush()
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
        client.captureLog({ body: 'unavailable' })
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
        client.updateFlags({ enabled: true, disabled: false, variant: 'a' })
        const captured = vi.fn()
        client.onEvent(captured)
        client.captureLog({ body: 'flags' })
        await client.flush()
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
        client.captureLog({ body: 'before session' })
        await client.flush()
        expect(client.session.sessionId).toBe('')
        expect(records(bodies[0]!)[0]?.attributes?.some(({ key }) => key === 'sessionStartTimestamp')).toBe(false)
        client.capture('admitted')
        const session = client.session
        vi.setSystemTime(1_700_000_000_100)
        client.captureLog({ body: 'with session' })
        await client.flush()
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
