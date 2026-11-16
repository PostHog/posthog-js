import type { Mock, SpyInstance } from 'vitest'
/* oxlint-disable compat/compat */
// @vitest-environment jsdom
import type { Client } from '../src/client'
import { PostHogLogs, RECORDER_MAX_AGE_MS } from '../src/logs'
import type { BrowserLogsConfig } from '../src/logs-config'
import type { ConsoleLogsLoader } from '../src/logs-types'
import { createTestClient, type TestClient } from './helpers/test-client'

const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    critical: vi.fn(),
    createLogger: vi.fn(),
}
mockLogger.createLogger.mockImplementation(() => mockLogger)

const CAPTURE_HINT_KEY = 'consoleCaptureEnabled'

describe('PostHogLogs', () => {
    describe('shared behavior', () => {
        let testClient: TestClient
        let logs: PostHogLogs
        let config: BrowserLogsConfig | undefined
        let send: SpyInstance<Parameters<Client['sendRequest']>, ReturnType<Client['sendRequest']>>
        let mockDisposeLogs: Mock
        let mockInitializeLogs: Mock
        let mockReplayConsoleBuffer: Mock
        let mockLoader: ReturnType<typeof vi.fn<Parameters<ConsoleLogsLoader>, ReturnType<ConsoleLogsLoader>>>
        const clients = new Map<PostHogLogs, TestClient>()
        const flagsResponse = { logs: { captureConsoleLogs: true } }
        const newClient = () =>
            createTestClient({
                logger: mockLogger,
                distinctId: 'distinct-id-123',
                session: {
                    sessionId: 'session-abc',
                    windowId: 'window-xyz',
                    sessionStartTimestamp: 1672567200000,
                    lastActivityTimestamp: 1672567200000,
                },
            })
        const makeLogs = (client: TestClient = testClient) => {
            const extension = new (class extends PostHogLogs {
                protected override _getConsoleLoader(): ConsoleLogsLoader {
                    return mockLoader
                }
            })({ get: () => config, captureHintKey: CAPTURE_HINT_KEY, remoteConfigWillArrive: true }, () => {
                const session = client.session
                return { distinctId: client.distinctId, ...(session?.sessionId ? session : {}) }
            })
            clients.set(extension, client)
            return extension
        }
        const setupLogs = (extension: PostHogLogs, overrides: Partial<Client> = {}) => {
            const client = Object.assign(clients.get(extension)!, overrides)
            extension.setup(client)
            return client
        }
        const createLogs = (client: TestClient = testClient) => {
            const extension = makeLogs(client)
            setupLogs(extension)
            return extension
        }
        beforeEach(() => {
            vi.clearAllMocks()
            config = undefined
            mockDisposeLogs = vi.fn()
            mockInitializeLogs = vi.fn(() => mockDisposeLogs)
            mockReplayConsoleBuffer = vi.fn()
            mockLoader = vi.fn((callback) =>
                callback(undefined, {
                    initialize: mockInitializeLogs,
                    replay: mockReplayConsoleBuffer,
                })
            )
            testClient = newClient()
            testClient.library = { name: 'test-sdk', version: '1.2.3' }
            send = vi.spyOn(testClient, 'sendRequest')
            logs = createLogs()
        })
        afterEach(() => {
            for (const [extension, client] of clients) {
                extension.dispose()
                client.dispose()
            }
            clients.clear()
            vi.useRealTimers()
        })

        describe('shared extension lifecycle', () => {
            it('captures logs without a session', () => {
                const client = newClient()
                client.session = undefined
                const extension = makeLogs(client)
                setupLogs(extension)
                extension.captureLog({ body: 'before session' })
                extension.flushLogs('sendBeacon')

                expect(client.sentRequests).toHaveLength(1)
                const payload = JSON.stringify(client.sentRequests[0]?.init?.body)
                expect(payload).not.toContain('"sessionId"')
                expect(payload).not.toContain('"sessionStartTimestamp"')
                expect(payload).not.toContain('"lastActivityTimestamp"')
            })

            it('subscribes to remote config during setup', () => {
                const remoteConfigDispose = vi.fn()
                let remoteConfigHandler: ((result: any) => void) | undefined
                const client = {
                    onRemoteConfig: vi.fn((handler: (result: any) => void) => {
                        remoteConfigHandler = handler
                        return { dispose: remoteConfigDispose }
                    }),
                } satisfies Partial<Client>

                logs.dispose()
                logs = makeLogs(testClient)
                setupLogs(logs, client)
                remoteConfigHandler?.({ ok: true, config: flagsResponse })

                expect(logs.name).toBe('logs')
                expect(client.onRemoteConfig).toHaveBeenCalledTimes(1)
                expect(mockInitializeLogs).toHaveBeenCalledWith(
                    expect.objectContaining({ onRemoteConfig: client.onRemoteConfig })
                )

                logs.dispose()
                expect(remoteConfigDispose).toHaveBeenCalledTimes(1)
                expect(mockDisposeLogs).toHaveBeenCalledTimes(1)
            })

            it('does not load twice when setup replays enabled remote config', () => {
                let loadCallback: Parameters<ConsoleLogsLoader>[0] | undefined
                mockLoader.mockImplementation((callback) => {
                    loadCallback = callback
                })
                const client = {
                    onRemoteConfig: (handler: (result: any) => void) => {
                        handler({ ok: true, config: flagsResponse })
                        return { dispose: vi.fn() }
                    },
                } satisfies Partial<Client>

                logs.dispose()
                logs = makeLogs(testClient)
                setupLogs(logs, client)
                loadCallback?.(undefined, { initialize: mockInitializeLogs, replay: mockReplayConsoleBuffer })

                expect(mockLoader).toHaveBeenCalledTimes(1)
                expect(mockInitializeLogs).toHaveBeenCalledTimes(1)
            })

            it('does not retry a synchronous replay load failure during setup', () => {
                mockLoader.mockImplementation((callback) => {
                    callback(new Error('Loading failed'))
                })
                const client = {
                    onRemoteConfig: (handler: (result: any) => void) => {
                        handler({ ok: true, config: flagsResponse })
                        return { dispose: vi.fn() }
                    },
                } satisfies Partial<Client>

                logs.dispose()
                logs = makeLogs(testClient)
                setupLogs(logs, client)

                expect(mockLoader).toHaveBeenCalledTimes(1)
                expect(mockInitializeLogs).not.toHaveBeenCalled()
            })

            it('releases resources and ignores late work on dispose', () => {
                const remoteConfigDispose = vi.fn()
                let remoteConfigHandler: ((result: any) => void) | undefined
                const client = {
                    onRemoteConfig: (handler: (result: any) => void) => {
                        remoteConfigHandler = handler
                        return { dispose: remoteConfigDispose }
                    },
                } satisfies Partial<Client>
                const removeEventListener = vi.spyOn(window, 'removeEventListener')

                logs.dispose()
                logs = makeLogs(testClient)
                setupLogs(logs, client)
                logs.dispose()
                logs.dispose()
                remoteConfigHandler?.({ ok: true, config: flagsResponse })

                expect(remoteConfigDispose).toHaveBeenCalledTimes(1)
                expect(removeEventListener).toHaveBeenCalledWith('online', expect.any(Function))
                expect(mockLoader).not.toHaveBeenCalled()
                removeEventListener.mockRestore()
            })

            it('does not initialize a lazy logs chunk after disposal', () => {
                let loadCallback: Parameters<ConsoleLogsLoader>[0] | undefined
                mockLoader.mockImplementation((callback) => {
                    loadCallback = callback
                })
                ;(logs as any)._isLogsEnabled = true

                logs.loadIfEnabled()
                logs.dispose()
                loadCallback?.(undefined, { initialize: mockInitializeLogs, replay: mockReplayConsoleBuffer })

                expect(mockInitializeLogs).not.toHaveBeenCalled()
                expect((logs as any)._isLoaded).toBe(false)
            })

            it('flushes queued logs before disposing the extension', () => {
                vi.useFakeTimers()
                try {
                    logs.captureLog({ body: 'queued before shutdown' })

                    logs.flushLogs('sendBeacon')
                    logs.dispose()

                    expect((logs as any)._queue).toHaveLength(0)
                    expect(send).toHaveBeenCalledWith(
                        expect.any(String),
                        expect.objectContaining({ transport: 'sendBeacon' })
                    )
                } finally {
                    vi.useRealTimers()
                }
            })
        })

        describe('onRemoteConfig', () => {
            it('should not enable logs if captureConsoleLogs is false', () => {
                const response = {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar' as const,
                    isAuthenticated: false,
                    siteApps: [],
                    logs: { captureConsoleLogs: false },
                }

                logs.onRemoteConfig({ ok: true, config: response })

                expect((logs as any)._isLogsEnabled).toBeFalsy()
            })

            it('should not enable logs if logs config is null', () => {
                const response = {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar' as const,
                    isAuthenticated: false,
                    siteApps: [],
                    logs: null,
                } as any

                logs.onRemoteConfig({ ok: true, config: response })

                expect((logs as any)._isLogsEnabled).toBeFalsy()
            })

            it('should not enable logs if logs config is undefined', () => {
                const response = {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar' as const,
                    isAuthenticated: false,
                    siteApps: [],
                }

                logs.onRemoteConfig({ ok: true, config: response })

                expect((logs as any)._isLogsEnabled).toBeFalsy()
            })

            it('should enable logs if captureConsoleLogs is true', () => {
                const response = {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar' as const,
                    isAuthenticated: false,
                    siteApps: [],
                    logs: { captureConsoleLogs: true },
                }

                logs.onRemoteConfig({ ok: true, config: response })

                expect((logs as any)._isLogsEnabled).toBe(true)
            })

            it('should call loadIfEnabled when logs are enabled', () => {
                const loadIfEnabledSpy = vi.spyOn(logs, 'loadIfEnabled')
                const response = {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar' as const,
                    isAuthenticated: false,
                    siteApps: [],
                    logs: { captureConsoleLogs: true },
                }

                logs.onRemoteConfig({ ok: true, config: response })

                expect(loadIfEnabledSpy).toHaveBeenCalled()
            })
        })

        describe('reset', () => {
            it('should not throw when the queue is empty', () => {
                expect(() => logs.reset()).not.toThrow()
            })
        })

        describe('loadIfEnabled', () => {
            it('should not initialize if logs are not enabled', () => {
                logs.loadIfEnabled()

                expect(mockLoader).not.toHaveBeenCalled()
                expect(mockInitializeLogs).not.toHaveBeenCalled()
            })

            it('should handle loadExternalDependency errors', () => {
                ;(logs as any)._isLogsEnabled = true
                mockLoader.mockImplementation((callback) => {
                    callback(new Error('Loading failed'))
                })

                logs.loadIfEnabled()

                expect(mockLogger.error).toHaveBeenCalledWith('Could not load logs script', expect.any(Error))
                expect(mockInitializeLogs).not.toHaveBeenCalled()
            })

            it('should not reinitialize logs if called multiple times', () => {
                ;(logs as any)._isLogsEnabled = true

                logs.loadIfEnabled()
                logs.loadIfEnabled()

                expect(mockLoader).toHaveBeenCalledTimes(1)
                expect(mockInitializeLogs).toHaveBeenCalledTimes(1)
            })
        })

        describe('integration scenarios', () => {
            it('should handle complete initialization flow', () => {
                const response = {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar' as const,
                    isAuthenticated: false,
                    siteApps: [],
                    logs: { captureConsoleLogs: true },
                }

                logs.onRemoteConfig({ ok: true, config: response })

                expect((logs as any)._isLogsEnabled).toBe(true)
                expect(mockLoader).toHaveBeenCalledWith(expect.any(Function))
                expect(mockInitializeLogs).toHaveBeenCalledWith(testClient)
            })

            it('should not initialize when logs are disabled in remote config', () => {
                const response = {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar' as const,
                    isAuthenticated: false,
                    siteApps: [],
                    logs: { captureConsoleLogs: false },
                }

                logs.onRemoteConfig({ ok: true, config: response })
                logs.loadIfEnabled()

                expect(mockLoader).not.toHaveBeenCalled()
                expect(mockInitializeLogs).not.toHaveBeenCalled()
            })

            it('should handle remote config being called multiple times', () => {
                const enabledResponse = {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar' as const,
                    isAuthenticated: false,
                    siteApps: [],
                    logs: { captureConsoleLogs: true },
                }
                const disabledResponse = {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar' as const,
                    isAuthenticated: false,
                    siteApps: [],
                    logs: { captureConsoleLogs: false },
                }

                // First enable
                logs.onRemoteConfig({ ok: true, config: enabledResponse })
                expect((logs as any)._isLogsEnabled).toBe(true)

                // The server reports `false` for every project that has not opted in, so
                // it cannot revoke capture the caller enabled.
                logs.onRemoteConfig({ ok: true, config: disabledResponse })
                expect((logs as any)._isLogsEnabled).toBe(true)

                // Enable again
                logs.onRemoteConfig({ ok: true, config: enabledResponse })
                expect((logs as any)._isLogsEnabled).toBe(true)
            })

            it('should work with various log capture configurations', () => {
                const baseConfig = {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar' as const,
                    isAuthenticated: false,
                    siteApps: [],
                }
                const configs = [
                    { ...baseConfig, logs: { captureConsoleLogs: true } },
                    { ...baseConfig, logs: { captureConsoleLogs: true, otherConfig: false } },
                    { ...baseConfig, logs: { captureConsoleLogs: true, level: 'info' } },
                ]

                configs.forEach((config) => {
                    const testLogs = createLogs(testClient)
                    testLogs.onRemoteConfig({ ok: true, config: config })
                    expect((testLogs as any)._isLogsEnabled).toBe(true)
                })
            })
        })

        describe('error handling and edge cases', () => {
            it('should handle malformed remote config responses', () => {
                const baseConfig = {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar' as const,
                    isAuthenticated: false,
                    siteApps: [],
                }
                const malformedResponses = [
                    { ...baseConfig },
                    { ...baseConfig, logs: null },
                    { ...baseConfig, logs: undefined },
                    { ...baseConfig, logs: {} },
                    { ...baseConfig, logs: { captureConsoleLogs: null } },
                    { ...baseConfig, logs: { captureConsoleLogs: undefined } },
                    { ...baseConfig, logs: { someOtherProp: true } },
                ]

                malformedResponses.forEach((response) => {
                    const testLogs = createLogs(testClient)
                    expect(() => testLogs.onRemoteConfig({ ok: true, config: response as any })).not.toThrow()
                    expect((testLogs as any)._isLogsEnabled).toBeFalsy()
                })

                // Test null and undefined separately since they can't be spread
                const nullUndefinedResponses = [null, undefined]
                nullUndefinedResponses.forEach((response) => {
                    const testLogs = createLogs(testClient)
                    expect(() => testLogs.onRemoteConfig({ ok: true, config: response as any })).toThrow()
                })
            })

            it('should handle async loading errors gracefully', () => {
                ;(logs as any)._isLogsEnabled = true
                mockLoader.mockImplementation((callback) => {
                    // Simulate async error
                    setTimeout(() => callback(new Error('Network error')), 0)
                })

                logs.loadIfEnabled()

                // Since the error is async, we need to wait for it
                return new Promise((resolve) => {
                    setTimeout(() => {
                        expect(mockLogger.error).toHaveBeenCalledWith('Could not load logs script', expect.any(Error))
                        resolve(undefined)
                    }, 10)
                })
            })
        })

        describe('captureLog', () => {
            beforeEach(() => {
                vi.useFakeTimers()
            })

            afterEach(() => {
                vi.useRealTimers()
            })

            it('should silently skip when user has opted out of capturing', () => {
                testClient.canCapture = false

                logs.captureLog({ body: 'should not be captured' })

                expect((logs as any)._queue).toHaveLength(0)
                expect(send).not.toHaveBeenCalled()
            })

            it('should skip if no body provided', () => {
                logs.captureLog({} as any)

                expect((logs as any)._queue).toHaveLength(0)
            })

            it('should skip if body is empty string', () => {
                logs.captureLog({ body: '' })

                expect((logs as any)._queue).toHaveLength(0)
            })

            it('should add a log record to the buffer', () => {
                logs.captureLog({ body: 'test message' })

                expect((logs as any)._queue).toHaveLength(1)
                expect((logs as any)._queue[0].record.body.stringValue).toBe('test message')
            })

            it('should not send before the flush timer expires', () => {
                logs.captureLog({ body: 'test message' })

                expect(send).not.toHaveBeenCalled()
            })

            it('should flush on timer expiry and clear the queue on success', async () => {
                logs.captureLog({ body: 'test message' })

                await vi.advanceTimersByTimeAsync(3000)

                expect(send).toHaveBeenCalledTimes(1)
                expect((logs as any)._queue).toHaveLength(0)
            })

            it('should flush immediately when buffer reaches max size', () => {
                config = { maxBufferSize: 5, maxLogsPerInterval: 1000 }
                logs = createLogs(testClient)

                for (let i = 0; i < 5; i++) {
                    logs.captureLog({ body: `message ${i}` })
                }

                expect(send).toHaveBeenCalledTimes(1)
            })

            it('retains a burst past maxBufferSize up to the rate-cap reservoir (no eviction at the flush trigger)', () => {
                // Hold the flush open so capture outpaces drain. maxBufferSize (2) only
                // triggers a flush; the eviction backstop sits at the rate cap (1000), so
                // a burst the cap admits is held in full rather than dropped at the trigger.
                send.mockImplementation(() => new Promise(() => {}))
                config = { maxBufferSize: 2, maxLogsPerInterval: 1000 }
                logs = createLogs(testClient)

                logs.captureLog({ body: 'oldest' })
                logs.captureLog({ body: 'middle' })
                logs.captureLog({ body: 'newest' })

                const bodies = (logs as any)._queue.map((e: any) => e.record.body.stringValue)
                expect(bodies).toEqual(['oldest', 'middle', 'newest'])
            })

            it('should send OTLP formatted payload', () => {
                logs.captureLog({ body: 'test', level: 'error' })
                vi.advanceTimersByTime(3000)

                const call = send.mock.calls[0]![1]!
                expect((call.body as any).resourceLogs).toBeDefined()
                expect((call.body as any).resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1)
                expect((call.body as any).resourceLogs[0].scopeLogs[0].logRecords[0].severityText).toBe('ERROR')
            })

            it('should batch multiple logs into one request', () => {
                logs.captureLog({ body: 'log 1' })
                logs.captureLog({ body: 'log 2' })
                logs.captureLog({ body: 'log 3' })
                vi.advanceTimersByTime(3000)

                expect(send).toHaveBeenCalledTimes(1)
                const call = send.mock.calls[0]![1]!
                expect((call.body as any).resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(3)
            })

            it('should include named config fields in OTLP resource attributes', () => {
                config = {
                    ...config,
                    serviceName: 'my-service',
                    serviceVersion: '1.2.3',
                    environment: 'production',
                }
                logs = createLogs(testClient)
                logs.captureLog({ body: 'test' })
                vi.advanceTimersByTime(3000)

                const call = send.mock.calls[0]![1]!
                const resourceAttrs = (call.body as any).resourceLogs[0].resource.attributes
                const attrsMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))

                expect(attrsMap['service.name']).toEqual({ stringValue: 'my-service' })
                expect(attrsMap['service.version']).toEqual({ stringValue: '1.2.3' })
                expect(attrsMap['deployment.environment']).toEqual({ stringValue: 'production' })
            })

            it('should include the detected OS in OTLP resource attributes', () => {
                Object.defineProperty(window.navigator, 'userAgent', {
                    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
                    configurable: true,
                })

                try {
                    logs = createLogs(testClient)
                    logs.captureLog({ body: 'test' })
                    vi.advanceTimersByTime(3000)

                    const call = send.mock.calls[0]![1]!
                    const attrsMap = Object.fromEntries(
                        (call.body as any).resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
                    )

                    expect(attrsMap['os.name']).toEqual({ stringValue: 'Windows' })
                    expect(attrsMap['os.version']).toEqual({ stringValue: '10' })
                } finally {
                    // @ts-expect-error restoring the jsdom prototype getter
                    delete window.navigator.userAgent
                }
            })

            it('should allow resourceAttributes to override named fields', () => {
                config = {
                    ...config,
                    serviceName: 'from-named',
                    serviceVersion: 'from-named',
                    environment: 'from-named',
                    resourceAttributes: {
                        'service.name': 'from-resource-attrs',
                        'service.version': 'from-resource-attrs',
                        'deployment.environment': 'from-resource-attrs',
                    },
                }
                logs = createLogs(testClient)
                logs.captureLog({ body: 'test' })
                vi.advanceTimersByTime(3000)

                const call = send.mock.calls[0]![1]!
                const resourceAttrs = (call.body as any).resourceLogs[0].resource.attributes
                const attrsMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))

                expect(attrsMap['service.name']).toEqual({ stringValue: 'from-resource-attrs' })
                expect(attrsMap['service.version']).toEqual({ stringValue: 'from-resource-attrs' })
                expect(attrsMap['deployment.environment']).toEqual({ stringValue: 'from-resource-attrs' })
            })

            it('should use consistent resource attributes across all logs in a batch', () => {
                config = {
                    ...config,
                    serviceName: 'my-service',
                }
                logs = createLogs(testClient)
                logs.captureLog({ body: 'log 1' })
                logs.captureLog({ body: 'log 2' })
                vi.advanceTimersByTime(3000)

                const call = send.mock.calls[0]![1]!
                const resourceAttrs = (call.body as any).resourceLogs[0].resource.attributes
                const attrsMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))

                expect(attrsMap['service.name']).toEqual({ stringValue: 'my-service' })
                expect((call.body as any).resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(2)
            })

            it('should default service.name to unknown_service when not configured', () => {
                logs.captureLog({ body: 'test' })
                vi.advanceTimersByTime(3000)

                const call = send.mock.calls[0]![1]!
                const resourceAttrs = (call.body as any).resourceLogs[0].resource.attributes
                const attrsMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))

                expect(attrsMap['service.name']).toEqual({ stringValue: 'unknown_service' })
            })

            it('should not send anything if buffer is empty on flush', () => {
                logs.flushLogs()

                expect(send).not.toHaveBeenCalled()
            })

            it('should drop logs that exceed maxLogsPerInterval and warn once', () => {
                config = {
                    ...config,
                    maxLogsPerInterval: 3,
                    maxBufferSize: 1000,
                }
                logs = createLogs(testClient)

                for (let i = 0; i < 10; i++) {
                    logs.captureLog({ body: `msg ${i}` })
                }

                expect((logs as any)._queue).toHaveLength(3)
                expect(mockLogger.warn).toHaveBeenCalledTimes(1)
                expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('dropping logs'))
            })

            it('should reset the rate-limit window after the interval elapses', () => {
                config = {
                    ...config,
                    maxLogsPerInterval: 2,
                    flushIntervalMs: 3000,
                    maxBufferSize: 1000,
                }
                logs = createLogs(testClient)

                logs.captureLog({ body: 'a' })
                logs.captureLog({ body: 'b' })
                logs.captureLog({ body: 'dropped' })
                expect((logs as any)._queue).toHaveLength(2)

                vi.advanceTimersByTime(3001)
                logs.captureLog({ body: 'c' })
                expect((logs as any)._queue.some((e: any) => e.record.body.stringValue === 'c')).toBe(true)
            })

            it('should work without console log autocapture enabled', () => {
                // captureLog works independently of _isLogsEnabled
                expect((logs as any)._isLogsEnabled).toBeFalsy()

                logs.captureLog({ body: 'works without autocapture' })
                vi.advanceTimersByTime(3000)

                expect(send).toHaveBeenCalledTimes(1)
            })

            it('should support transport override for unload', () => {
                logs.captureLog({ body: 'unload log' })
                logs.flushLogs('sendBeacon')

                const call = send.mock.calls[0]![1]!
                expect(call.transport).toBe('sendBeacon')
            })
        })

        describe('logger convenience methods', () => {
            beforeEach(() => {
                vi.useFakeTimers()
            })

            it.each(['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const)(
                'logger.%s() should capture a log with the correct level',
                (level) => {
                    logs.logger[level]('test message', { key: 'value' })
                    vi.advanceTimersByTime(3000)

                    const call = send.mock.calls[0]![1]!
                    const record = (call.body as any).resourceLogs[0].scopeLogs[0].logRecords[0]

                    expect(record.body.stringValue).toBe('test message')
                    const attrs = Object.fromEntries(record.attributes.map((a: any) => [a.key, a.value]))
                    expect(attrs.key).toEqual({ stringValue: 'value' })
                }
            )

            it('logger.info() should work without attributes', () => {
                logs.logger.info('no attrs')
                vi.advanceTimersByTime(3000)

                const call = send.mock.calls[0]![1]!
                const record = (call.body as any).resourceLogs[0].scopeLogs[0].logRecords[0]
                expect(record.body.stringValue).toBe('no attrs')
            })
        })

        describe('beforeSend', () => {
            const bodyOf = (l: PostHogLogs, i = 0) => (l as any)._queue[i]?.record.body.stringValue

            it.each([
                ['single function', (record: any) => ({ ...record, body: 'redacted' }), 'secret token=abc', 'redacted'],
                [
                    'left-to-right chain',
                    [
                        (record: any) => ({ ...record, body: record.body + '1' }),
                        (record: any) => ({ ...record, body: record.body + '2' }),
                    ],
                    'x',
                    'x12',
                ],
            ] as Array<[string, any, string, string]>)(
                'transforms the record via a %s',
                (_label, beforeSend, input, expected) => {
                    config = { beforeSend }
                    logs = createLogs(testClient)

                    logs.captureLog({ body: input })

                    expect((logs as any)._queue).toHaveLength(1)
                    expect(bodyOf(logs)).toBe(expected)
                }
            )

            it.each([
                ['single function returning null', () => null],
                ['chain with a null-returning link', [(record: any) => record, () => null, (record: any) => record]],
            ] as Array<[string, any]>)('drops the record when beforeSend is a %s', (_label, beforeSend) => {
                config = { beforeSend }
                logs = createLogs(testClient)

                logs.captureLog({ body: 'should be dropped' })

                expect((logs as any)._queue).toHaveLength(0)
            })

            it('drops the record when a beforeSend fn throws', () => {
                config = {
                    beforeSend: [
                        (record: any) => ({ ...record, body: 'kept' }),
                        () => {
                            throw new Error('boom')
                        },
                    ],
                }
                logs = createLogs(testClient)

                // A throwing filter must not crash captureLog; the record is
                // dropped and the error logged.
                expect(() => logs.captureLog({ body: 'x' })).not.toThrow()
                expect((logs as any)._queue).toHaveLength(0)
                expect(mockLogger.error).toHaveBeenCalledWith(
                    'Error in beforeSend function for log:',
                    expect.any(Error)
                )
            })
        })

        describe('sendBeacon flush', () => {
            it('drains the queue into a single beacon request', () => {
                logs.captureLog({ body: 'unload 1' })
                logs.captureLog({ body: 'unload 2' })

                logs.flushLogs('sendBeacon')

                const call = send.mock.calls.at(-1)![1]!
                expect(call.transport).toBe('sendBeacon')
                expect((call.body as any).resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(2)
                expect((logs as any)._queue).toHaveLength(0)

                // The beacon path builds resource attributes itself; confirm it matches
                // the core path (default service.name + SDK telemetry keys).
                const attrs = Object.fromEntries(
                    (call.body as any).resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
                )
                expect(attrs['service.name']).toEqual({ stringValue: 'unknown_service' })
                expect(attrs['telemetry.sdk.name']).toEqual({ stringValue: expect.any(String) })
                expect(attrs['telemetry.sdk.version']).toEqual({ stringValue: expect.any(String) })
                // session.id was a resource attr in the OTel implementation; it is
                // now a per-record attr (sessionId). Guard against regression.
                expect(attrs['session.id']).toBeUndefined()
            })

            it('does nothing when the queue is empty', () => {
                logs.flushLogs('sendBeacon')

                expect(send).not.toHaveBeenCalled()
            })
        })

        describe('console recorder', () => {
            const buildClientWithPersistedHint = () => {
                const client = newClient()
                client.kv.set(CAPTURE_HINT_KEY, true)
                return client
            }

            const remoteConfigResult = (captureConsoleLogs: boolean) => ({
                ok: true as const,
                config: {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar' as const,
                    isAuthenticated: false,
                    siteApps: [],
                    logs: { captureConsoleLogs },
                },
            })

            let logsFromPersisted: PostHogLogs
            // The global test setup makes real console methods throw, and the
            // recorder passes every call through to them. Swap in inert stubs
            // for the duration of these tests, then restore the setup versions.
            const RECORDER_LEVELS = ['debug', 'log', 'warn', 'error', 'info'] as const
            let setupConsoleMethods: Partial<Record<(typeof RECORDER_LEVELS)[number], any>>

            beforeEach(() => {
                setupConsoleMethods = {}
                for (const level of RECORDER_LEVELS) {
                    setupConsoleMethods[level] = window.console[level]
                    window.console[level] = vi.fn()
                }
            })

            afterEach(() => {
                logsFromPersisted?.reset()
                for (const level of RECORDER_LEVELS) {
                    window.console[level] = setupConsoleMethods[level]
                }
            })

            it('should buffer console entries instead of loading when the persisted bit is set', () => {
                logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                setupLogs(logsFromPersisted)

                expect((logsFromPersisted as any)._isLogsEnabled).toBe(false)
                expect(mockLoader).not.toHaveBeenCalled()

                window.console.log('buffered message', 42)
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)
            })

            const buildClientWithLocalConfig = () => {
                config = { captureConsoleLogs: true }
                return newClient()
            }

            it('should buffer console entries when capture is enabled in local config', () => {
                // The documented way to turn console capture on. It skips the remote-config
                // wait but still has to wait for the logs script, so it gets a recorder too.
                mockLoader.mockImplementation(() => {})
                logsFromPersisted = makeLogs(buildClientWithLocalConfig())
                setupLogs(logsFromPersisted)

                expect((logsFromPersisted as any)._isRecordingConsole).toBe(true)
                window.console.log('before the script lands')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)
            })

            it('should keep a locally-configured buffer when the remote config request fails', () => {
                let finishLoad: Parameters<ConsoleLogsLoader>[0] = () => {}
                mockLoader.mockImplementation((cb) => {
                    finishLoad = cb
                })
                logsFromPersisted = makeLogs(buildClientWithLocalConfig())
                setupLogs(logsFromPersisted)
                window.console.log('kept')

                logsFromPersisted.onRemoteConfig({ ok: false } as any)
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)

                finishLoad(undefined, { initialize: mockInitializeLogs, replay: mockReplayConsoleBuffer })
                expect(mockReplayConsoleBuffer).toHaveBeenCalledWith(expect.anything(), [
                    expect.objectContaining({ args: ['kept'] }),
                ])
            })

            it('should record console calls made while the script loads after a first remote enable', () => {
                // First visit: nothing local, nothing persisted, so `setup` starts no
                // recorder. The remote `true` is the first thing that enables capture, and
                // the script it kicks off does not land in the same tick.
                let finishLoad: Parameters<ConsoleLogsLoader>[0] = () => {}
                mockLoader.mockImplementation((cb) => {
                    finishLoad = cb
                })
                logsFromPersisted = makeLogs(testClient)
                setupLogs(logsFromPersisted)
                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)

                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))
                window.console.log('during the load')

                finishLoad(undefined, { initialize: mockInitializeLogs, replay: mockReplayConsoleBuffer })
                expect(mockReplayConsoleBuffer).toHaveBeenCalledWith(expect.anything(), [
                    expect.objectContaining({ args: ['during the load'] }),
                ])
            })

            it('should not start a recorder once the script is capturing live', () => {
                // A later remote-config callback must not re-patch `console` behind the
                // entrypoint: `loadIfEnabled` is done, so nothing would ever collect that
                // buffer and it would pin argument graphs until the max-age backstop.
                logsFromPersisted = makeLogs(buildClientWithLocalConfig())
                setupLogs(logsFromPersisted)
                expect((logsFromPersisted as any)._isLoaded).toBe(true)
                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)

                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))

                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
            })

            it('should load the logs script once when local and remote config both enable capture', () => {
                // Every caller gets its own load callback, so a second in-flight load
                // would have the entrypoint wrap console twice.
                mockLoader.mockImplementation(() => {})
                logsFromPersisted = makeLogs(buildClientWithLocalConfig())
                setupLogs(logsFromPersisted)

                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))

                expect(mockLoader).toHaveBeenCalledTimes(1)
            })

            it('should not buffer a console call made with no arguments', () => {
                logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                setupLogs(logsFromPersisted)

                window.console.log()
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)

                window.console.log('real')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)
            })

            it('should stop buffering when the recorder cannot be unpatched from the console chain', () => {
                // `patch` gives up when a non-layer wrapper closed over us directly, so the
                // recorder stays in the call path and the flag is what stops it recording.
                logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                setupLogs(logsFromPersisted)
                const recorder = window.console.log
                window.console.log = ((...args: any[]) => (recorder as any)(...args)) as any

                logsFromPersisted.onRemoteConfig(remoteConfigResult(false))

                window.console.log('after a failed unpatch')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
            })

            it('should drop the buffer and unpatch console when the user opts out mid-window', () => {
                const instance = buildClientWithPersistedHint()
                logsFromPersisted = makeLogs(instance)
                const originalLog = window.console.log
                setupLogs(logsFromPersisted)

                window.console.log('before opt out')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)
                instance.canCapture = false

                window.console.log('after opt out')

                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect(window.console.log).toBe(originalLog)
            })

            it('should drop console records already captured when the user opts out', () => {
                const instance = buildClientWithLocalConfig()
                logsFromPersisted = makeLogs(instance)
                setupLogs(logsFromPersisted)
                logsFromPersisted.captureLog({ body: 'programmatic' })
                logsFromPersisted.captureConsoleLog({ body: 'mirrored before the opt-out' })
                expect((logsFromPersisted as any)._consoleQueue).toHaveLength(1)
                instance.canCapture = false

                logsFromPersisted._onOptOut()

                expect((logsFromPersisted as any)._consoleQueue).toHaveLength(0)
                expect((logsFromPersisted as any)._queue).toHaveLength(1)

                logsFromPersisted.captureConsoleLog({ body: 'after the opt-out' })
                expect((logsFromPersisted as any)._consoleQueue).toHaveLength(0)
            })

            it('should drop the buffer as soon as the user opts out, not on the next log line', () => {
                const instance = buildClientWithPersistedHint()
                logsFromPersisted = makeLogs(instance)
                const originalLog = window.console.log
                setupLogs(logsFromPersisted)

                window.console.log('before opt out')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)

                logsFromPersisted._onOptOut()

                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect(window.console.log).toBe(originalLog)
            })

            it('should not leave a recorder patched over the entrypoint when remote config replays synchronously', () => {
                const replayingClient = () =>
                    ({
                        onRemoteConfig: (handler: (result: any) => void) => {
                            handler(remoteConfigResult(true))
                            return { dispose: vi.fn() }
                        },
                    }) satisfies Partial<Client>
                logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                const originalLog = window.console.log

                setupLogs(logsFromPersisted, replayingClient())

                expect(mockInitializeLogs).toHaveBeenCalledTimes(1)
                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect(window.console.log).toBe(originalLog)
            })

            it('should unpatch console and drop the buffer on dispose', () => {
                logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                const originalLog = window.console.log
                setupLogs(logsFromPersisted)

                window.console.log('held')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)

                logsFromPersisted.dispose()

                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect(window.console.log).toBe(originalLog)
            })

            it('should stop a hint-only recorder when the response carries no logs key', () => {
                logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                const originalLog = window.console.log
                setupLogs(logsFromPersisted)

                window.console.log('held on the hint alone')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)

                logsFromPersisted.onRemoteConfig({
                    ok: true,
                    config: { ...remoteConfigResult(true).config, logs: undefined },
                } as any)

                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
                expect(window.console.log).toBe(originalLog)
            })

            it.each([
                { label: 'the response carries no logs key', result: { ok: true, config: { logs: undefined } } },
                {
                    label: 'the server reports capture disabled',
                    result: { ok: true, config: { logs: { captureConsoleLogs: false } } },
                },
            ])('should keep a locally-configured recorder when $label', ({ result }) => {
                mockLoader.mockImplementation(() => {})
                logsFromPersisted = makeLogs(buildClientWithLocalConfig())
                setupLogs(logsFromPersisted)
                window.console.log('kept')

                logsFromPersisted.onRemoteConfig(result as any)

                expect((logsFromPersisted as any)._isLogsEnabled).toBe(true)
                expect((logsFromPersisted as any)._isRecordingConsole).toBe(true)
                window.console.log('still captured')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(2)
            })

            it('should not patch console when the server last said no', () => {
                const instance = newClient()
                instance.kv.set(CAPTURE_HINT_KEY, false)
                logsFromPersisted = makeLogs(instance)
                const originalLog = window.console.log

                setupLogs(logsFromPersisted)

                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect(window.console.log).toBe(originalLog)
            })

            it('should not patch console when the persisted bit is absent', () => {
                const originalLog = window.console.log

                expect(window.console.log).toBe(originalLog)
                expect((logs as any)._isRecordingConsole).toBe(false)
            })

            it('should hand raw buffered entries to the entrypoint and unpatch console when remote config enables logs', () => {
                logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                const originalLog = window.console.log
                setupLogs(logsFromPersisted)

                const payload = { a: 1 }
                window.console.log('hello', payload)

                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))

                expect(mockLoader).toHaveBeenCalled()
                expect(mockInitializeLogs).toHaveBeenCalled()
                expect(window.console.log).toBe(originalLog)
                expect(mockReplayConsoleBuffer).toHaveBeenCalledWith(expect.anything(), [
                    expect.objectContaining({
                        level: 'log',
                        args: ['hello', payload],
                        occurredAtMs: expect.any(Number),
                        context: expect.any(Object),
                    }),
                ])
            })

            it('should keep recording until the entrypoint has initialized', () => {
                logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                setupLogs(logsFromPersisted)

                window.console.log('before config')

                mockLoader.mockImplementationOnce((callback) => {
                    window.console.log('while script loads')
                    callback(undefined, { initialize: mockInitializeLogs, replay: mockReplayConsoleBuffer })
                })
                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))

                const entries = mockReplayConsoleBuffer.mock.calls[0]![1]
                expect(entries.map((e: any) => e.args[0])).toEqual(['before config', 'while script loads'])
            })

            it('should stop the recorder and drop the buffer when the logs script fails to load', () => {
                logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                const originalLog = window.console.log
                setupLogs(logsFromPersisted)

                window.console.log('lost to a failed script load')

                mockLoader.mockImplementationOnce((callback) => {
                    callback(new Error('load failed'))
                })
                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))

                expect(mockReplayConsoleBuffer).not.toHaveBeenCalled()
                expect(window.console.log).toBe(originalLog)
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
            })

            it('should keep a hint-started buffer once remote config has granted capture', () => {
                // Session recording asks for a fresh remote config of its own when its
                // persisted copy is stale, so a second result — including a failed fetch —
                // can land while the logs script is still loading. The grant already
                // happened and the handover is coming, so the buffer has to survive it.
                let finish: Parameters<ConsoleLogsLoader>[0] = () => {}
                mockLoader.mockImplementation((cb) => {
                    finish = cb
                })
                logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                setupLogs(logsFromPersisted)
                window.console.info('early')

                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))
                logsFromPersisted.onRemoteConfig({ ok: false } as any)
                finish(undefined, { initialize: mockInitializeLogs, replay: mockReplayConsoleBuffer })

                expect(mockReplayConsoleBuffer).toHaveBeenCalledWith(expect.anything(), [
                    expect.objectContaining({ args: ['early'] }),
                ])
            })

            it('should replay the buffer when remote config flips to false after granting capture', () => {
                // `false` does not stop the load it already started, so the entrypoint
                // captures live either way. Dropping just the early lines would be the one
                // inconsistent outcome.
                let finish: Parameters<ConsoleLogsLoader>[0] = () => {}
                mockLoader.mockImplementation((cb) => {
                    finish = cb
                })
                logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                setupLogs(logsFromPersisted)
                window.console.info('early')

                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))
                logsFromPersisted.onRemoteConfig(remoteConfigResult(false))
                finish(undefined, { initialize: mockInitializeLogs, replay: mockReplayConsoleBuffer })

                expect(mockInitializeLogs).toHaveBeenCalled()
                expect(mockReplayConsoleBuffer).toHaveBeenCalledWith(expect.anything(), [
                    expect.objectContaining({ args: ['early'] }),
                ])
            })

            it('should drop the buffer and restore console when remote config disables logs', () => {
                logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                const originalInfo = window.console.info
                setupLogs(logsFromPersisted)

                window.console.info('never sent')

                logsFromPersisted.onRemoteConfig(remoteConfigResult(false))

                expect(window.console.info).toBe(originalInfo)
                expect(mockReplayConsoleBuffer).not.toHaveBeenCalled()
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
                expect(mockLoader).not.toHaveBeenCalled()
            })

            it('should not buffer when the user has opted out', () => {
                const instance = buildClientWithPersistedHint()
                instance.canCapture = false
                logsFromPersisted = makeLogs(instance)
                setupLogs(logsFromPersisted)

                window.console.log('opted out')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
            })

            it('should stop the recorder after the max age passes with no resolution', () => {
                vi.useFakeTimers()
                try {
                    logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                    const originalLog = window.console.log
                    setupLogs(logsFromPersisted)

                    window.console.log('held too long')
                    vi.advanceTimersByTime(RECORDER_MAX_AGE_MS)

                    expect(window.console.log).toBe(originalLog)
                    expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
                    expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                } finally {
                    vi.useRealTimers()
                }
            })

            it('should stop recording and drop the buffer when remote config fails', () => {
                logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                const originalLog = window.console.log
                setupLogs(logsFromPersisted)

                window.console.log('lost to a failed config fetch')

                logsFromPersisted.onRemoteConfig({ ok: false } as any)

                expect(window.console.log).toBe(originalLog)
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
            })

            it('should not buffer a console call made while snapshotting the context', () => {
                const instance = buildClientWithPersistedHint()
                let nested = 0
                Object.defineProperty(instance, 'session', {
                    get: () => {
                        if (nested++ < 3) window.console.error('from inside the capture path')
                        return { sessionId: 's', windowId: 'w', sessionStartTimestamp: 0, lastActivityTimestamp: 0 }
                    },
                })
                logsFromPersisted = makeLogs(instance)
                setupLogs(logsFromPersisted)

                window.console.log('outer')

                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)
            })

            it('should drop the buffer and unpatch console when the SDK is reset mid-buffer', () => {
                logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                const originalLog = window.console.log
                setupLogs(logsFromPersisted)

                window.console.log('before reset')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)

                logsFromPersisted.reset()

                expect(window.console.log).toBe(originalLog)
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
            })

            it('should reach the real console method through an existing console wrapper', () => {
                // A console already wrapped by another plugin must still be restorable.
                const realLog = window.console.log
                const foreign = (...args: any[]) => (realLog as any)(...args)
                ;(foreign as any).__rrweb_original__ = realLog
                window.console.log = foreign as any

                logsFromPersisted = makeLogs(buildClientWithPersistedHint())
                setupLogs(logsFromPersisted)

                expect((window.console.log as any).__rrweb_original__).toBe(realLog)

                logsFromPersisted.onRemoteConfig(remoteConfigResult(false))
                expect(window.console.log).toBe(foreign)
            })

            it('should cap the console buffer at the configured max size', () => {
                const instance = buildClientWithPersistedHint()
                config = { maxBufferSize: 3 }
                logsFromPersisted = makeLogs(instance)
                setupLogs(logsFromPersisted)

                for (let i = 0; i < 10; i++) {
                    window.console.info('entry', i)
                }
                // Earliest calls are kept: they are the ones the live path would miss.
                expect((logsFromPersisted as any)._consoleBuffer.map((e: any) => e.args[1])).toEqual([0, 1, 2])
            })
        })

        describe('console capture instance', () => {
            beforeEach(() => {
                vi.useFakeTimers()
            })

            it('does not drop records captured after a reset mid-flush', async () => {
                let releaseSend: (r: any) => void = () => {}
                send.mockImplementation(
                    () =>
                        new Promise((resolve) => {
                            releaseSend = resolve
                        })
                )
                logs.captureConsoleLog({ body: 'before the reset' })
                vi.advanceTimersByTime(3000)
                expect(send).toHaveBeenCalled()

                logs.reset()
                logs.captureConsoleLog({ body: 'after the reset' })

                releaseSend({ statusCode: 200 })
                await Promise.resolve()
                await Promise.resolve()

                expect((logs as any)._consoleQueue.map((e: any) => e.record.body.stringValue)).toEqual([
                    'after the reset',
                ])
            })

            it('does not drop records captured after opting back in mid-flush', async () => {
                let releaseSend: (r: any) => void = () => {}
                send.mockImplementation(
                    () =>
                        new Promise((resolve) => {
                            releaseSend = resolve
                        })
                )
                logs.captureConsoleLog({ body: 'before the opt-out' })
                vi.advanceTimersByTime(3000)
                expect(send).toHaveBeenCalled()

                logs._onOptOut()
                logs.captureConsoleLog({ body: 'after opting back in' })

                releaseSend({ statusCode: 200 })
                await Promise.resolve()
                await Promise.resolve()

                expect((logs as any)._consoleQueue.map((e: any) => e.record.body.stringValue)).toEqual([
                    'after opting back in',
                ])
            })

            it('stamps a replayed console record from the buffered snapshot, not live state', () => {
                logs.captureBufferedConsoleLog(
                    { body: 'early line' },
                    { distinctId: 'anon-before-identify', sessionId: 'session-before-roll' },
                    1700000000000
                )
                vi.advanceTimersByTime(3000)

                const call = send.mock.calls.at(-1)![1]!
                const record = (call.body as any).resourceLogs[0].scopeLogs[0].logRecords[0]
                const attrs = Object.fromEntries(record.attributes.map((a: any) => [a.key, a.value]))

                expect(record.timeUnixNano).toBe('1700000000000000000')
                expect(record.observedTimeUnixNano).toBe(record.timeUnixNano)
                expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'anon-before-identify' })
                expect(attrs['sessionId']).toEqual({ stringValue: 'session-before-roll' })
            })

            afterEach(() => {
                vi.useRealTimers()
            })

            it('buffers console captures on a separate queue from programmatic logs', () => {
                logs.captureLog({ body: 'programmatic' })
                logs.captureConsoleLog({ body: 'console' })

                expect((logs as any)._queue).toHaveLength(1)
                expect((logs as any)._consoleQueue).toHaveLength(1)
                expect((logs as any)._queue[0].record.body.stringValue).toBe('programmatic')
                expect((logs as any)._consoleQueue[0].record.body.stringValue).toBe('console')
            })

            it('flushes console captures with service.name posthog-browser-logs', () => {
                logs.captureConsoleLog({ body: 'console' })
                vi.advanceTimersByTime(3000)

                const call = send.mock.calls.at(-1)![1]!
                const attrs = Object.fromEntries(
                    (call.body as any).resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
                )
                expect(attrs['service.name']).toEqual({ stringValue: 'posthog-browser-logs' })
            })

            it('flushes console captures under the OTel-parity scope name "console"', () => {
                logs.captureConsoleLog({ body: 'console' })
                vi.advanceTimersByTime(3000)

                const call = send.mock.calls.at(-1)![1]!
                // Scope name labels the console stream...
                expect((call.body as any).resourceLogs[0].scopeLogs[0].scope.name).toBe('console')
                // ...but telemetry.sdk.name stays the SDK id, not the scope.
                const attrs = Object.fromEntries(
                    (call.body as any).resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
                )
                expect(attrs['telemetry.sdk.name']).toEqual({ stringValue: 'test-sdk' })
            })

            it('flushes programmatic captures under the SDK scope name (not "console")', () => {
                logs.captureLog({ body: 'programmatic' })
                vi.advanceTimersByTime(3000)

                const call = send.mock.calls.at(-1)![1]!
                expect((call.body as any).resourceLogs[0].scopeLogs[0].scope.name).toBe('test-sdk')
            })

            it('emits standard OTLP severity (text + number) on console records', () => {
                logs.captureConsoleLog({ body: 'uh oh', level: 'warn' })
                logs.captureConsoleLog({ body: 'boom', level: 'error' })
                vi.advanceTimersByTime(3000)

                const records = (send.mock.calls.at(-1)![1]!.body as any).resourceLogs[0].scopeLogs[0].logRecords
                expect(records[0]).toMatchObject({ severityText: 'WARN', severityNumber: 13 })
                expect(records[1]).toMatchObject({ severityText: 'ERROR', severityNumber: 17 })
            })

            it('lets a user-set serviceName win over the console default', () => {
                config = { serviceName: 'my-app' }
                logs = createLogs(testClient)

                logs.captureConsoleLog({ body: 'console' })
                vi.advanceTimersByTime(3000)

                const call = send.mock.calls.at(-1)![1]!
                const attrs = Object.fromEntries(
                    (call.body as any).resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
                )
                expect(attrs['service.name']).toEqual({ stringValue: 'my-app' })
            })

            it('drains both queues on a sendBeacon flush, each with its own service.name', () => {
                logs.captureLog({ body: 'programmatic' })
                logs.captureConsoleLog({ body: 'console' })

                logs.flushLogs('sendBeacon')

                const calls = send.mock.calls
                const serviceNames = calls.map((c: any[]) => {
                    const attrs = Object.fromEntries(
                        c[1].body.resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
                    )
                    return attrs['service.name'].stringValue
                })
                expect(serviceNames).toEqual(expect.arrayContaining(['unknown_service', 'posthog-browser-logs']))
                expect((logs as any)._queue).toHaveLength(0)
                expect((logs as any)._consoleQueue).toHaveLength(0)
            })

            it('does not touch the console queue on sendBeacon when no console core was built', () => {
                logs.captureLog({ body: 'programmatic' })

                logs.flushLogs('sendBeacon')

                expect(send).toHaveBeenCalledTimes(1)
            })

            it('clears both queues on reset', () => {
                logs.captureLog({ body: 'programmatic' })
                logs.captureConsoleLog({ body: 'console' })

                logs.reset()

                expect((logs as any)._queue).toHaveLength(0)
                expect((logs as any)._consoleQueue).toHaveLength(0)
            })

            it('does not rate-cap console captures, even when the user set a low maxLogsPerInterval', () => {
                // A user-set rate cap must not silently drop console logs (which were
                // uncapped before). Hold the flush open so capture outpaces drain and
                // push well past both the user cap (50) and the default (1000); the
                // console instance retains everything up to the eviction backstop (2048).
                config = { captureConsoleLogs: true, maxLogsPerInterval: 50 }
                logs = createLogs(testClient)
                send.mockImplementation(() => new Promise(() => {}))

                for (let i = 0; i < 1500; i++) {
                    logs.captureConsoleLog({ body: `console ${i}` })
                }

                expect((logs as any)._consoleQueue).toHaveLength(1500)
            })
        })

        describe('reconnect', () => {
            it('flushes queued logs when the browser comes back online', () => {
                logs.captureLog({ body: 'queued while offline' })
                expect((logs as any)._queue).toHaveLength(1)
                expect(send).not.toHaveBeenCalled()

                window.dispatchEvent(new Event('online'))

                expect(send).toHaveBeenCalledTimes(1)
            })

            it('flushes queued console logs when the browser comes back online', () => {
                logs.captureConsoleLog({ body: 'console queued while offline' })
                expect((logs as any)._consoleQueue).toHaveLength(1)
                expect(send).not.toHaveBeenCalled()

                window.dispatchEvent(new Event('online'))

                expect(send).toHaveBeenCalledTimes(1)
            })
        })

        describe('flush outcome handling', () => {
            beforeEach(() => {
                vi.useFakeTimers()
            })

            afterEach(() => {
                vi.useRealTimers()
            })

            const flushWith = async (statusCode: number) => {
                send.mockResolvedValue({ statusCode })
                logs.captureLog({ body: 'x' })
                // core.flush() rejects on a retry-later/fatal outcome; swallow so we can assert queue state.
                await (logs as any)._core.flush().catch(() => {})
            }

            it('clears the queue on a 2xx response', async () => {
                await flushWith(200)
                expect((logs as any)._queue).toHaveLength(0)
            })

            it('keeps records on a 429 so they retry later', async () => {
                await flushWith(429)
                expect((logs as any)._queue).toHaveLength(1)
            })

            it('keeps records on a 5xx so they retry later', async () => {
                await flushWith(503)
                expect((logs as any)._queue).toHaveLength(1)
            })

            it('keeps records on a 408 so they retry later', async () => {
                await flushWith(408)
                expect((logs as any)._queue).toHaveLength(1)
            })

            it('drops records on a 4xx client error', async () => {
                await flushWith(400)
                expect((logs as any)._queue).toHaveLength(0)
            })

            it('settles as retry-later (keeps records) when sendRequest never settles', async () => {
                // A transport that never settles must not wedge all future flushes.
                send.mockImplementation(() => new Promise(() => {}))
                logs.captureLog({ body: 'x' })

                const flushPromise = (logs as any)._core.flush().catch(() => {})
                let settled = false
                void flushPromise.then(() => {
                    settled = true
                })

                // The promise must stay pending until the 90s backstop fires, so a
                // queue length of 1 here can't be confused with "no flush ran at all".
                await vi.advanceTimersByTimeAsync(89000)
                expect(settled).toBe(false)
                await vi.advanceTimersByTimeAsync(2000)
                await flushPromise
                expect(settled).toBe(true)

                expect((logs as any)._queue).toHaveLength(1)
            })

            it('keeps records after a timer-driven flush hits a 429', async () => {
                // Drives the real timer-expiry path (not _core.flush() directly) to
                // confirm a transient response requeues end to end.
                send.mockResolvedValue({ statusCode: 429 })
                logs.captureLog({ body: 'x' })
                mockLogger.error.mockClear()

                await vi.advanceTimersByTimeAsync(3000)

                expect((logs as any)._queue).toHaveLength(1)
                expect(mockLogger.error).toHaveBeenCalledWith(
                    'PostHog logs flush failed:',
                    expect.objectContaining({ message: 'logs request failed with status 429' })
                )
            })

            it('does not re-log timer-driven transport failures handled by the request layer', async () => {
                send.mockResolvedValue({ statusCode: 0, error: new TypeError('Failed to fetch') })
                logs.captureLog({ body: 'x' })
                mockLogger.warn.mockClear()
                mockLogger.error.mockClear()

                await vi.advanceTimersByTimeAsync(3000)

                expect((logs as any)._queue).toHaveLength(1)
                expect(mockLogger.warn).not.toHaveBeenCalled()
                expect(mockLogger.error).not.toHaveBeenCalled()
            })

            it('warns once for a bare status-zero logs response', async () => {
                send.mockResolvedValue({ statusCode: 0 })
                logs.captureLog({ body: 'x' })
                mockLogger.warn.mockClear()
                mockLogger.error.mockClear()

                await vi.advanceTimersByTimeAsync(3000)

                expect(mockLogger.warn).toHaveBeenCalledTimes(1)
                expect(mockLogger.warn).toHaveBeenCalledWith('Logs request failed before receiving an HTTP response')
                expect(mockLogger.error).not.toHaveBeenCalled()
            })

            it.each([400, 500])('keeps HTTP status %s at error severity', async (statusCode) => {
                send.mockResolvedValue({ statusCode })
                logs.captureLog({ body: 'x' })
                mockLogger.error.mockClear()

                await vi.advanceTimersByTimeAsync(3000)

                expect(mockLogger.error).toHaveBeenCalledWith(
                    'PostHog logs flush failed:',
                    expect.objectContaining({ message: `logs request failed with status ${statusCode}` })
                )
            })

            it('does not re-log handled failures from an explicit flush', async () => {
                send.mockResolvedValue({ statusCode: 0, error: new TypeError('Failed to fetch') })
                logs.captureLog({ body: 'x' })
                mockLogger.error.mockClear()

                logs.flushLogs()
                const flushPromise = (logs as any)._core._flushPromise as Promise<void>
                await flushPromise.catch(() => {})
                await Promise.resolve()

                expect(mockLogger.error).not.toHaveBeenCalled()
            })

            it('logs unhandled failures from an explicit flush', async () => {
                const error = { statusCode: 500 }
                const flush = vi.fn().mockRejectedValue(error)
                const core = (logs as any)._core
                ;(logs as any)._core = { flush }
                mockLogger.error.mockClear()

                try {
                    logs.flushLogs()
                    await flush.mock.results[0]!.value.catch(() => {})
                    await Promise.resolve()

                    expect(mockLogger.error).toHaveBeenCalledWith('PostHog logs flush failed:', error)
                } finally {
                    ;(logs as any)._core = core
                }
            })
        })

        describe('status 0 circuit breaker', () => {
            beforeEach(() => {
                vi.useFakeTimers()
            })

            afterEach(() => {
                vi.useRealTimers()
                delete (window.navigator as any).onLine
            })

            const flushWith = async (statusCode: number) => {
                send.mockResolvedValue({ statusCode })
                logs.captureLog({ body: 'x' })
                await (logs as any)._core.flush().catch(() => {})
            }

            const sendCount = () => send.mock.calls.length

            const setOnline = (value: boolean) => {
                Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
            }

            it.each([1, 2])('still attempts the network after %i consecutive status-0 failures', async (failures) => {
                for (let i = 0; i < failures; i++) {
                    await flushWith(0)
                }

                await flushWith(0)

                expect(sendCount()).toBe(failures + 1)
            })

            it('stops sending and drops the batch after 3 consecutive status-0 failures', async () => {
                for (let i = 0; i < 3; i++) {
                    await flushWith(0)
                }
                expect(sendCount()).toBe(3)
                expect((logs as any)._queue).toHaveLength(3)

                await flushWith(0)

                expect(sendCount()).toBe(3)
                expect((logs as any)._queue).toHaveLength(0)
            })

            it.each([200, 429, 503])(
                'a %i response resets the count — any HTTP response proves the endpoint is reachable',
                async (statusCode) => {
                    await flushWith(0)
                    await flushWith(0)
                    await flushWith(statusCode)
                    await flushWith(0)
                    await flushWith(0)

                    await flushWith(0)

                    expect(sendCount()).toBe(6)
                }
            )

            it('does not count status-0 failures while the browser reports itself offline', async () => {
                setOnline(false)
                for (let i = 0; i < 3; i++) {
                    await flushWith(0)
                }
                setOnline(true)

                await flushWith(0)

                expect(sendCount()).toBe(4)
            })

            it('queues (retry-later) instead of dropping when the breaker is tripped but the browser is offline', async () => {
                // Trip the breaker (3 status-0 failures while online).
                for (let i = 0; i < 3; i++) {
                    await flushWith(0)
                }
                const countAfterTrip = sendCount()
                expect(countAfterTrip).toBe(3) // breaker tripped after 3

                // Go offline — the online guard should bypass the fatal-drop short-circuit.
                setOnline(false)

                // Capture + flush with status 0 while tripped AND offline.
                // The send MUST be attempted (online guard lifts the short-circuit).
                await flushWith(0)
                expect(sendCount()).toBe(countAfterTrip + 1) // request was made

                // The batch MUST be retained (offline => retry-later, not fatal).
                expect((logs as any)._queue).toHaveLength(4)

                // Restore online — reconnect flush delivers the retained records.
                setOnline(true)
                send.mockResolvedValue({ statusCode: 200 })
                window.dispatchEvent(new Event('online'))
                expect(sendCount()).toBe(countAfterTrip + 2)
            })

            it('reopens on the online event so recovery is possible', async () => {
                for (let i = 0; i < 4; i++) {
                    await flushWith(0)
                }
                expect(sendCount()).toBe(3) // tripped: the 4th flush made no request

                logs.captureLog({ body: 'after whitelist' })
                window.dispatchEvent(new Event('online'))

                expect(sendCount()).toBe(4)
            })

            it('counter resets to 0 on reconnect — needs 3 fresh failures to trip again', async () => {
                // Trip the breaker (3 failures then 1 dropped).
                for (let i = 0; i < 3; i++) {
                    await flushWith(0)
                }
                expect(sendCount()).toBe(3)
                await flushWith(0)
                expect(sendCount()).toBe(3) // still 3 — the 4th was dropped

                // Reset the breaker via the online event.
                window.dispatchEvent(new Event('online'))

                // Verify the counter was actually reset to 0.
                expect((logs as any)._consecutiveStatusZeroFailures).toBe(0)

                // The online event schedules a reconnect flush (empty queue, no send).
                // The first flushWith after online resolves that lingering flush promise,
                // so the second and third explicit flushes are the real first two failures.
                await flushWith(0) // drains lingering online-reconnect flush promise
                await flushWith(0) // failure 1
                await flushWith(0) // failure 2
                expect((logs as any)._consecutiveStatusZeroFailures).toBe(2)

                // Third failure: re-trips (counter=3), still sends on this flush.
                await flushWith(0)
                const countWhenRetripped = sendCount()
                expect((logs as any)._consecutiveStatusZeroFailures).toBe(3)

                // Fourth failure post-reset: breaker is tripped — dropped, no send.
                await flushWith(0)
                expect(sendCount()).toBe(countWhenRetripped) // no new send
            })

            it('reset clears the tripped breaker so future sends can recover immediately', async () => {
                for (let i = 0; i < 3; i++) {
                    await flushWith(0)
                }
                await flushWith(0)
                expect(sendCount()).toBe(3) // tripped: the 4th flush made no request

                logs.reset()

                expect((logs as any)._consecutiveStatusZeroFailures).toBe(0)

                await flushWith(0)

                expect(sendCount()).toBe(4)
            })

            it('one tripped breaker silences the console queue too — both cores share the endpoint', async () => {
                for (let i = 0; i < 3; i++) {
                    await flushWith(0)
                }

                logs.captureConsoleLog({ body: 'console x' })
                await (logs as any)._consoleCore.flush().catch(() => {})

                expect(sendCount()).toBe(3)
                expect((logs as any)._consoleQueue).toHaveLength(0)
            })

            it('warns once when it stops sending', async () => {
                for (let i = 0; i < 4; i++) {
                    await flushWith(0)
                }

                const breakerWarnings = mockLogger.warn.mock.calls.filter(([msg]) =>
                    String(msg).includes('ad blockers')
                )
                expect(breakerWarnings).toHaveLength(1)
            })

            it('does not count the send-timeout backstop toward the status-0 trip', async () => {
                send.mockImplementation(() => new Promise(() => {}))
                for (let i = 0; i < 3; i++) {
                    logs.captureLog({ body: 'x' })
                    const flushPromise = (logs as any)._core.flush().catch(() => {})
                    await vi.advanceTimersByTimeAsync(91000)
                    await flushPromise
                }
                expect(sendCount()).toBe(3)

                await flushWith(0)

                expect(sendCount()).toBe(4)
            })
        })

        describe('live config resolution', () => {
            beforeEach(() => {
                vi.useFakeTimers()
            })

            afterEach(() => {
                vi.useRealTimers()
            })

            const beaconResourceAttrs = () =>
                Object.fromEntries(
                    (send.mock.calls.at(-1)![1]!.body as any).resourceLogs[0].resource.attributes.map((a: any) => [
                        a.key,
                        a.value,
                    ])
                )

            it('honors logs config applied after the extension is constructed', () => {
                // Config can arrive after construction; first use must read its latest value.
                config = {
                    serviceName: 'late-config',
                    maxLogsPerInterval: 2,
                    maxBufferSize: 1000,
                }

                logs.captureLog({ body: 'a' })
                logs.captureLog({ body: 'b' })
                logs.captureLog({ body: 'rate-capped' })

                // maxLogsPerInterval: 2 from the late config is honored
                expect((logs as any)._queue).toHaveLength(2)

                logs.flushLogs('sendBeacon')
                // serviceName from the late config is honored
                expect(beaconResourceAttrs()['service.name']).toEqual({ stringValue: 'late-config' })
            })

            it('picks up a replaced logs config after first use', () => {
                logs.captureLog({ body: 'first' })
                logs.flushLogs('sendBeacon')
                expect(beaconResourceAttrs()['service.name']).toEqual({ stringValue: 'unknown_service' })

                // Replace the config with a new object reference.
                config = { serviceName: 'changed' }
                logs.captureLog({ body: 'second' })
                logs.flushLogs('sendBeacon')
                expect(beaconResourceAttrs()['service.name']).toEqual({ stringValue: 'changed' })
            })

            it('does not double-flush when replacing config rebuilds the core mid-buffer', async () => {
                // Defer callbacks so both a (hypothetically) orphaned timer and the
                // new core's timer would have their flushes in flight at once. The
                // rebuild must reset the old core, clearing its armed timer, so only
                // the surviving core POSTs — otherwise both read the same head of the
                // shared queue and double-send.
                const callbacks: Array<(r: any) => void> = []
                send.mockImplementation(
                    () =>
                        new Promise((resolve) => {
                            callbacks.push(resolve)
                        })
                )

                logs.captureLog({ body: 'a' }) // arms the first core's flush timer
                config = { serviceName: 'changed' }
                logs.captureLog({ body: 'b' }) // _getCore rebuilds → second core arms its timer

                await vi.advanceTimersByTimeAsync(3000)

                expect(send).toHaveBeenCalledTimes(1)

                // Resolve the in-flight send: the queue drains exactly once.
                callbacks.forEach((cb) => cb({ statusCode: 200 }))
                await vi.advanceTimersByTimeAsync(0)
                expect((logs as any)._queue).toHaveLength(0)
            })

            it('does not double-flush the console queue when replacing config rebuilds the console core', async () => {
                // Same invariant as above, for the console core: a config swap must reset
                // the old console core so its armed timer can't double-send the shared
                // `_consoleQueue`.
                const callbacks: Array<(r: any) => void> = []
                send.mockImplementation(
                    () =>
                        new Promise((resolve) => {
                            callbacks.push(resolve)
                        })
                )

                logs.captureConsoleLog({ body: 'a' }) // arms the first console core's timer
                config = { captureConsoleLogs: true, serviceName: 'changed' }
                logs.captureConsoleLog({ body: 'b' }) // _getConsoleCore rebuilds → new timer

                await vi.advanceTimersByTimeAsync(3000)

                expect(send).toHaveBeenCalledTimes(1)

                callbacks.forEach((cb) => cb({ statusCode: 200 }))
                await vi.advanceTimersByTimeAsync(0)
                expect((logs as any)._consoleQueue).toHaveLength(0)
            })
        })

        describe('reset with captureLog', () => {
            beforeEach(() => {
                vi.useFakeTimers()
            })

            afterEach(() => {
                vi.useRealTimers()
            })

            it('should clear the buffer and cancel pending flush', () => {
                logs.captureLog({ body: 'log 1' })
                logs.captureLog({ body: 'log 2' })
                expect((logs as any)._queue).toHaveLength(2)

                logs.reset()

                expect((logs as any)._queue).toHaveLength(0)

                // Advancing time should not trigger a flush
                vi.advanceTimersByTime(5000)
                expect(send).not.toHaveBeenCalled()
            })
        })

        describe('state management', () => {
            it('should maintain _isLogsEnabled state correctly', () => {
                expect((logs as any)._isLogsEnabled).toBeFalsy()
                expect((logs as any)._isLoaded).toBeFalsy()

                const baseConfig = {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar' as const,
                    isAuthenticated: false,
                    siteApps: [],
                }
                logs.onRemoteConfig({ ok: true, config: { ...baseConfig, logs: { captureConsoleLogs: true } } })
                expect((logs as any)._isLogsEnabled).toBe(true)
                expect((logs as any)._isLoaded).toBe(true)

                logs.reset()
                expect((logs as any)._isLogsEnabled).toBe(true) // reset doesn't change logs state
                expect((logs as any)._isLoaded).toBe(true) // reset doesn't change logs state

                // Create new instance
                const newLogs = createLogs(testClient)
                expect((newLogs as any)._isLogsEnabled).toBeFalsy()
            })

            it('should handle repeated onRemoteConfig calls correctly', () => {
                const baseConfig = {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar' as const,
                    isAuthenticated: false,
                    siteApps: [],
                }

                logs.onRemoteConfig({ ok: true, config: { ...baseConfig, logs: { captureConsoleLogs: false } } })
                expect(mockLoader).toHaveBeenCalledTimes(0)

                logs.onRemoteConfig({ ok: true, config: { ...baseConfig, logs: { captureConsoleLogs: true } } })
                expect(mockLoader).toHaveBeenCalledTimes(1)

                logs.onRemoteConfig({ ok: true, config: { ...baseConfig, logs: { captureConsoleLogs: true } } })
                expect(mockLoader).toHaveBeenCalledTimes(1)

                logs.onRemoteConfig({ ok: true, config: { ...baseConfig, logs: { captureConsoleLogs: false } } })
                expect(mockLoader).toHaveBeenCalledTimes(1)
            })
        })
    })
})
