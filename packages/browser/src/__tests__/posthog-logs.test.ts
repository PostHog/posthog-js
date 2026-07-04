import { PostHogLogs } from '../posthog-logs'
import { PostHog } from '../posthog-core'

import { assignableWindow } from '../utils/globals'

// Mock the logger to avoid console output during tests
const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}

jest.mock('../utils/logger', () => ({
    createLogger: jest.fn(() => mockLogger),
}))

describe('posthog-logs', () => {
    describe('PostHogLogs Class', () => {
        let mockPostHog: PostHog
        let logs: PostHogLogs
        let mockInitializeLogs: jest.Mock
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
            mockInitializeLogs = jest.fn()
            mockLoadExternalDependency = jest.fn((_instance, _name, callback) => {
                callback(null) // Simulate successful loading
            })

            // Mock assignableWindow
            Object.defineProperty(assignableWindow, '__PosthogExtensions__', {
                value: {
                    logs: { initializeLogs: mockInitializeLogs },
                    loadExternalDependency: mockLoadExternalDependency,
                },
                writable: true,
                configurable: true,
            })

            // Create mock PostHog instance
            mockPostHog = {
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

                logs.onRemoteConfig(response)

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

                logs.onRemoteConfig(response)

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

                logs.onRemoteConfig(response)

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

                logs.onRemoteConfig(response)

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

                logs.onRemoteConfig(response)

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

                logs.onRemoteConfig(response)

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

                logs.onRemoteConfig(response)
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
                logs.onRemoteConfig(enabledResponse)
                expect((logs as any)._isLogsEnabled).toBe(true)

                // Then disable (should not change the enabled state)
                logs.onRemoteConfig(disabledResponse)
                expect((logs as any)._isLogsEnabled).toBe(true) // Still enabled from first call

                // Enable again
                logs.onRemoteConfig(enabledResponse)
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
                    testLogs.onRemoteConfig(config)
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

                expect(() => logsWithNullPostHog.onRemoteConfig(response)).not.toThrow()
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
                    expect(() => testLogs.onRemoteConfig(response as any)).not.toThrow()
                    expect((testLogs as any)._isLogsEnabled).toBeFalsy()
                })

                // Test null and undefined separately since they can't be spread
                const nullUndefinedResponses = [null, undefined]
                nullUndefinedResponses.forEach((response) => {
                    const testLogs = new PostHogLogs(mockPostHog)
                    expect(() => testLogs.onRemoteConfig(response as any)).toThrow()
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

        describe('console capture instance', () => {
            beforeEach(() => {
                jest.useFakeTimers()
            })

            afterEach(() => {
                jest.useRealTimers()
            })

            it('buffers console captures on a separate queue from programmatic logs', () => {
                logs.captureLog({ body: 'programmatic' })
                logs._captureConsoleLog({ body: 'console' })

                expect((logs as any)._queue).toHaveLength(1)
                expect((logs as any)._consoleQueue).toHaveLength(1)
                expect((logs as any)._queue[0].record.body.stringValue).toBe('programmatic')
                expect((logs as any)._consoleQueue[0].record.body.stringValue).toBe('console')
            })

            it('flushes console captures with service.name posthog-browser-logs', () => {
                logs._captureConsoleLog({ body: 'console' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls.at(-1)?.[0]
                const attrs = Object.fromEntries(
                    call.data.resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
                )
                expect(attrs['service.name']).toEqual({ stringValue: 'posthog-browser-logs' })
            })

            it('flushes console captures under the OTel-parity scope name "console"', () => {
                logs._captureConsoleLog({ body: 'console' })
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
                logs._captureConsoleLog({ body: 'console' })
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
                logs._captureConsoleLog({ body: 'uh oh', level: 'warn' })
                logs._captureConsoleLog({ body: 'boom', level: 'error' })
                jest.advanceTimersByTime(3000)

                const records = (mockPostHog._send_request as jest.Mock).mock.calls.at(-1)?.[0].data.resourceLogs[0]
                    .scopeLogs[0].logRecords
                expect(records[0]).toMatchObject({ severityText: 'WARN', severityNumber: 13 })
                expect(records[1]).toMatchObject({ severityText: 'ERROR', severityNumber: 17 })
            })

            it('lets a user-set serviceName win over the console default', () => {
                ;(mockPostHog.config as any).logs = { serviceName: 'my-app' }
                logs = new PostHogLogs(mockPostHog)

                logs._captureConsoleLog({ body: 'console' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_request as jest.Mock).mock.calls.at(-1)?.[0]
                const attrs = Object.fromEntries(
                    call.data.resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
                )
                expect(attrs['service.name']).toEqual({ stringValue: 'my-app' })
            })

            it('drains both queues on a sendBeacon flush, each with its own service.name', () => {
                logs.captureLog({ body: 'programmatic' })
                logs._captureConsoleLog({ body: 'console' })

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
                logs._captureConsoleLog({ body: 'console' })

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
                    logs._captureConsoleLog({ body: `console ${i}` })
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
                logs._captureConsoleLog({ body: 'console queued while offline' })
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

                await jest.advanceTimersByTimeAsync(3000)

                expect((logs as any)._queue).toHaveLength(1)
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
                Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
                for (let i = 0; i < 3; i++) {
                    await flushWith(0)
                }
                Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })

                await flushWith(0)

                expect(sendCount()).toBe(4)
            })

            it('queues (retry-later) instead of dropping when the breaker is tripped but the browser is offline', async () => {
                // Trip the breaker (3 status-0 failures + 1 flush that is dropped).
                for (let i = 0; i < 3; i++) {
                    await flushWith(0)
                }
                const countAfterTrip = sendCount()
                expect(countAfterTrip).toBe(3) // breaker tripped after 3

                // Go offline — the online guard should bypass the fatal-drop short-circuit.
                Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })

                // Capture + flush with status 0 while tripped AND offline.
                // The send MUST be attempted (online guard lifts the short-circuit).
                await flushWith(0)
                expect(sendCount()).toBe(countAfterTrip + 1) // request was made

                // The batch MUST be retained (offline => retry-later, not fatal).
                expect((logs as any)._queue.length).toBeGreaterThan(0)

                // Restore online — reconnect flush delivers the retained records.
                Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
                ;(mockPostHog._send_request as jest.Mock).mockImplementation((opts: any) =>
                    opts.callback?.({ statusCode: 200 })
                )
                assignableWindow.dispatchEvent(new Event('online'))
                expect(sendCount()).toBeGreaterThan(countAfterTrip + 1)
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

            it('one tripped breaker silences the console queue too — both cores share the endpoint', async () => {
                for (let i = 0; i < 3; i++) {
                    await flushWith(0)
                }

                logs._captureConsoleLog({ body: 'console x' })
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

                logs._captureConsoleLog({ body: 'a' }) // arms the first console core's timer
                ;(mockPostHog.config as any).logs = { captureConsoleLogs: true, serviceName: 'changed' }
                logs._captureConsoleLog({ body: 'b' }) // _getConsoleCore rebuilds → new timer

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
                logs.onRemoteConfig({ ...baseConfig, logs: { captureConsoleLogs: true } })
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

                logs.onRemoteConfig({ ...baseConfig, logs: { captureConsoleLogs: false } })
                expect(mockLoadExternalDependency).toHaveBeenCalledTimes(0)

                logs.onRemoteConfig({ ...baseConfig, logs: { captureConsoleLogs: true } })
                expect(mockLoadExternalDependency).toHaveBeenCalledTimes(1)

                logs.onRemoteConfig({ ...baseConfig, logs: { captureConsoleLogs: true } })
                expect(mockLoadExternalDependency).toHaveBeenCalledTimes(1)

                logs.onRemoteConfig({ ...baseConfig, logs: { captureConsoleLogs: false } })
                expect(mockLoadExternalDependency).toHaveBeenCalledTimes(1)
            })
        })
    })
})
