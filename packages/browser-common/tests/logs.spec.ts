import { PostHogLogs } from '../src/logs'
import type { BrowserLogsHost, ConsoleLogsCapture } from '../src/logs-host'
import type { BrowserLogsConfig } from '../src/logs-config'
import { createTestClient } from './helpers/test-client'

const extensions: PostHogLogs[] = []
const create = (overrides: Partial<BrowserLogsHost> = {}) => {
    const host: BrowserLogsHost = {
        config: { flushIntervalMs: 3000 },
        window: undefined,
        console: undefined,
        isCapturing: true,
        isLoaded: true,
        libraryName: 'test-sdk',
        libraryVersion: '1.2.3',
        persistedCaptureHint: false,
        remoteConfigWillArrive: true,
        persistCaptureHint: vi.fn(),
        getSdkContext: () => ({ distinctId: 'test-person' }),
        sendRequest: vi.fn((_payload, _transport, callback) => callback?.({ statusCode: 200 })),
        getConsoleLoader: () => undefined,
        ...overrides,
    }
    const logs = new PostHogLogs(host)
    extensions.push(logs)
    return { host, logs }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
    for (const logs of extensions.splice(0)) logs.dispose()
    vi.useRealTimers()
})

describe('shared logs', () => {
    it('keeps programmatic and console resources separate for explicit transport flushes', () => {
        const { logs, host } = create()
        logs.captureLog({ body: 'programmatic' })
        logs.captureConsoleLog({ body: 'console' })
        logs.flushLogs('sendBeacon')
        expect(host.sendRequest).toHaveBeenCalledTimes(2)
        const calls = vi.mocked(host.sendRequest).mock.calls
        expect(calls.map((call) => call[1])).toEqual(['sendBeacon', 'sendBeacon'])
        const resources = calls.map(([payload]) => payload.resourceLogs[0]!)
        expect(resources[0]?.scopeLogs[0]?.scope.name).toBe('test-sdk')
        expect(resources[1]?.scopeLogs[0]?.scope.name).toBe('console')
        expect(resources[1]?.resource.attributes).toContainEqual({
            key: 'service.name',
            value: { stringValue: 'posthog-browser-logs' },
        })
    })

    it('reads live capture eligibility and config without changing queued record context', () => {
        let capturing = false
        let config: BrowserLogsConfig = { serviceName: 'before' }
        const { logs, host } = create()
        Object.defineProperties(host, {
            isCapturing: { get: () => capturing },
            config: { get: () => config },
        })
        logs.captureLog({ body: 'denied' })
        capturing = true
        logs.captureLog({ body: 'allowed' })
        config = { serviceName: 'after' }
        logs.captureLog({ body: 'changed config' })
        logs.flushLogs('fetch')
        const payload = vi.mocked(host.sendRequest).mock.calls[0]![0]
        expect(payload.resourceLogs[0]?.resource.attributes).toContainEqual({
            key: 'service.name',
            value: { stringValue: 'after' },
        })
        expect(payload.resourceLogs[0]?.scopeLogs[0]?.logRecords.map((record) => record.body)).toEqual([
            { stringValue: 'allowed' },
            { stringValue: 'changed config' },
        ])
    })

    it('classifies transport failures through the shared queue retry policy', async () => {
        const { logs, host } = create()
        vi.mocked(host.sendRequest).mockImplementationOnce((_payload, _transport, callback) =>
            callback?.({ statusCode: 503 })
        )
        logs.captureLog({ body: 'retry me' })
        logs.flushLogs()
        await vi.advanceTimersByTimeAsync(0)
        expect(host.sendRequest).toHaveBeenCalledTimes(1)
        logs.flushLogs()
        await vi.advanceTimersByTimeAsync(0)
        expect(host.sendRequest).toHaveBeenCalledTimes(2)
        expect(vi.mocked(host.sendRequest).mock.calls[0]?.[0]).toEqual(vi.mocked(host.sendRequest).mock.calls[1]?.[0])
        logs.flushLogs()
        await vi.advanceTimersByTimeAsync(0)
        expect(host.sendRequest).toHaveBeenCalledTimes(2)
    })

    it('hands buffered console calls to a synchronous loader before live capture starts', () => {
        const original = vi.fn()
        const console = { log: original } as unknown as Console
        const client = createTestClient()
        const capture: ConsoleLogsCapture = {
            initialize: vi.fn(() => {
                expect(console.log).toBe(original)
                return vi.fn()
            }),
            replay: vi.fn(),
        }
        const { logs, host } = create({
            console,
            persistedCaptureHint: true,
            getConsoleLoader: () => (callback) => callback(undefined, capture),
        })
        logs.setup(client)
        console.log('before remote config')
        client.setRemoteConfig({ logs: { captureConsoleLogs: true } })
        expect(host.persistCaptureHint).toHaveBeenCalledWith(true)
        expect(capture.initialize).toHaveBeenCalledWith(client)
        expect(capture.replay).toHaveBeenCalledWith(client, [
            expect.objectContaining({
                args: ['before remote config'],
                context: { distinctId: 'test-person' },
                level: 'log',
            }),
        ])
        expect(original).toHaveBeenCalledWith('before remote config')
        logs.dispose()
        expect(vi.mocked(capture.initialize).mock.results[0]?.value).toHaveBeenCalledTimes(1)
    })

    it('withdraws a persisted hint recorder and ignores a loader resolving after disposal', () => {
        const original = vi.fn()
        const console = { log: original } as unknown as Console
        let loaded: Parameters<NonNullable<ReturnType<BrowserLogsHost['getConsoleLoader']>>>[0] | undefined
        const { logs } = create({
            console,
            persistedCaptureHint: true,
            getConsoleLoader: () => (callback) => {
                loaded = callback
            },
        })
        const client = createTestClient()
        logs.setup(client)
        expect(console.log).not.toBe(original)
        client.setRemoteConfig({ logs: { captureConsoleLogs: false } })
        expect(console.log).toBe(original)
        client.setRemoteConfig({ logs: { captureConsoleLogs: true } })
        logs.dispose()
        const capture = { initialize: vi.fn(), replay: vi.fn() }
        loaded?.(undefined, capture)
        expect(capture.initialize).not.toHaveBeenCalled()
        expect(console.log).toBe(original)
    })
})
