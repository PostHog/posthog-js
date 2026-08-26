import type { Client } from '@posthog/browser-common'

import { PostHogLogs, RECORDER_MAX_AGE_MS } from '../posthog-logs'
import { patch as rrwebPatch } from '@posthog/rrweb-utils'
import { LOGS_CAPTURE_ENABLED_SERVER_SIDE } from '../constants'
import { PostHog } from '../posthog-core'

import { assignableWindow } from '../utils/globals'

// Mock the logger to avoid console output during tests
const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}

jest.mock('@posthog/browser-common/utils/logger', () => ({
    createLogger: jest.fn(() => mockLogger),
}))

describe('posthog-logs', () => {
    describe('PostHogLogs Class', () => {
        let mockPostHog: PostHog
        let logs: PostHogLogs
        let mockDisposeLogs: jest.Mock
        let mockInitializeLogs: jest.Mock
        let mockReplayConsoleBuffer: jest.Mock
        let mockLoadExternalDependency: jest.Mock

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
            jest.clearAllMocks()

            // Mock window and PostHog extensions
            mockDisposeLogs = jest.fn()
            mockInitializeLogs = jest.fn(() => mockDisposeLogs)
            mockReplayConsoleBuffer = jest.fn()
            mockLoadExternalDependency = jest.fn((_instance, _name, callback) => {
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
                    register: jest.fn(),
                    props: {},
                },
                requestRouter: {
                    endpointFor: jest.fn(() => 'https://us.i.posthog.com'),
                },
                _send_request: jest.fn((opts: any) => opts.callback?.({ statusCode: 200 })),
                get_property: jest.fn(),
                is_capturing: jest.fn(() => true),
                get_distinct_id: jest.fn(() => 'distinct-id-123'),
                sessionManager: {
                    checkAndGetSessionAndWindowId: jest.fn(() => ({
                        sessionId: 'session-abc',
                        windowId: 'window-xyz',
                        sessionStartTimestamp: 1672567200000,
                        lastActivityTimestamp: 1672569000000,
                    })),
                },
                consent: {
                    _instance: mockPostHog,
                    _config: {},
                    consent: jest.fn(),
                    isOptedIn: jest.fn(() => true),
                    isOptedOut: jest.fn(() => false),
                    hasOptedInBefore: jest.fn(() => true),
                    hasOptedOutBefore: jest.fn(() => false),
                    optInCapturing: jest.fn(),
                    optOutCapturing: jest.fn(),
                    reset: jest.fn(),
                    onConsentChange: jest.fn(),
                },
                featureFlags: {
                    _send_retriable_request: jest.fn((_url, _params, callback) => {
                        callback({ statusCode: 200, json: flagsResponse })
                    }),
                    getFeatureFlag: jest.fn((flag) => {
                        return flagsResponse.featureFlags[flag as keyof typeof flagsResponse.featureFlags]
                    }),
                    isFeatureEnabled: jest.fn((flag) => {
                        return !!flagsResponse.featureFlags[flag as keyof typeof flagsResponse.featureFlags]
                    }),
                    getFlags: jest.fn(() => ['logs-capture-enabled']),
                },
            } as unknown as PostHog

            logs = new PostHogLogs(mockPostHog)
        })

        describe('shared extension lifecycle', () => {
            it('subscribes to remote config during setup', () => {
                const remoteConfigDispose = jest.fn()
                let remoteConfigHandler: ((result: any) => void) | undefined
                const client = {
                    onRemoteConfig: jest.fn((handler: (result: any) => void) => {
                        remoteConfigHandler = handler
                        return { dispose: remoteConfigDispose }
                    }),
                } as unknown as Client

                logs.setup(client)
                remoteConfigHandler?.({ ok: true, config: flagsResponse })

                expect(logs.name).toBe('logs')
                expect(client.onRemoteConfig).toHaveBeenCalledTimes(1)
                expect(mockInitializeLogs).toHaveBeenCalledWith(client)

                logs.dispose()
                expect(remoteConfigDispose).toHaveBeenCalledTimes(1)
                expect(mockDisposeLogs).toHaveBeenCalledTimes(1)
            })

            it('does not load twice when setup replays enabled remote config', () => {
                let loadCallback: ((error?: unknown) => void) | undefined
                mockLoadExternalDependency.mockImplementation((_instance, _name, callback) => {
                    loadCallback = callback
                })
                const client = {
                    onRemoteConfig: (handler: (result: any) => void) => {
                        handler({ ok: true, config: flagsResponse })
                        return { dispose: jest.fn() }
                    },
                } as unknown as Client

                logs.setup(client)
                loadCallback?.()

                expect(mockLoadExternalDependency).toHaveBeenCalledTimes(1)
                expect(mockInitializeLogs).toHaveBeenCalledTimes(1)
            })

            it('does not retry a synchronous replay load failure during setup', () => {
                mockLoadExternalDependency.mockImplementation((_instance, _name, callback) => {
                    callback(new Error('Loading failed'))
                })
                const client = {
                    onRemoteConfig: (handler: (result: any) => void) => {
                        handler({ ok: true, config: flagsResponse })
                        return { dispose: jest.fn() }
                    },
                } as unknown as Client

                logs.setup(client)

                expect(mockLoadExternalDependency).toHaveBeenCalledTimes(1)
                expect(mockInitializeLogs).not.toHaveBeenCalled()
            })

            it('releases resources and ignores late work on dispose', () => {
                const remoteConfigDispose = jest.fn()
                let remoteConfigHandler: ((result: any) => void) | undefined
                const client = {
                    onRemoteConfig: (handler: (result: any) => void) => {
                        remoteConfigHandler = handler
                        return { dispose: remoteConfigDispose }
                    },
                } as unknown as Client
                const removeEventListener = jest.spyOn(window, 'removeEventListener')

                logs.setup(client)
                logs.dispose()
                logs.dispose()
                remoteConfigHandler?.({ ok: true, config: flagsResponse })

                expect(remoteConfigDispose).toHaveBeenCalledTimes(1)
                expect(removeEventListener).toHaveBeenCalledWith('online', expect.any(Function))
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
                removeEventListener.mockRestore()
            })

            it('does not initialize a lazy logs chunk after disposal', () => {
                let loadCallback: ((error?: unknown) => void) | undefined
                mockLoadExternalDependency.mockImplementation((_instance, _name, callback) => {
                    loadCallback = callback
                })
                ;(logs as any)._isLogsEnabled = true

                logs.loadIfEnabled()
                logs.dispose()
                loadCallback?.()

                expect(mockInitializeLogs).not.toHaveBeenCalled()
                expect((logs as any)._isLoaded).toBe(false)
            })

            it('preserves queued logs for the shutdown transport flush', () => {
                jest.useFakeTimers()
                try {
                    logs.captureLog({ body: 'queued before shutdown' })

                    logs.dispose()
                    logs.flushLogs('sendBeacon')

                    expect((logs as any)._queue).toHaveLength(0)
                    expect(mockPostHog._send_request).toHaveBeenCalledWith(
                        expect.objectContaining({ transport: 'sendBeacon', batchKey: 'logs' })
                    )
                } finally {
                    jest.useRealTimers()
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
                const loadIfEnabledSpy = jest.spyOn(logs, 'loadIfEnabled')
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

                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
                expect(mockInitializeLogs).not.toHaveBeenCalled()
            })

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
                expect(mockInitializeLogs).toHaveBeenCalledWith(mockPostHog)
            })

            it('should handle loadExternalDependency errors', () => {
                ;(logs as any)._isLogsEnabled = true
                mockLoadExternalDependency.mockImplementation((_instance, _name, callback) => {
                    callback(new Error('Loading failed'))
                })

                logs.loadIfEnabled()

                expect(mockLogger.error).toHaveBeenCalledWith('Could not load logs script', expect.any(Error))
                expect(mockInitializeLogs).not.toHaveBeenCalled()
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

            it('should not reinitialize logs if called multiple times', () => {
                ;(logs as any)._isLogsEnabled = true

                logs.loadIfEnabled()
                logs.loadIfEnabled()

                expect(mockLoadExternalDependency).toHaveBeenCalledTimes(1)
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
                expect(mockLoadExternalDependency).toHaveBeenCalledWith(mockPostHog, 'logs', expect.any(Function))
                expect(mockInitializeLogs).toHaveBeenCalledWith(mockPostHog)
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

                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
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
                    const testLogs = new PostHogLogs(mockPostHog)
                    testLogs.onRemoteConfig({ ok: true, config: config })
                    expect((testLogs as any)._isLogsEnabled).toBe(true)
                })
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
                    const testLogs = new PostHogLogs(mockPostHog)
                    expect(() => testLogs.onRemoteConfig({ ok: true, config: response as any })).not.toThrow()
                    expect((testLogs as any)._isLogsEnabled).toBeFalsy()
                })

                // Test null and undefined separately since they can't be spread
                const nullUndefinedResponses = [null, undefined]
                nullUndefinedResponses.forEach((response) => {
                    const testLogs = new PostHogLogs(mockPostHog)
                    expect(() => testLogs.onRemoteConfig({ ok: true, config: response as any })).toThrow()
                })
            })

            it('should handle async loading errors gracefully', () => {
                ;(logs as any)._isLogsEnabled = true
                mockLoadExternalDependency.mockImplementation((_instance, _name, callback) => {
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
                jest.useFakeTimers()
            })

            afterEach(() => {
                jest.useRealTimers()
            })

            it('should silently skip when user has opted out of capturing', () => {
                ;(mockPostHog.is_capturing as jest.Mock).mockReturnValue(false)

                logs.captureLog({ body: 'should not be captured' })

                expect((logs as any)._queue).toHaveLength(0)
                expect(mockPostHog._send_request).not.toHaveBeenCalled()
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

                expect(mockPostHog._send_request).not.toHaveBeenCalled()
            })

            it('should flush on timer expiry and clear the queue on success', async () => {
                logs.captureLog({ body: 'test message' })

                await jest.advanceTimersByTimeAsync(3000)

                expect(mockPostHog._send_request).toHaveBeenCalledTimes(1)
                expect((logs as any)._queue).toHaveLength(0)
            })

            it('should flush immediately when buffer reaches max size', () => {
                ;(mockPostHog.config as any).logs = { maxBufferSize: 5, maxLogsPerInterval: 1000 }
                logs = new PostHogLogs(mockPostHog)

                for (let i = 0; i < 5; i++) {
                    logs.captureLog({ body: `message ${i}` })
                }

                expect(mockPostHog._send_request).toHaveBeenCalledTimes(1)
            })

            it('retains a burst past maxBufferSize up to the rate-cap reservoir (no eviction at the flush trigger)', () => {
                // Hold the flush open so capture outpaces drain. maxBufferSize (2) only
                // triggers a flush; the eviction backstop sits at the rate cap (1000), so
                // a burst the cap admits is held in full rather than dropped at the trigger.
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(() => undefined)
                ;(mockPostHog.config as any).logs = { maxBufferSize: 2, maxLogsPerInterval: 1000 }
                logs = new PostHogLogs(mockPostHog)

                logs.captureLog({ body: 'oldest' })
                logs.captureLog({ body: 'middle' })
                logs.captureLog({ body: 'newest' })

                const bodies = (logs as any)._queue.map((e: any) => e.record.body.stringValue)
                expect(bodies).toEqual(['oldest', 'middle', 'newest'])
            })

            it('should send to the correct URL with token', () => {
                logs.captureLog({ body: 'test' })
                jest.advanceTimersByTime(3000)

                expect(mockPostHog.requestRouter.endpointFor).toHaveBeenCalledWith('api', '/i/v1/logs')
                const call = (mockPostHog._send_request as jest.Mock).mock.calls[0][0]
                expect(call.url).toContain('token=test-token')
            })

            it('should send OTLP formatted payload', () => {
                logs.captureLog({ body: 'test', level: 'error' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls[0][0]
                expect(call.data.resourceLogs).toBeDefined()
                expect(call.data.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1)
                expect(call.data.resourceLogs[0].scopeLogs[0].logRecords[0].severityText).toBe('ERROR')
            })

            it('should use batchKey "logs" for independent rate limiting', () => {
                logs.captureLog({ body: 'test' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls[0][0]
                expect(call.batchKey).toBe('logs')
            })

            it('should use best-available compression', () => {
                logs.captureLog({ body: 'test' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls[0][0]
                expect(call.compression).toBe('best-available')
            })

            it('should batch multiple logs into one request', () => {
                logs.captureLog({ body: 'log 1' })
                logs.captureLog({ body: 'log 2' })
                logs.captureLog({ body: 'log 3' })
                jest.advanceTimersByTime(3000)

                expect(mockPostHog._send_request).toHaveBeenCalledTimes(1)
                const call = (mockPostHog._send_request as jest.Mock).mock.calls[0][0]
                expect(call.data.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(3)
            })

            it('should auto-populate SDK context', () => {
                logs.captureLog({ body: 'test' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls[0][0]
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
                    ;(mockPostHog.sessionManager!.checkAndGetSessionAndWindowId as jest.Mock).mockReturnValue({
                        sessionId: 'session-abc',
                        windowId: 'window-xyz',
                        sessionStartTimestamp: null,
                        lastActivityTimestamp: null,
                    })

                    expect(() => {
                        logs.captureLog({ body: 'test' })
                        jest.advanceTimersByTime(3000)
                    }).not.toThrow()

                    const call = (mockPostHog._send_request as jest.Mock).mock.calls[0][0]
                    const record = call.data.resourceLogs[0].scopeLogs[0].logRecords[0]
                    const attrs = Object.fromEntries(record.attributes.map((a: any) => [a.key, a.value]))

                    expect(attrs).not.toHaveProperty(attribute)
                    expect(attrs['window.id']).toEqual({ stringValue: 'window-xyz' })
                }
            )

            it('should include named config fields in OTLP resource attributes', () => {
                ;(mockPostHog.config as any).logs = {
                    ...mockPostHog.config.logs,
                    serviceName: 'my-service',
                    serviceVersion: '1.2.3',
                    environment: 'production',
                }
                logs = new PostHogLogs(mockPostHog)
                logs.captureLog({ body: 'test' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls[0][0]
                const resourceAttrs = call.data.resourceLogs[0].resource.attributes
                const attrsMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))

                expect(attrsMap['service.name']).toEqual({ stringValue: 'my-service' })
                expect(attrsMap['service.version']).toEqual({ stringValue: '1.2.3' })
                expect(attrsMap['deployment.environment']).toEqual({ stringValue: 'production' })
            })

            it('should allow resourceAttributes to override named fields', () => {
                ;(mockPostHog.config as any).logs = {
                    ...mockPostHog.config.logs,
                    serviceName: 'from-named',
                    serviceVersion: 'from-named',
                    environment: 'from-named',
                    resourceAttributes: {
                        'service.name': 'from-resource-attrs',
                        'service.version': 'from-resource-attrs',
                        'deployment.environment': 'from-resource-attrs',
                    },
                }
                logs = new PostHogLogs(mockPostHog)
                logs.captureLog({ body: 'test' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls[0][0]
                const resourceAttrs = call.data.resourceLogs[0].resource.attributes
                const attrsMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))

                expect(attrsMap['service.name']).toEqual({ stringValue: 'from-resource-attrs' })
                expect(attrsMap['service.version']).toEqual({ stringValue: 'from-resource-attrs' })
                expect(attrsMap['deployment.environment']).toEqual({ stringValue: 'from-resource-attrs' })
            })

            it('should use consistent resource attributes across all logs in a batch', () => {
                ;(mockPostHog.config as any).logs = {
                    ...mockPostHog.config.logs,
                    serviceName: 'my-service',
                }
                logs = new PostHogLogs(mockPostHog)
                logs.captureLog({ body: 'log 1' })
                logs.captureLog({ body: 'log 2' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls[0][0]
                const resourceAttrs = call.data.resourceLogs[0].resource.attributes
                const attrsMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))

                expect(attrsMap['service.name']).toEqual({ stringValue: 'my-service' })
                expect(call.data.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(2)
            })

            it('should default service.name to unknown_service when not configured', () => {
                logs.captureLog({ body: 'test' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls[0][0]
                const resourceAttrs = call.data.resourceLogs[0].resource.attributes
                const attrsMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))

                expect(attrsMap['service.name']).toEqual({ stringValue: 'unknown_service' })
            })

            it('should not send anything if buffer is empty on flush', () => {
                logs.flushLogs()

                expect(mockPostHog._send_request).not.toHaveBeenCalled()
            })

            it('should drop logs that exceed maxLogsPerInterval and warn once', () => {
                ;(mockPostHog.config as any).logs = {
                    ...mockPostHog.config.logs,
                    maxLogsPerInterval: 3,
                    maxBufferSize: 1000,
                }
                logs = new PostHogLogs(mockPostHog)

                for (let i = 0; i < 10; i++) {
                    logs.captureLog({ body: `msg ${i}` })
                }

                expect((logs as any)._queue).toHaveLength(3)
                expect(mockLogger.warn).toHaveBeenCalledTimes(1)
                expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('dropping logs'))
            })

            it('should reset the rate-limit window after the interval elapses', () => {
                ;(mockPostHog.config as any).logs = {
                    ...mockPostHog.config.logs,
                    maxLogsPerInterval: 2,
                    flushIntervalMs: 3000,
                    maxBufferSize: 1000,
                }
                logs = new PostHogLogs(mockPostHog)

                logs.captureLog({ body: 'a' })
                logs.captureLog({ body: 'b' })
                logs.captureLog({ body: 'dropped' })
                expect((logs as any)._queue).toHaveLength(2)

                jest.advanceTimersByTime(3001)
                logs.captureLog({ body: 'c' })
                expect((logs as any)._queue.some((e: any) => e.record.body.stringValue === 'c')).toBe(true)
            })

            it('should work without console log autocapture enabled', () => {
                // captureLog works independently of _isLogsEnabled
                expect((logs as any)._isLogsEnabled).toBeFalsy()

                logs.captureLog({ body: 'works without autocapture' })
                jest.advanceTimersByTime(3000)

                expect(mockPostHog._send_request).toHaveBeenCalledTimes(1)
            })

            it('should support transport override for unload', () => {
                logs.captureLog({ body: 'unload log' })
                logs.flushLogs('sendBeacon')

                const call = (mockPostHog._send_request as jest.Mock).mock.calls[0][0]
                expect(call.transport).toBe('sendBeacon')
            })
        })

        describe('logger convenience methods', () => {
            beforeEach(() => {
                jest.useFakeTimers()
            })

            it.each(['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const)(
                'logger.%s() should capture a log with the correct level',
                (level) => {
                    logs.logger[level]('test message', { key: 'value' })
                    jest.advanceTimersByTime(3000)

                    const call = (mockPostHog._send_request as jest.Mock).mock.calls[0][0]
                    const record = call.data.resourceLogs[0].scopeLogs[0].logRecords[0]

                    expect(record.body.stringValue).toBe('test message')
                    const attrs = Object.fromEntries(record.attributes.map((a: any) => [a.key, a.value]))
                    expect(attrs.key).toEqual({ stringValue: 'value' })
                }
            )

            it('logger.info() should work without attributes', () => {
                logs.logger.info('no attrs')
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls[0][0]
                const record = call.data.resourceLogs[0].scopeLogs[0].logRecords[0]
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
                    ;(mockPostHog.config as any).logs = { beforeSend }
                    logs = new PostHogLogs(mockPostHog)

                    logs.captureLog({ body: input })

                    expect((logs as any)._queue).toHaveLength(1)
                    expect(bodyOf(logs)).toBe(expected)
                }
            )

            it.each([
                ['single function returning null', () => null],
                ['chain with a null-returning link', [(record: any) => record, () => null, (record: any) => record]],
            ] as Array<[string, any]>)('drops the record when beforeSend is a %s', (_label, beforeSend) => {
                ;(mockPostHog.config as any).logs = { beforeSend }
                logs = new PostHogLogs(mockPostHog)

                logs.captureLog({ body: 'should be dropped' })

                expect((logs as any)._queue).toHaveLength(0)
            })

            it('drops the record when a beforeSend fn throws', () => {
                ;(mockPostHog.config as any).logs = {
                    beforeSend: [
                        (record: any) => ({ ...record, body: 'kept' }),
                        () => {
                            throw new Error('boom')
                        },
                    ],
                }
                logs = new PostHogLogs(mockPostHog)

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

                const call = (mockPostHog._send_request as jest.Mock).mock.calls.at(-1)?.[0]
                expect(call.transport).toBe('sendBeacon')
                expect(call.data.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(2)
                expect((logs as any)._queue).toHaveLength(0)

                // The beacon path builds resource attributes itself; confirm it matches
                // the core path (default service.name + SDK telemetry keys).
                const attrs = Object.fromEntries(
                    call.data.resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
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

                expect(mockPostHog._send_request).not.toHaveBeenCalled()
            })

            it.each(['XHR', 'fetch'] as const)(
                'forces the %s transport and drains the queue in one request',
                (transport) => {
                    logs.captureLog({ body: 'a' })
                    logs.captureLog({ body: 'b' })

                    logs.flushLogs(transport)

                    const call = (mockPostHog._send_request as jest.Mock).mock.calls.at(-1)?.[0]
                    expect(call.transport).toBe(transport)
                    expect(call.batchKey).toBe('logs')
                    expect(call.data.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(2)
                    expect((logs as any)._queue).toHaveLength(0)
                }
            )
        })

        const noopClient = () => ({ onRemoteConfig: jest.fn(() => ({ dispose: jest.fn() })) }) as unknown as Client

        describe('persisted capture hint', () => {
            it('persists the server response so the next page load can buffer early console calls', () => {
                const register = jest.fn()
                ;(mockPostHog as any).persistence = { register, props: {} }
                const persisting = new PostHogLogs(mockPostHog)

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
                        register: jest.fn(),
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
                    assignableWindow.console[level] = jest.fn()
                }
            })

            afterEach(() => {
                logsFromPersisted?.reset()
                for (const level of RECORDER_LEVELS) {
                    assignableWindow.console[level] = setupConsoleMethods[level]
                }
            })

            it('should buffer console entries instead of loading when the persisted bit is set', () => {
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                logsFromPersisted.setup(noopClient())

                expect((logsFromPersisted as any)._isLogsEnabled).toBe(false)
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()

                assignableWindow.console.log('buffered message', 42)
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)
            })

            const buildInstanceWithLocalConfig = () =>
                ({
                    ...mockPostHog,
                    config: { ...mockPostHog.config, logs: { captureConsoleLogs: true } },
                    persistence: { register: jest.fn(), props: {} },
                }) as unknown as PostHog

            it('should buffer console entries when capture is enabled in local config', () => {
                // The documented way to turn console capture on. It skips the remote-config
                // wait but still has to wait for the logs script, so it gets a recorder too.
                mockLoadExternalDependency.mockImplementation(() => {})
                logsFromPersisted = new PostHogLogs(buildInstanceWithLocalConfig())
                logsFromPersisted.setup(noopClient())

                expect((logsFromPersisted as any)._isRecordingConsole).toBe(true)
                assignableWindow.console.log('before the script lands')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)
            })

            it('should stop recording when the bundle ships no extensions object at all', () => {
                // Plain `no-external` builds import no entrypoint, so nothing ever creates
                // `__PosthogExtensions__` and this is the branch they actually take.
                ;(assignableWindow as any).__PosthogExtensions__ = undefined
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                const originalLog = assignableWindow.console.log
                logsFromPersisted.setup(noopClient())

                assignableWindow.console.log('never handed over')
                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))

                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect(assignableWindow.console.log).toBe(originalLog)
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
            })

            it('should keep a locally-configured buffer when the remote config request fails', () => {
                let finishLoad: (err: null) => void = () => {}
                mockLoadExternalDependency.mockImplementation((_i: any, _n: any, cb: any) => {
                    finishLoad = cb
                })
                logsFromPersisted = new PostHogLogs(buildInstanceWithLocalConfig())
                logsFromPersisted.setup(noopClient())
                assignableWindow.console.log('kept')

                logsFromPersisted.onRemoteConfig({ ok: false } as any)
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)

                finishLoad(null)
                expect(mockReplayConsoleBuffer).toHaveBeenCalledWith(expect.anything(), [
                    expect.objectContaining({ args: ['kept'] }),
                ])
            })

            it('should load the logs script once when local and remote config both enable capture', () => {
                // Every caller gets its own load callback, so a second in-flight load
                // would have the entrypoint wrap console twice.
                mockLoadExternalDependency.mockImplementation(() => {})
                logsFromPersisted = new PostHogLogs(buildInstanceWithLocalConfig())
                logsFromPersisted.setup(noopClient())

                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))

                expect(mockLoadExternalDependency).toHaveBeenCalledTimes(1)
            })

            it('should not buffer a console call made with no arguments', () => {
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                logsFromPersisted.setup(noopClient())

                assignableWindow.console.log()
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)

                assignableWindow.console.log('real')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)
            })

            it('should stop buffering when the recorder cannot be unpatched from the console chain', () => {
                // `patch` gives up when a non-layer wrapper closed over us directly, so the
                // recorder stays in the call path and the flag is what stops it recording.
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                logsFromPersisted.setup(noopClient())
                const recorder = assignableWindow.console.log
                assignableWindow.console.log = ((...args: any[]) => (recorder as any)(...args)) as any

                logsFromPersisted.onRemoteConfig(remoteConfigResult(false))

                assignableWindow.console.log('after a failed unpatch')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
            })

            it('should drop the buffer and unpatch console when the user opts out mid-window', () => {
                const instance = buildInstanceWithPersistedBit()
                logsFromPersisted = new PostHogLogs(instance)
                const originalLog = assignableWindow.console.log
                logsFromPersisted.setup(noopClient())

                assignableWindow.console.log('before opt out')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)
                ;(instance as any).is_capturing = jest.fn(() => false)

                assignableWindow.console.log('after opt out')

                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect(assignableWindow.console.log).toBe(originalLog)
            })

            it('should drop console records already captured when the user opts out', () => {
                const instance = buildInstanceWithLocalConfig()
                logsFromPersisted = new PostHogLogs(instance)
                logsFromPersisted.setup(noopClient())
                logsFromPersisted.captureLog({ body: 'programmatic' })
                logsFromPersisted.captureConsoleLog({ body: 'mirrored before the opt-out' })
                expect((logsFromPersisted as any)._consoleQueue).toHaveLength(1)
                ;(instance as any).is_capturing = jest.fn(() => false)

                logsFromPersisted._onOptOut()

                expect((logsFromPersisted as any)._consoleQueue).toHaveLength(0)
                expect((logsFromPersisted as any)._queue).toHaveLength(1)

                logsFromPersisted.captureConsoleLog({ body: 'after the opt-out' })
                expect((logsFromPersisted as any)._consoleQueue).toHaveLength(0)
            })

            it('should drop the buffer as soon as the user opts out, not on the next log line', () => {
                const instance = buildInstanceWithPersistedBit()
                logsFromPersisted = new PostHogLogs(instance)
                const originalLog = assignableWindow.console.log
                logsFromPersisted.setup(noopClient())

                assignableWindow.console.log('before opt out')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)

                logsFromPersisted._onOptOut()

                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect(assignableWindow.console.log).toBe(originalLog)
            })

            it('should not leave a recorder patched over the entrypoint when remote config replays synchronously', () => {
                const replayingClient = () =>
                    ({
                        onRemoteConfig: (handler: (result: any) => void) => {
                            handler(remoteConfigResult(true))
                            return { dispose: jest.fn() }
                        },
                    }) as unknown as Client
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                const originalLog = assignableWindow.console.log

                logsFromPersisted.setup(replayingClient())

                expect(mockInitializeLogs).toHaveBeenCalledTimes(1)
                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect(assignableWindow.console.log).toBe(originalLog)
            })

            it('should unpatch console and drop the buffer on dispose', () => {
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                const originalLog = assignableWindow.console.log
                logsFromPersisted.setup(noopClient())

                assignableWindow.console.log('held')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)

                logsFromPersisted.dispose()

                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect(assignableWindow.console.log).toBe(originalLog)
            })

            it('should stop a hint-only recorder when the response carries no logs key', () => {
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                const originalLog = assignableWindow.console.log
                logsFromPersisted.setup(noopClient())

                assignableWindow.console.log('held on the hint alone')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)

                logsFromPersisted.onRemoteConfig({
                    ok: true,
                    config: { ...remoteConfigResult(true).config, logs: undefined },
                } as any)

                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
                expect(assignableWindow.console.log).toBe(originalLog)
            })

            it.each([
                { label: 'the response carries no logs key', result: { ok: true, config: { logs: undefined } } },
                {
                    label: 'the server reports capture disabled',
                    result: { ok: true, config: { logs: { captureConsoleLogs: false } } },
                },
            ])('should keep a locally-configured recorder when $label', ({ result }) => {
                mockLoadExternalDependency.mockImplementation(() => {})
                logsFromPersisted = new PostHogLogs(buildInstanceWithLocalConfig())
                logsFromPersisted.setup(noopClient())
                assignableWindow.console.log('kept')

                logsFromPersisted.onRemoteConfig(result as any)

                expect((logsFromPersisted as any)._isLogsEnabled).toBe(true)
                expect((logsFromPersisted as any)._isRecordingConsole).toBe(true)
                assignableWindow.console.log('still captured')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(2)
            })

            it('should not start a hint-only recorder when remote config cannot arrive', () => {
                const instance = buildInstanceWithPersistedBit()
                ;(instance as any)._shouldDisableFlags = jest.fn(() => true)
                logsFromPersisted = new PostHogLogs(instance)
                const originalLog = assignableWindow.console.log
                logsFromPersisted.setup(noopClient())

                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect(assignableWindow.console.log).toBe(originalLog)
            })

            it('should still buffer with flags disabled when remote config was preloaded', () => {
                const instance = buildInstanceWithPersistedBit()
                ;(instance as any)._shouldDisableFlags = jest.fn(() => true)
                ;(assignableWindow as any)._POSTHOG_REMOTE_CONFIG = { 'test-token': { config: {} } }
                try {
                    logsFromPersisted = new PostHogLogs(instance)
                    logsFromPersisted.setup(noopClient())
                    expect((logsFromPersisted as any)._isRecordingConsole).toBe(true)
                } finally {
                    delete (assignableWindow as any)._POSTHOG_REMOTE_CONFIG
                }
            })

            it('should not patch console when the server last said no', () => {
                const instance = {
                    ...mockPostHog,
                    persistence: { register: jest.fn(), props: { [LOGS_CAPTURE_ENABLED_SERVER_SIDE]: false } },
                } as unknown as PostHog
                logsFromPersisted = new PostHogLogs(instance)
                const originalLog = assignableWindow.console.log

                logsFromPersisted.setup(noopClient())

                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                expect(assignableWindow.console.log).toBe(originalLog)
            })

            it('should not patch console when the persisted bit is absent', () => {
                const originalLog = assignableWindow.console.log
                logs.setup(noopClient())
                expect(assignableWindow.console.log).toBe(originalLog)
                expect((logs as any)._isRecordingConsole).toBe(false)
            })

            it('should hand raw buffered entries to the entrypoint and unpatch console when remote config enables logs', () => {
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                const originalLog = assignableWindow.console.log
                logsFromPersisted.setup(noopClient())

                const payload = { a: 1 }
                assignableWindow.console.log('hello', payload)

                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))

                expect(mockLoadExternalDependency).toHaveBeenCalled()
                expect(mockInitializeLogs).toHaveBeenCalled()
                expect(assignableWindow.console.log).toBe(originalLog)
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
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                logsFromPersisted.setup(noopClient())

                assignableWindow.console.log('before config')

                mockLoadExternalDependency.mockImplementationOnce((_instance, _name, callback) => {
                    assignableWindow.console.log('while script loads')
                    callback(null)
                })
                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))

                const entries = mockReplayConsoleBuffer.mock.calls[0][1]
                expect(entries.map((e: any) => e.args[0])).toEqual(['before config', 'while script loads'])
            })

            it('should stop the recorder and drop the buffer when the logs script fails to load', () => {
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                const originalLog = assignableWindow.console.log
                logsFromPersisted.setup(noopClient())

                assignableWindow.console.log('lost to a failed script load')

                mockLoadExternalDependency.mockImplementationOnce((_instance, _name, callback) => {
                    callback(new Error('load failed'))
                })
                logsFromPersisted.onRemoteConfig(remoteConfigResult(true))

                expect(mockReplayConsoleBuffer).not.toHaveBeenCalled()
                expect(assignableWindow.console.log).toBe(originalLog)
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
            })

            it('should drop the buffer and restore console when remote config disables logs', () => {
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                const originalInfo = assignableWindow.console.info
                logsFromPersisted.setup(noopClient())

                assignableWindow.console.info('never sent')

                logsFromPersisted.onRemoteConfig(remoteConfigResult(false))

                expect(assignableWindow.console.info).toBe(originalInfo)
                expect(mockReplayConsoleBuffer).not.toHaveBeenCalled()
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
            })

            it('should not buffer when the user has opted out', () => {
                const instance = buildInstanceWithPersistedBit()
                ;(instance as any).is_capturing = jest.fn(() => false)
                logsFromPersisted = new PostHogLogs(instance)
                logsFromPersisted.setup(noopClient())

                assignableWindow.console.log('opted out')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
            })

            it('should stop the recorder after the max age passes with no resolution', () => {
                jest.useFakeTimers()
                try {
                    logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                    const originalLog = assignableWindow.console.log
                    logsFromPersisted.setup(noopClient())

                    assignableWindow.console.log('held too long')
                    jest.advanceTimersByTime(RECORDER_MAX_AGE_MS)

                    expect(assignableWindow.console.log).toBe(originalLog)
                    expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
                    expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
                } finally {
                    jest.useRealTimers()
                }
            })

            it('should stop recording and drop the buffer when remote config fails', () => {
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                const originalLog = assignableWindow.console.log
                logsFromPersisted.setup(noopClient())

                assignableWindow.console.log('lost to a failed config fetch')

                logsFromPersisted.onRemoteConfig({ ok: false } as any)

                expect(assignableWindow.console.log).toBe(originalLog)
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
            })

            it('should not buffer a console call made while snapshotting the context', () => {
                const instance = buildInstanceWithPersistedBit()
                let nested = 0
                ;(instance as any).sessionManager = {
                    checkAndGetSessionAndWindowId: jest.fn(() => {
                        // Stands in for any context lookup that reaches the console
                        // directly: the nested call must not be buffered while the
                        // outer entry is still being built.
                        if (nested++ < 3) {
                            assignableWindow.console.error('from inside the capture path')
                        }
                        return { sessionId: 's', windowId: 'w' }
                    }),
                }
                logsFromPersisted = new PostHogLogs(instance)
                logsFromPersisted.setup(noopClient())

                assignableWindow.console.log('outer')

                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)
            })

            it('should drop the buffer and unpatch console when the SDK is reset mid-buffer', () => {
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                const originalLog = assignableWindow.console.log
                logsFromPersisted.setup(noopClient())

                assignableWindow.console.log('before reset')
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(1)

                logsFromPersisted.reset()

                expect(assignableWindow.console.log).toBe(originalLog)
                expect((logsFromPersisted as any)._consoleBuffer).toHaveLength(0)
                expect((logsFromPersisted as any)._isRecordingConsole).toBe(false)
            })

            it('should stop recording when the extensions object carries no script loader', () => {
                // `full.no-external` inlines the logs entrypoint, so the object exists but
                // nothing can fetch: the handover can never come.
                assignableWindow.__PosthogExtensions__ = {} as any
                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                const originalLog = assignableWindow.console.log
                logsFromPersisted.setup(noopClient())

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
                logsFromPersisted.setup(noopClient())
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

            it('should reach the real console method through an existing console wrapper', () => {
                // A console already wrapped by another plugin must still be restorable.
                const realLog = assignableWindow.console.log
                const foreign = (...args: any[]) => (realLog as any)(...args)
                ;(foreign as any).__rrweb_original__ = realLog
                assignableWindow.console.log = foreign as any

                logsFromPersisted = new PostHogLogs(buildInstanceWithPersistedBit())
                logsFromPersisted.setup(noopClient())

                expect((assignableWindow.console.log as any).__rrweb_original__).toBe(realLog)

                logsFromPersisted.onRemoteConfig(remoteConfigResult(false))
                expect(assignableWindow.console.log).toBe(foreign)
            })

            it('should cap the console buffer at the configured max size', () => {
                const instance = buildInstanceWithPersistedBit()
                ;(instance as any).config.logs = { maxBufferSize: 3 }
                logsFromPersisted = new PostHogLogs(instance)
                logsFromPersisted.setup(noopClient())

                for (let i = 0; i < 10; i++) {
                    assignableWindow.console.info('entry', i)
                }
                // Earliest calls are kept: they are the ones the live path would miss.
                expect((logsFromPersisted as any)._consoleBuffer.map((e: any) => e.args[1])).toEqual([0, 1, 2])
            })
        })

        describe('console capture instance', () => {
            beforeEach(() => {
                jest.useFakeTimers()
            })

            it('does not drop records captured after opting back in mid-flush', async () => {
                let releaseSend: (r: any) => void = () => {}
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(({ callback }: any) => {
                    releaseSend = callback
                })
                logs.captureConsoleLog({ body: 'before the opt-out' })
                jest.advanceTimersByTime(3000)
                expect(mockPostHog._send_request).toHaveBeenCalled()

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
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls.at(-1)?.[0]
                const record = call.data.resourceLogs[0].scopeLogs[0].logRecords[0]
                const attrs = Object.fromEntries(record.attributes.map((a: any) => [a.key, a.value]))

                expect(record.timeUnixNano).toBe('1700000000000000000')
                expect(record.observedTimeUnixNano).toBe(record.timeUnixNano)
                expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'anon-before-identify' })
                expect(attrs['sessionId']).toEqual({ stringValue: 'session-before-roll' })
            })

            afterEach(() => {
                jest.useRealTimers()
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
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls.at(-1)?.[0]
                const attrs = Object.fromEntries(
                    call.data.resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
                )
                expect(attrs['service.name']).toEqual({ stringValue: 'posthog-browser-logs' })
            })

            it('flushes console captures under the OTel-parity scope name "console"', () => {
                logs.captureConsoleLog({ body: 'console' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls.at(-1)?.[0]
                // Scope name labels the console stream...
                expect(call.data.resourceLogs[0].scopeLogs[0].scope.name).toBe('console')
                // ...but telemetry.sdk.name stays the SDK id, not the scope.
                const attrs = Object.fromEntries(
                    call.data.resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
                )
                expect(attrs['telemetry.sdk.name']).toEqual({ stringValue: 'web' })
            })

            it('flushes programmatic captures under the SDK scope name (not "console")', () => {
                logs.captureLog({ body: 'programmatic' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls.at(-1)?.[0]
                expect(call.data.resourceLogs[0].scopeLogs[0].scope.name).toBe('web')
            })

            it('auto-populates the shared SDK context (incl. feature_flags) on console records', () => {
                logs.captureConsoleLog({ body: 'console' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls.at(-1)?.[0]
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

            it('emits standard OTLP severity (text + number) on console records', () => {
                logs.captureConsoleLog({ body: 'uh oh', level: 'warn' })
                logs.captureConsoleLog({ body: 'boom', level: 'error' })
                jest.advanceTimersByTime(3000)

                const records = (mockPostHog._send_request as jest.Mock).mock.calls.at(-1)?.[0].data.resourceLogs[0]
                    .scopeLogs[0].logRecords
                expect(records[0]).toMatchObject({ severityText: 'WARN', severityNumber: 13 })
                expect(records[1]).toMatchObject({ severityText: 'ERROR', severityNumber: 17 })
            })

            it('lets a user-set serviceName win over the console default', () => {
                ;(mockPostHog.config as any).logs = { serviceName: 'my-app' }
                logs = new PostHogLogs(mockPostHog)

                logs.captureConsoleLog({ body: 'console' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls.at(-1)?.[0]
                const attrs = Object.fromEntries(
                    call.data.resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
                )
                expect(attrs['service.name']).toEqual({ stringValue: 'my-app' })
            })

            it('drains both queues on a sendBeacon flush, each with its own service.name', () => {
                logs.captureLog({ body: 'programmatic' })
                logs.captureConsoleLog({ body: 'console' })

                logs.flushLogs('sendBeacon')

                const calls = (mockPostHog._send_request as jest.Mock).mock.calls
                const serviceNames = calls.map((c: any[]) => {
                    const attrs = Object.fromEntries(
                        c[0].data.resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
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

                expect(mockPostHog._send_request as jest.Mock).toHaveBeenCalledTimes(1)
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
                ;(mockPostHog.config as any).logs = { captureConsoleLogs: true, maxLogsPerInterval: 50 }
                logs = new PostHogLogs(mockPostHog)
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(() => undefined)

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
                expect(mockPostHog._send_request).not.toHaveBeenCalled()

                assignableWindow.dispatchEvent(new Event('online'))

                expect(mockPostHog._send_request).toHaveBeenCalledTimes(1)
            })

            it('flushes queued console logs when the browser comes back online', () => {
                logs.captureConsoleLog({ body: 'console queued while offline' })
                expect((logs as any)._consoleQueue).toHaveLength(1)
                expect(mockPostHog._send_request).not.toHaveBeenCalled()

                assignableWindow.dispatchEvent(new Event('online'))

                expect(mockPostHog._send_request).toHaveBeenCalledTimes(1)
            })
        })

        describe('flush outcome handling', () => {
            beforeEach(() => {
                jest.useFakeTimers()
            })

            afterEach(() => {
                jest.useRealTimers()
            })

            const flushWith = async (statusCode: number) => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation((opts: any) =>
                    opts.callback?.({ statusCode })
                )
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

            it('settles as retry-later (keeps records) when _send_request never calls back', async () => {
                // Models the callback-less paths (request enqueued before load, or a
                // transport that does not report back). Without the backstop timer the
                // flush promise would never settle and wedge all future flushes.
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(() => undefined)
                logs.captureLog({ body: 'x' })

                const flushPromise = (logs as any)._core.flush().catch(() => {})
                let settled = false
                void flushPromise.then(() => {
                    settled = true
                })

                // The promise must stay pending until the 90s backstop fires, so a
                // queue length of 1 here can't be confused with "no flush ran at all".
                await jest.advanceTimersByTimeAsync(89000)
                expect(settled).toBe(false)
                await jest.advanceTimersByTimeAsync(2000)
                await flushPromise
                expect(settled).toBe(true)

                expect((logs as any)._queue).toHaveLength(1)
            })

            it('keeps records after a timer-driven flush hits a 429', async () => {
                // Drives the real timer-expiry path (not _core.flush() directly) to
                // confirm a transient response requeues end to end.
                ;(mockPostHog._send_request as jest.Mock).mockImplementation((opts: any) =>
                    opts.callback?.({ statusCode: 429 })
                )
                logs.captureLog({ body: 'x' })
                mockLogger.error.mockClear()

                await jest.advanceTimersByTimeAsync(3000)

                expect((logs as any)._queue).toHaveLength(1)
                expect(mockLogger.error).toHaveBeenCalledWith(
                    'PostHog logs flush failed:',
                    expect.objectContaining({ message: 'logs request failed with status 429' })
                )
            })

            it('does not re-log timer-driven transport failures handled by the request layer', async () => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation((opts: any) =>
                    opts.callback?.({ statusCode: 0, error: new TypeError('Failed to fetch') })
                )
                logs.captureLog({ body: 'x' })
                mockLogger.warn.mockClear()
                mockLogger.error.mockClear()

                await jest.advanceTimersByTimeAsync(3000)

                expect((logs as any)._queue).toHaveLength(1)
                expect(mockLogger.warn).not.toHaveBeenCalled()
                expect(mockLogger.error).not.toHaveBeenCalled()
            })

            it('warns once for a bare status-zero logs response', async () => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation((opts: any) =>
                    opts.callback?.({ statusCode: 0 })
                )
                logs.captureLog({ body: 'x' })
                mockLogger.warn.mockClear()
                mockLogger.error.mockClear()

                await jest.advanceTimersByTimeAsync(3000)

                expect(mockLogger.warn).toHaveBeenCalledTimes(1)
                expect(mockLogger.warn).toHaveBeenCalledWith('Logs request failed before receiving an HTTP response')
                expect(mockLogger.error).not.toHaveBeenCalled()
            })

            it.each([400, 500])('keeps HTTP status %s at error severity', async (statusCode) => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation((opts: any) =>
                    opts.callback?.({ statusCode })
                )
                logs.captureLog({ body: 'x' })
                mockLogger.error.mockClear()

                await jest.advanceTimersByTimeAsync(3000)

                expect(mockLogger.error).toHaveBeenCalledWith(
                    'PostHog logs flush failed:',
                    expect.objectContaining({ message: `logs request failed with status ${statusCode}` })
                )
            })

            it('does not re-log handled failures from an explicit flush', async () => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation((opts: any) =>
                    opts.callback?.({ statusCode: 0, error: new TypeError('Failed to fetch') })
                )
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
                const flush = jest.fn().mockRejectedValue(error)
                const core = (logs as any)._core
                ;(logs as any)._core = { flush }
                mockLogger.error.mockClear()

                try {
                    logs.flushLogs()
                    await flush.mock.results[0].value.catch(() => {})
                    await Promise.resolve()

                    expect(mockLogger.error).toHaveBeenCalledWith('PostHog logs flush failed:', error)
                } finally {
                    ;(logs as any)._core = core
                }
            })
        })

        describe('status 0 circuit breaker', () => {
            beforeEach(() => {
                jest.useFakeTimers()
            })

            afterEach(() => {
                jest.useRealTimers()
                delete (window.navigator as any).onLine
            })

            const flushWith = async (statusCode: number) => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation((opts: any) =>
                    opts.callback?.({ statusCode })
                )
                logs.captureLog({ body: 'x' })
                await (logs as any)._core.flush().catch(() => {})
            }

            const sendCount = () => (mockPostHog._send_request as jest.Mock).mock.calls.length

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

            it('does not count pre-init synthetic drops — only post-load failures feed the breaker', async () => {
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
                ;(mockPostHog._send_request as jest.Mock).mockImplementation((opts: any) =>
                    opts.callback?.({ statusCode: 200 })
                )
                assignableWindow.dispatchEvent(new Event('online'))
                expect(sendCount()).toBe(countAfterTrip + 2)
            })

            it('reopens on the online event so recovery is possible', async () => {
                for (let i = 0; i < 4; i++) {
                    await flushWith(0)
                }
                expect(sendCount()).toBe(3) // tripped: the 4th flush made no request

                logs.captureLog({ body: 'after whitelist' })
                assignableWindow.dispatchEvent(new Event('online'))

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
                assignableWindow.dispatchEvent(new Event('online'))

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
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(() => undefined)
                for (let i = 0; i < 3; i++) {
                    logs.captureLog({ body: 'x' })
                    const flushPromise = (logs as any)._core.flush().catch(() => {})
                    await jest.advanceTimersByTimeAsync(91000)
                    await flushPromise
                }
                expect(sendCount()).toBe(3)

                await flushWith(0)

                expect(sendCount()).toBe(4)
            })
        })

        describe('live config resolution', () => {
            beforeEach(() => {
                jest.useFakeTimers()
            })

            afterEach(() => {
                jest.useRealTimers()
            })

            const beaconResourceAttrs = () =>
                Object.fromEntries(
                    (mockPostHog._send_request as jest.Mock).mock.calls
                        .at(-1)![0]
                        .data.resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
                )

            it('honors logs config applied after the extension is constructed', () => {
                // Mirrors the full-bundle init order: the extension is built in the PostHog
                // constructor (no logs config yet), then init applies config via set_config.
                // No reconstruction here — the wrapper must read config at first use.
                ;(mockPostHog.config as any).logs = {
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

            it('picks up logs config changed via set_config after first use', () => {
                logs.captureLog({ body: 'first' })
                logs.flushLogs('sendBeacon')
                expect(beaconResourceAttrs()['service.name']).toEqual({ stringValue: 'unknown_service' })

                // set_config replaces config.logs with a new object reference
                ;(mockPostHog.config as any).logs = { serviceName: 'changed' }
                logs.captureLog({ body: 'second' })
                logs.flushLogs('sendBeacon')
                expect(beaconResourceAttrs()['service.name']).toEqual({ stringValue: 'changed' })
            })

            it('does not double-flush when set_config rebuilds the core mid-buffer', async () => {
                // Defer callbacks so both a (hypothetically) orphaned timer and the
                // new core's timer would have their flushes in flight at once. The
                // rebuild must reset the old core, clearing its armed timer, so only
                // the surviving core POSTs — otherwise both read the same head of the
                // shared queue and double-send.
                const callbacks: Array<(r: any) => void> = []
                ;(mockPostHog._send_request as jest.Mock).mockImplementation((opts: any) => {
                    if (opts.callback) {
                        callbacks.push(opts.callback)
                    }
                })

                logs.captureLog({ body: 'a' }) // arms the first core's flush timer
                ;(mockPostHog.config as any).logs = { serviceName: 'changed' }
                logs.captureLog({ body: 'b' }) // _getCore rebuilds → second core arms its timer

                await jest.advanceTimersByTimeAsync(3000)

                expect(mockPostHog._send_request).toHaveBeenCalledTimes(1)

                // Resolve the in-flight send: the queue drains exactly once.
                callbacks.forEach((cb) => cb({ statusCode: 200 }))
                await Promise.resolve()
                expect((logs as any)._queue).toHaveLength(0)
            })

            it('does not double-flush the console queue when set_config rebuilds the console core', async () => {
                // Same invariant as above, for the console core: a config swap must reset
                // the old console core so its armed timer can't double-send the shared
                // `_consoleQueue`.
                const callbacks: Array<(r: any) => void> = []
                ;(mockPostHog._send_request as jest.Mock).mockImplementation((opts: any) => {
                    if (opts.callback) {
                        callbacks.push(opts.callback)
                    }
                })

                logs.captureConsoleLog({ body: 'a' }) // arms the first console core's timer
                ;(mockPostHog.config as any).logs = { captureConsoleLogs: true, serviceName: 'changed' }
                logs.captureConsoleLog({ body: 'b' }) // _getConsoleCore rebuilds → new timer

                await jest.advanceTimersByTimeAsync(3000)

                expect(mockPostHog._send_request).toHaveBeenCalledTimes(1)

                callbacks.forEach((cb) => cb({ statusCode: 200 }))
                await Promise.resolve()
                expect((logs as any)._consoleQueue).toHaveLength(0)
            })
        })

        describe('reset with captureLog', () => {
            beforeEach(() => {
                jest.useFakeTimers()
            })

            afterEach(() => {
                jest.useRealTimers()
            })

            it('should clear the buffer and cancel pending flush', () => {
                logs.captureLog({ body: 'log 1' })
                logs.captureLog({ body: 'log 2' })
                expect((logs as any)._queue).toHaveLength(2)

                logs.reset()

                expect((logs as any)._queue).toHaveLength(0)

                // Advancing time should not trigger a flush
                jest.advanceTimersByTime(5000)
                expect(mockPostHog._send_request).not.toHaveBeenCalled()
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
                const newLogs = new PostHogLogs(mockPostHog)
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
                expect(mockLoadExternalDependency).toHaveBeenCalledTimes(0)

                logs.onRemoteConfig({ ok: true, config: { ...baseConfig, logs: { captureConsoleLogs: true } } })
                expect(mockLoadExternalDependency).toHaveBeenCalledTimes(1)

                logs.onRemoteConfig({ ok: true, config: { ...baseConfig, logs: { captureConsoleLogs: true } } })
                expect(mockLoadExternalDependency).toHaveBeenCalledTimes(1)

                logs.onRemoteConfig({ ok: true, config: { ...baseConfig, logs: { captureConsoleLogs: false } } })
                expect(mockLoadExternalDependency).toHaveBeenCalledTimes(1)
            })
        })
    })
})
