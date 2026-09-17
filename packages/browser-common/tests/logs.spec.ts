/* oxlint-disable compat/compat */
import { PostHogLogs } from '../src/logs'
import type { ConsoleLogsCapture, ConsoleLogsLoader } from '../src/logs-types'
import type { BrowserLogsConfig } from '../src/logs-config'
import { createTestClient } from './helpers/test-client'

const extensions: PostHogLogs[] = []
const create = (options: { config?: BrowserLogsConfig; loader?: ConsoleLogsLoader; setup?: boolean } = {}) => {
    const client = createTestClient({ distinctId: 'test-person' })
    client.library = { name: 'test-sdk', version: '1.2.3' }
    const send = vi.spyOn(client, 'sendRequest')
    let config = options.config ?? { flushIntervalMs: 3000 }
    const logs = new (class extends PostHogLogs {
        protected override _getConsoleLoader() {
            return options.loader
        }
    })({ get: () => config, captureHintKey: 'consoleCaptureEnabled', remoteConfigWillArrive: true })
    extensions.push(logs)
    if (options.setup !== false) logs.setup(client)
    return { client, logs, send, setConfig: (value: BrowserLogsConfig) => (config = value) }
}
const browser = () => {
    const console = { log: vi.fn() }
    const window = Object.assign(new EventTarget(), { console })
    vi.stubGlobal('window', window)
    return { window, console }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
    for (const logs of extensions.splice(0)) logs.dispose()
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe('shared logs', () => {
    it('keeps programmatic and console resources separate for explicit transport flushes', () => {
        const { logs, send } = create()
        logs.captureLog({ body: 'programmatic' })
        logs.captureConsoleLog({ body: 'console' })
        logs.flushLogs('sendBeacon')
        expect(send).toHaveBeenCalledTimes(2)
        expect(send.mock.calls.map(([path, init]) => [path, init?.transport])).toEqual([
            ['/i/v1/logs', 'sendBeacon'],
            ['/i/v1/logs', 'sendBeacon'],
        ])
        const resources = send.mock.calls.map(([, init]) => (init?.body as any).resourceLogs[0])
        expect(resources[0].scopeLogs[0].scope.name).toBe('test-sdk')
        expect(resources[1].scopeLogs[0].scope.name).toBe('console')
        expect(resources[1].resource.attributes).toContainEqual({
            key: 'service.name',
            value: { stringValue: 'posthog-browser-logs' },
        })
    })

    it('reads live capture eligibility and config without changing queued record context', () => {
        const { logs, client, send, setConfig } = create()
        client.canCapture = false
        logs.captureLog({ body: 'denied' })
        client.canCapture = true
        logs.captureLog({ body: 'allowed' })
        setConfig({ serviceName: 'after' })
        logs.captureLog({ body: 'changed config' })
        logs.flushLogs('fetch')
        const payload = send.mock.calls[0]![1]?.body as any
        expect(payload.resourceLogs[0].resource.attributes).toContainEqual({
            key: 'service.name',
            value: { stringValue: 'after' },
        })
        expect(payload.resourceLogs[0].scopeLogs[0].logRecords.map((record: any) => record.body)).toEqual([
            { stringValue: 'allowed' },
            { stringValue: 'changed config' },
        ])
    })

    it.each([503, 408, 429, 0])('classifies status %s through the shared queue retry policy', async (statusCode) => {
        const { logs, send } = create()
        send.mockResolvedValueOnce({ statusCode })
        logs.captureLog({ body: 'retry me' })
        logs.flushLogs()
        await vi.advanceTimersByTimeAsync(0)
        expect(send).toHaveBeenCalledTimes(1)
        logs.flushLogs()
        await vi.advanceTimersByTimeAsync(0)
        expect(send).toHaveBeenCalledTimes(2)
        expect(send.mock.calls[0]?.[1]?.body).toEqual(send.mock.calls[1]?.[1]?.body)
        logs.flushLogs()
        await vi.advanceTimersByTimeAsync(0)
        expect(send).toHaveBeenCalledTimes(2)
    })

    it('settles rejected and stalled requests without wedging the queue', async () => {
        const { logs, send } = create({ config: { flushIntervalMs: 0 } })
        send.mockRejectedValueOnce(new Error('transport rejected'))
        logs.captureLog({ body: 'retry me' })
        logs.flushLogs()
        await vi.advanceTimersByTimeAsync(0)
        send.mockImplementationOnce(() => new Promise(() => {}))
        logs.flushLogs()
        await vi.advanceTimersByTimeAsync(90_000)
        logs.flushLogs()
        await vi.advanceTimersByTimeAsync(0)
        expect(send).toHaveBeenCalledTimes(3)
    })

    it('hands buffered console calls to a synchronous loader before live capture starts', () => {
        const { console } = browser()
        const original = console.log
        const capture: ConsoleLogsCapture = {
            initialize: vi.fn(() => {
                expect(console.log).toBe(original)
                return vi.fn()
            }),
            replay: vi.fn(),
        }
        const { logs, client } = create({ setup: false, loader: (callback) => callback(undefined, capture) })
        client.kv.set('consoleCaptureEnabled', true)
        logs.setup(client)
        console.log('before remote config')
        client.setRemoteConfig({ logs: { captureConsoleLogs: true } })
        expect(client.kv.get('consoleCaptureEnabled')).toBe(true)
        expect(capture.initialize).toHaveBeenCalledWith(client)
        expect(capture.replay).toHaveBeenCalledWith(client, [
            expect.objectContaining({
                args: ['before remote config'],
                context: expect.objectContaining({ distinctId: 'test-person' }),
                level: 'log',
            }),
        ])
        expect(original).toHaveBeenCalledWith('before remote config')
        logs.dispose()
        expect(vi.mocked(capture.initialize).mock.results[0]?.value).toHaveBeenCalledTimes(1)
    })

    it('withdraws a persisted hint recorder and ignores a loader resolving after disposal', () => {
        const { console } = browser()
        const original = console.log
        let loaded: Parameters<ConsoleLogsLoader>[0] | undefined
        const { logs, client } = create({
            setup: false,
            loader: (callback) => {
                loaded = callback
            },
        })
        client.kv.set('consoleCaptureEnabled', true)
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

    it('binds lazily without activating console capture, storage or subscriptions', () => {
        const { console, window } = browser()
        const original = console.log
        const listen = vi.spyOn(window, 'addEventListener')
        const loader = vi.fn()
        const { logs, client } = create({ setup: false, config: { captureConsoleLogs: true }, loader })
        const getClient = vi.fn(() => client)
        const initialize = vi.spyOn(client.kv, 'initialize')
        const subscribe = vi.spyOn(client, 'onRemoteConfig')
        logs._bindClient(getClient)
        void logs.logger
        expect(getClient).not.toHaveBeenCalled()
        expect(listen).not.toHaveBeenCalled()
        logs.logger.info('before setup')
        expect(initialize).not.toHaveBeenCalled()
        expect(subscribe).not.toHaveBeenCalled()
        expect(listen).toHaveBeenCalledTimes(1)
        expect(loader).not.toHaveBeenCalled()
        expect(console.log).toBe(original)
        logs.setup(client)
        logs.setup(client)
        expect(initialize).toHaveBeenCalledTimes(1)
        expect(subscribe).toHaveBeenCalledTimes(1)
        expect(loader).toHaveBeenCalledTimes(1)
    })

    it('does not activate after disposal during asynchronous storage initialization', async () => {
        const { window } = browser()
        const listen = vi.spyOn(window, 'addEventListener')
        const { logs, client } = create({ setup: false })
        let finish!: () => void
        vi.spyOn(client.kv, 'initialize').mockReturnValue(
            new Promise<void>((resolve) => {
                finish = resolve
            })
        )
        const ready = logs.setup(client)
        logs.dispose()
        finish()
        await ready
        expect(listen).not.toHaveBeenCalled()
    })

    it.each([200, 413])('retires an in-flight %s response on disposal', async (statusCode) => {
        const { logs, send } = create({ config: { flushIntervalMs: 0 } })
        let finish!: (response: { statusCode: number }) => void
        send.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve
                })
        )
        logs.captureLog({ body: 'first' })
        logs.captureLog({ body: 'second' })
        logs.flushLogs()
        logs.dispose()
        finish({ statusCode })
        await vi.advanceTimersByTimeAsync(0)
        expect(send).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('removes an early reconnect listener when disposed before setup', () => {
        const { window } = browser()
        const { logs, client, send } = create({ setup: false })
        const remove = vi.spyOn(window, 'removeEventListener')
        logs._bindClient(() => client)
        logs.captureLog({ body: 'before setup' })
        logs.dispose()
        window.dispatchEvent(new Event('online'))
        expect(send).not.toHaveBeenCalled()
        expect(remove).toHaveBeenCalledWith('online', expect.any(Function))
    })

    it('disposes a bound but inactive extension without constructing its client', () => {
        const { logs, client } = create({ setup: false })
        const getClient = vi.fn(() => client)
        logs._bindClient(getClient)
        logs.dispose()
        logs.captureLog({ body: 'disposed' })
        expect(getClient).not.toHaveBeenCalled()
    })
})
