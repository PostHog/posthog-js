import { BrowserClientAdapter } from '../extensions/browser-client'
import { createLogsClient } from './helpers/logs-client'
import type { Client } from '@posthog/browser-common'

import { PostHogLogs } from '../posthog-logs'
import { patch as rrwebPatch } from '@posthog/rrweb-utils'
import { LOGS_CAPTURE_ENABLED_SERVER_SIDE } from '../constants'
import { PostHog } from '../posthog-core'

import { assignableWindow } from '../utils/globals'

// Mock the logger to avoid console output during tests
const mockLogger = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    critical: vi.fn(),
    createLogger: vi.fn(),
}))
mockLogger.createLogger.mockImplementation(() => mockLogger)

vi.mock('@posthog/browser-common/utils/logger', () => ({
    createLogger: vi.fn(() => mockLogger),
    logger: mockLogger,
}))

function setupLogs(logs: PostHogLogs, overrides: Partial<Client> = {}): Client {
    const instance = (logs as any)._instance as PostHog
    const client = createLogsClient(instance, overrides)
    logs.setup(client)
    return client
}

function createLogs(instance: PostHog): PostHogLogs {
    const logs = new PostHogLogs(instance)
    setupLogs(logs)
    return logs
}

describe('posthog-logs', () => {
    describe('PostHogLogs Class', () => {
        let mockPostHog: PostHog
        let logs: PostHogLogs
        let mockDisposeLogs: vi.Mock
        let mockInitializeLogs: vi.Mock
        let mockReplayConsoleBuffer: vi.Mock
        let mockLoadExternalDependency: vi.Mock

        const flagsResponse = {
            featureFlags: {
                'logs-capture-enabled': true,
                'logs-capture-disabled': false,
            },
            supportedCompression: [],
            toolbarParams: {},
            toolbarVersion: 'toolbar' as const,
            isAuthenticated: false,
            siteApps: [],
            logs: { captureConsoleLogs: true },
        }

        beforeEach(() => {
            // Clear all mocks
            vi.clearAllMocks()

            // Mock window and PostHog extensions
            mockDisposeLogs = vi.fn()
            mockInitializeLogs = vi.fn(() => mockDisposeLogs)
            mockReplayConsoleBuffer = vi.fn()
            mockLoadExternalDependency = vi.fn((_instance, _name, callback) => {
                callback(null) // Simulate successful loading
            })

            // Mock assignableWindow
            Object.defineProperty(assignableWindow, '__PosthogExtensions__', {
                value: {
                    logs: { initializeLogs: mockInitializeLogs, replayConsoleBuffer: mockReplayConsoleBuffer },
                    loadExternalDependency: mockLoadExternalDependency,
                },
                writable: true,
                configurable: true,
            })

            // Create mock PostHog instance
            mockPostHog = {
                __loaded: true,
                config: {
                    disable_logs: false,
                    token: 'test-token',
                    logs_request_timeout_ms: 3000,
                },
                persistence: {
                    register: vi.fn(),
                    props: {},
                },
                requestRouter: {
                    endpointFor: vi.fn((_target, path) => `https://us.i.posthog.com${path}`),
                },
                _send_request: vi.fn((opts: any) => opts.callback?.({ statusCode: 200 })),
                get_property: vi.fn(),
                is_capturing: vi.fn(() => true),
                get_distinct_id: vi.fn(() => 'distinct-id-123'),
                sessionManager: {
                    checkAndGetSessionAndWindowId: vi.fn(() => ({
                        sessionId: 'session-abc',
                        windowId: 'window-xyz',
                        sessionStartTimestamp: 1672567200000,
                        lastActivityTimestamp: 1672569000000,
                    })),
                },
                consent: {
                    _instance: mockPostHog,
                    _config: {},
                    consent: vi.fn(),
                    isOptedIn: vi.fn(() => true),
                    isOptedOut: vi.fn(() => false),
                    hasOptedInBefore: vi.fn(() => true),
                    hasOptedOutBefore: vi.fn(() => false),
                    optInCapturing: vi.fn(),
                    optOutCapturing: vi.fn(),
                    reset: vi.fn(),
                    onConsentChange: vi.fn(),
                },
                featureFlags: {
                    _send_retriable_request: vi.fn((_url, _params, callback) => {
                        callback({ statusCode: 200, json: flagsResponse })
                    }),
                    getFeatureFlag: vi.fn((flag) => {
                        return flagsResponse.featureFlags[flag as keyof typeof flagsResponse.featureFlags]
                    }),
                    isFeatureEnabled: vi.fn((flag) => {
                        return !!flagsResponse.featureFlags[flag as keyof typeof flagsResponse.featureFlags]
                    }),
                    getFlags: vi.fn(() => ['logs-capture-enabled']),
                },
            } as unknown as PostHog

            logs = createLogs(mockPostHog)
        })

        describe('shared extension lifecycle', () => {
            it('maps callback and explicit transports without changing legacy request options', async () => {
                logs.captureLog({ body: 'callback request' })
                logs.flushLogs()
                await Promise.resolve()
                expect(mockPostHog._send_request).toHaveBeenLastCalledWith(
                    expect.objectContaining({
                        method: 'POST',
                        url: 'https://us.i.posthog.com/i/v1/logs?token=test-token',
                        data: expect.objectContaining({ resourceLogs: expect.any(Array) }),
                        compression: 'best-available',
                        batchKey: 'logs',
                        fireCallbackOnDrop: true,
                        callback: expect.any(Function),
                    })
                )
                const programmatic = (vi.mocked(mockPostHog._send_request).mock.calls[0][0].data as any).resourceLogs[0]
                expect(programmatic.scopeLogs[0].scope.name).toBe('web')
                expect(programmatic.resource.attributes).toContainEqual({
                    key: 'telemetry.sdk.name',
                    value: { stringValue: 'web' },
                })
                logs.captureLog({ body: 'unload request' })
                logs.flushLogs('sendBeacon')
                expect(mockPostHog._send_request).toHaveBeenLastCalledWith(
                    expect.objectContaining({
                        method: 'POST',
                        url: 'https://us.i.posthog.com/i/v1/logs?token=test-token',
                        data: expect.objectContaining({ resourceLogs: expect.any(Array) }),
                        compression: 'best-available',
                        batchKey: 'logs',
                        transport: 'sendBeacon',
                    })
                )
                expect(mockPostHog.requestRouter.endpointFor).toHaveBeenCalledWith('api', '/i/v1/logs?token=test-token')
                logs.dispose()
            })

            it('uses current legacy persistence, configuration and loader after construction', () => {
                const register = vi.fn()
                mockPostHog.persistence = { register, props: {} } as any
                mockPostHog.config.token = 'changed token'
                mockPostHog.config.logs = { serviceName: 'changed-service' }
                const initialize = vi.fn()
                assignableWindow.__PosthogExtensions__!.logs = { initializeLogs: initialize }
                logs.onRemoteConfig({ ok: true, config: flagsResponse })
                expect(register).toHaveBeenCalledWith({ [LOGS_CAPTURE_ENABLED_SERVER_SIDE]: true })
                expect(initialize).toHaveBeenCalledWith(expect.any(BrowserClientAdapter))
                logs.captureLog({ body: 'new configuration' })
                logs.flushLogs('fetch')
                expect(mockPostHog._send_request).toHaveBeenLastCalledWith(
                    expect.objectContaining({
                        url: 'https://us.i.posthog.com/i/v1/logs?token=changed%20token',
                        transport: 'fetch',
                    })
                )
                const request = vi.mocked(mockPostHog._send_request).mock.calls.at(-1)![0]
                expect((request.data as any).resourceLogs[0].resource.attributes).toContainEqual({
                    key: 'service.name',
                    value: { stringValue: 'changed-service' },
                })
                logs.dispose()
            })
        })

        describe('loadIfEnabled', () => {
            it('should not initialize if PostHog Extensions are not found', () => {
                ;(logs as any)._isLogsEnabled = true
                Object.defineProperty(assignableWindow, '__PosthogExtensions__', {
                    value: null,
                    writable: true,
                    configurable: true,
                })

                logs.loadIfEnabled()

                expect(mockLogger.error).toHaveBeenCalledWith('PostHog Extensions not found.')
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
            })

            it('should not initialize if loadExternalDependency is not found', () => {
                ;(logs as any)._isLogsEnabled = true
                Object.defineProperty(assignableWindow, '__PosthogExtensions__', {
                    value: {},
                    writable: true,
                    configurable: true,
                })

                logs.loadIfEnabled()

                expect(mockLogger.error).toHaveBeenCalledWith('PostHog loadExternalDependency extension not found.')
            })

            it('should initialize logs when all conditions are met', () => {
                ;(logs as any)._isLogsEnabled = true

                logs.loadIfEnabled()

                expect(mockLoadExternalDependency).toHaveBeenCalledWith(mockPostHog, 'logs', expect.any(Function))
                expect(mockInitializeLogs).toHaveBeenCalledWith(expect.any(BrowserClientAdapter))
            })

            it('should handle missing initializeLogs function', () => {
                ;(logs as any)._isLogsEnabled = true
                Object.defineProperty(assignableWindow, '__PosthogExtensions__', {
                    value: {
                        loadExternalDependency: mockLoadExternalDependency,
                        logs: { initializeLogs: null },
                    },
                    writable: true,
                    configurable: true,
                })

                logs.loadIfEnabled()

                expect(mockLogger.error).toHaveBeenCalledWith('Could not load logs script', null)
            })
        })

        describe('error handling and edge cases', () => {
            it('should handle null PostHog instance gracefully', () => {
                const logsWithNullPostHog = new PostHogLogs(null as any)
                const response = {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar' as const,
                    isAuthenticated: false,
                    siteApps: [],
                    logs: { captureConsoleLogs: true },
                }

                expect(() => logsWithNullPostHog.onRemoteConfig({ ok: true, config: response })).not.toThrow()
                expect(() => logsWithNullPostHog.loadIfEnabled()).not.toThrow()
                expect(() => logsWithNullPostHog.reset()).not.toThrow()
            })

            it('should handle window object not being available', () => {
                ;(logs as any)._isLogsEnabled = true
                const originalExtensions = assignableWindow.__PosthogExtensions__
                Object.defineProperty(assignableWindow, '__PosthogExtensions__', {
                    value: undefined,
                    writable: true,
                    configurable: true,
                })

                logs.loadIfEnabled()

                expect(mockLogger.error).toHaveBeenCalledWith('PostHog Extensions not found.')

                // Restore extensions
                Object.defineProperty(assignableWindow, '__PosthogExtensions__', {
                    value: originalExtensions,
                    writable: true,
                    configurable: true,
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

            it('should send to the correct URL with token', () => {
                logs.captureLog({ body: 'test' })
                vi.advanceTimersByTime(3000)

                expect(mockPostHog.requestRouter.endpointFor).toHaveBeenCalledWith('api', '/i/v1/logs?token=test-token')
                const call = (mockPostHog._send_request as vi.Mock).mock.calls[0][0]
                expect(call.url).toContain('token=test-token')
            })

            it('should use batchKey "logs" for independent rate limiting', () => {
                logs.captureLog({ body: 'test' })
                vi.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as vi.Mock).mock.calls[0][0]
                expect(call.batchKey).toBe('logs')
            })

            it('should use best-available compression', () => {
                logs.captureLog({ body: 'test' })
                vi.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as vi.Mock).mock.calls[0][0]
                expect(call.compression).toBe('best-available')
            })

            it('should auto-populate SDK context', () => {
                logs.captureLog({ body: 'test' })
                vi.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as vi.Mock).mock.calls[0][0]
                const record = call.data.resourceLogs[0].scopeLogs[0].logRecords[0]
                const attrs = Object.fromEntries(record.attributes.map((a: any) => [a.key, a.value]))

                expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'distinct-id-123' })
                expect(attrs['sessionId']).toEqual({ stringValue: 'session-abc' })
                expect(attrs['window.id']).toEqual({ stringValue: 'window-xyz' })
                expect(attrs['sessionStartTimestamp']).toEqual({ stringValue: '1672567200000' })
                expect(attrs['lastActivityTimestamp']).toEqual({ stringValue: '1672569000000' })
                expect(attrs['feature_flags']).toEqual({
                    arrayValue: { values: [{ stringValue: 'logs-capture-enabled' }] },
                })
            })

            it.each(['sessionStartTimestamp', 'lastActivityTimestamp'])(
                'omits %s and does not throw when the session manager returns null for it',
                (attribute) => {
                    ;(mockPostHog.sessionManager!.checkAndGetSessionAndWindowId as vi.Mock).mockReturnValue({
                        sessionId: 'session-abc',
                        windowId: 'window-xyz',
                        sessionStartTimestamp: null,
                        lastActivityTimestamp: null,
                    })

                    expect(() => {
                        logs.captureLog({ body: 'test' })
                        vi.advanceTimersByTime(3000)
                    }).not.toThrow()

                    const call = (mockPostHog._send_request as vi.Mock).mock.calls[0][0]
                    const record = call.data.resourceLogs[0].scopeLogs[0].logRecords[0]
                    const attrs = Object.fromEntries(record.attributes.map((a: any) => [a.key, a.value]))

                    expect(attrs).not.toHaveProperty(attribute)
                    expect(attrs['window.id']).toEqual({ stringValue: 'window-xyz' })
                }
            )
        })

        describe('sendBeacon flush', () => {
            it.each(['XHR', 'fetch'] as const)(
                'forces the %s transport and drains the queue in one request',
                (transport) => {
                    logs.captureLog({ body: 'a' })
                    logs.captureLog({ body: 'b' })

                    logs.flushLogs(transport)

                    const call = (mockPostHog._send_request as vi.Mock).mock.calls.at(-1)?.[0]
                    expect(call.transport).toBe(transport)
                    expect(call.batchKey).toBe('logs')
                    expect(call.data.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(2)
                    expect((logs as any)._queue).toHaveLength(0)
                }
            )
        })

        describe('persisted capture hint', () => {
            it('persists the server response so the next page load can buffer early console calls', () => {
                const register = vi.fn()
                ;(mockPostHog as any).persistence = { register, props: {} }
                const persisting = createLogs(mockPostHog)

                persisting.onRemoteConfig({
                    ok: true,
                    config: { ...flagsResponse, logs: { captureConsoleLogs: true } },
                } as any)
                expect(register).toHaveBeenLastCalledWith({ [LOGS_CAPTURE_ENABLED_SERVER_SIDE]: true })

                persisting.onRemoteConfig({
                    ok: true,
                    config: { ...flagsResponse, logs: { captureConsoleLogs: false } },
                } as any)
                expect(register).toHaveBeenLastCalledWith({ [LOGS_CAPTURE_ENABLED_SERVER_SIDE]: false })

                // A response without a `logs` key must not overwrite the last verdict.
                register.mockClear()
                persisting.onRemoteConfig({ ok: true, config: { ...flagsResponse, logs: undefined } } as any)
                expect(register).not.toHaveBeenCalled()
            })
        })

        describe('console recorder', () => {
            const buildInstanceWithPersistedBit = () =>
                ({
                    ...mockPostHog,
                    persistence: {
                        register: vi.fn(),
                        props: { [LOGS_CAPTURE_ENABLED_SERVER_SIDE]: true },
                    },
                }) as unknown as PostHog

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
                    setupConsoleMethods[level] = assignableWindow.console[level]
                    assignableWindow.console[level] = vi.fn()
                }
            })

            afterEach(() => {
                logsFromPersisted?.reset()
                for (const level of RECORDER_LEVELS) {
                    assignableWindow.console[level] = setupConsoleMethods[level]
                }
            })

            it('should stop recording when the bundle ships no extensions object at all', () => {
                // Plain `no-external` builds import no entrypoint, so nothing ever creates
                // `__PosthogExtensions__` and this is the branch they actually take.
                ;(assignableWindow as any).__PosthogExtensions__ = undefined
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                const originalLog = assignableWindow.console.log
                setupLogs(logsFromPersisted)

                assignableWindow.console.log('never handed over')
                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))

                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect(assignableWindow.console.log).toBe(originalLog)
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
            })

            it('should not start a hint-only recorder when remote config cannot arrive', () => {
                const instance = buildInstanceWithPersistedBit()
                ;(instance as any)._shouldDisableFlags = vi.fn(() => true)
                logsFromPersisted = new PostHogLogs(instance)
                const originalLog = assignableWindow.console.log
                setupLogs(logsFromPersisted)

                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect(assignableWindow.console.log).toBe(originalLog)
            })

            it('should still buffer with flags disabled when remote config was preloaded', () => {
                const instance = buildInstanceWithPersistedBit()
                ;(instance as any)._shouldDisableFlags = vi.fn(() => true)
                ;(assignableWindow as any)._POSTHOG_REMOTE_CONFIG = { 'test-token': { config: {} } }
                try {
                    logsFromPersisted = new PostHogLogs(instance)
                    setupLogs(logsFromPersisted)
                    expect((logsFromPersisted as any)._isRecordingConsole).toBe(true)
                } finally {
                    delete (assignableWindow as any)._POSTHOG_REMOTE_CONFIG
                }
            })

            it('should stop recording when the extensions object carries no script loader', () => {
                // `full.no-external` inlines the logs entrypoint, so the object exists but
                // nothing can fetch: the handover can never come.
                assignableWindow.__PosthogExtensions__ = {} as any
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                const originalLog = assignableWindow.console.log
                setupLogs(logsFromPersisted)

                assignableWindow.console.log('never handed over')
                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))

                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect(assignableWindow.console.log).toBe(originalLog)
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
            })

            it('should unpatch cleanly from underneath a session-replay console patch', () => {
                // recorder.js and logs.js both arrive after remote config, in either
                // order. rrweb's patch builds the same layer under its own marker, so
                // the recorder can only be spliced out if the walk recognises both.
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                setupLogs(logsFromPersisted)
                const recorderWrapper: any = assignableWindow.console.log

                rrwebPatch(
                    assignableWindow.console,
                    'log',
                    (next: any) =>
                        (...args: any[]) =>
                            next.apply(assignableWindow.console, args)
                )

                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))

                let recorderRan = false
                recorderWrapper.__posthog_layer__.next = () => {
                    recorderRan = true
                }
                assignableWindow.console.log('after handover')
                expect(recorderRan).toBe(false)
            })
        })

        describe('console capture instance', () => {
            beforeEach(() => {
                vi.useFakeTimers()
            })

            afterEach(() => {
                vi.useRealTimers()
            })

            it('auto-populates the shared SDK context (incl. feature_flags) on console records', () => {
                logs.captureConsoleLog({ body: 'console' })
                vi.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as vi.Mock).mock.calls.at(-1)?.[0]
                expect(call.data.resourceLogs[0].scopeLogs[0].scope.name).toBe('console')
                expect(call.data.resourceLogs[0].resource.attributes).toContainEqual({
                    key: 'telemetry.sdk.name',
                    value: { stringValue: 'web' },
                })
                const record = call.data.resourceLogs[0].scopeLogs[0].logRecords[0]
                const attrs = Object.fromEntries(record.attributes.map((a: any) => [a.key, a.value]))

                expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'distinct-id-123' })
                expect(attrs['sessionId']).toEqual({ stringValue: 'session-abc' })
                expect(attrs['window.id']).toEqual({ stringValue: 'window-xyz' })
                expect(attrs['sessionStartTimestamp']).toEqual({ stringValue: '1672567200000' })
                expect(attrs['lastActivityTimestamp']).toEqual({ stringValue: '1672569000000' })
                expect(attrs['feature_flags']).toEqual({
                    arrayValue: { values: [{ stringValue: 'logs-capture-enabled' }] },
                })
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
                ;(mockPostHog._send_request as vi.Mock).mockImplementation((opts: any) =>
                    opts.callback?.({ statusCode })
                )
                logs.captureLog({ body: 'x' })
                await (logs as any)._core.flush().catch(() => {})
            }

            const sendCount = () => (mockPostHog._send_request as vi.Mock).mock.calls.length

            it('counts only post-load failures even before deferred setup', async () => {
                logs.dispose()
                logs = new PostHogLogs(mockPostHog)
                const client = new BrowserClientAdapter(mockPostHog)
                logs._bindClient(() => client)
                // Before `init` completes, `_send_request` synthesizes
                // `{ statusCode: 0 }` without any network attempt
                // (`fireCallbackOnDrop` on the `!__loaded` path). A deferred init
                // must not arrive to an already-tripped breaker.
                ;(mockPostHog as any).__loaded = false
                for (let i = 0; i < 3; i++) {
                    await flushWith(0)
                }
                ;(mockPostHog as any).__loaded = true

                await flushWith(0)

                expect(sendCount()).toBe(4)
            })
        })
    })
})
