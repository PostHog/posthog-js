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
                _send_retriable_request: jest.fn(),
                get_property: jest.fn(),
                is_capturing: jest.fn(() => true),
                get_distinct_id: jest.fn(() => 'distinct-id-123'),
                sessionManager: {
                    checkAndGetSessionAndWindowId: jest.fn(() => ({
                        sessionId: 'session-abc',
                        windowId: 'window-xyz',
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
            it('should have a reset method that does nothing', () => {
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

                expect((logs as any)._logBuffer).toHaveLength(0)
                expect(mockPostHog._send_retriable_request).not.toHaveBeenCalled()
            })

            it('should warn and skip if no body provided', () => {
                logs.captureLog({} as any)

                expect(mockLogger.warn).toHaveBeenCalledWith('captureLog requires a body')
                expect((logs as any)._logBuffer).toHaveLength(0)
            })

            it('should warn and skip if body is empty string', () => {
                logs.captureLog({ body: '' })

                expect(mockLogger.warn).toHaveBeenCalledWith('captureLog requires a body')
            })

            it('should add a log record to the buffer', () => {
                logs.captureLog({ body: 'test message' })

                expect((logs as any)._logBuffer).toHaveLength(1)
                expect((logs as any)._logBuffer[0].record.body.stringValue).toBe('test message')
            })

            it('should schedule a flush after adding a record', () => {
                logs.captureLog({ body: 'test message' })

                expect((logs as any)._flushTimeout).toBeDefined()
            })

            it('should flush on timer expiry', () => {
                logs.captureLog({ body: 'test message' })

                jest.advanceTimersByTime(3000)

                expect(mockPostHog._send_retriable_request).toHaveBeenCalledTimes(1)
                expect((logs as any)._logBuffer).toHaveLength(0)
            })

            it('should flush immediately when buffer reaches max size', () => {
                for (let i = 0; i < 100; i++) {
                    logs.captureLog({ body: `message ${i}` })
                }

                expect(mockPostHog._send_retriable_request).toHaveBeenCalledTimes(1)
                expect((logs as any)._logBuffer).toHaveLength(0)
            })

            it('should send to the correct URL with token', () => {
                logs.captureLog({ body: 'test' })
                jest.advanceTimersByTime(3000)

                expect(mockPostHog.requestRouter.endpointFor).toHaveBeenCalledWith('api', '/i/v1/logs')
                const call = (mockPostHog._send_retriable_request as jest.Mock).mock.calls[0][0]
                expect(call.url).toContain('token=test-token')
            })

            it('should send OTLP formatted payload', () => {
                logs.captureLog({ body: 'test', level: 'error' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_retriable_request as jest.Mock).mock.calls[0][0]
                expect(call.data.resourceLogs).toBeDefined()
                expect(call.data.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1)
                expect(call.data.resourceLogs[0].scopeLogs[0].logRecords[0].severityText).toBe('ERROR')
            })

            it('should use batchKey "logs" for independent rate limiting', () => {
                logs.captureLog({ body: 'test' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_retriable_request as jest.Mock).mock.calls[0][0]
                expect(call.batchKey).toBe('logs')
            })

            it('should use best-available compression', () => {
                logs.captureLog({ body: 'test' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_retriable_request as jest.Mock).mock.calls[0][0]
                expect(call.compression).toBe('best-available')
            })

            it('should batch multiple logs into one request', () => {
                logs.captureLog({ body: 'log 1' })
                logs.captureLog({ body: 'log 2' })
                logs.captureLog({ body: 'log 3' })
                jest.advanceTimersByTime(3000)

                expect(mockPostHog._send_retriable_request).toHaveBeenCalledTimes(1)
                const call = (mockPostHog._send_retriable_request as jest.Mock).mock.calls[0][0]
                expect(call.data.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(3)
            })

            it('should auto-populate SDK context', () => {
                logs.captureLog({ body: 'test' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_retriable_request as jest.Mock).mock.calls[0][0]
                const record = call.data.resourceLogs[0].scopeLogs[0].logRecords[0]
                const attrs = Object.fromEntries(record.attributes.map((a: any) => [a.key, a.value]))

                expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'distinct-id-123' })
                expect(attrs['sessionId']).toEqual({ stringValue: 'session-abc' })
                expect(attrs['feature_flags']).toEqual({
                    arrayValue: { values: [{ stringValue: 'logs-capture-enabled' }] },
                })
            })

            it('should include named config fields in OTLP resource attributes', () => {
                ;(mockPostHog.config as any).logs = {
                    ...mockPostHog.config.logs,
                    serviceName: 'my-service',
                    serviceVersion: '1.2.3',
                    environment: 'production',
                }
                logs.captureLog({ body: 'test' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_retriable_request as jest.Mock).mock.calls[0][0]
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
                    resourceAttributes: {
                        'service.name': 'from-resource-attrs',
                    },
                }
                logs.captureLog({ body: 'test' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_retriable_request as jest.Mock).mock.calls[0][0]
                const resourceAttrs = call.data.resourceLogs[0].resource.attributes
                const attrsMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))

                expect(attrsMap['service.name']).toEqual({ stringValue: 'from-resource-attrs' })
            })

            it('should use consistent resource attributes across all logs in a batch', () => {
                ;(mockPostHog.config as any).logs = {
                    ...mockPostHog.config.logs,
                    serviceName: 'my-service',
                }
                logs.captureLog({ body: 'log 1' })
                logs.captureLog({ body: 'log 2' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_retriable_request as jest.Mock).mock.calls[0][0]
                const resourceAttrs = call.data.resourceLogs[0].resource.attributes
                const attrsMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))

                expect(attrsMap['service.name']).toEqual({ stringValue: 'my-service' })
                expect(call.data.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(2)
            })

            it('should default service.name to unknown_service when not configured', () => {
                logs.captureLog({ body: 'test' })
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_retriable_request as jest.Mock).mock.calls[0][0]
                const resourceAttrs = call.data.resourceLogs[0].resource.attributes
                const attrsMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))

                expect(attrsMap['service.name']).toEqual({ stringValue: 'unknown_service' })
            })

            it('should not send anything if buffer is empty on flush', () => {
                logs.flushLogs()

                expect(mockPostHog._send_retriable_request).not.toHaveBeenCalled()
            })

            it('should drop logs that exceed maxLogsPerInterval and warn once', () => {
                ;(mockPostHog.config as any).logs = {
                    ...mockPostHog.config.logs,
                    maxLogsPerInterval: 3,
                    maxBufferSize: 1000,
                }

                for (let i = 0; i < 10; i++) {
                    logs.captureLog({ body: `msg ${i}` })
                }

                expect((logs as any)._logBuffer).toHaveLength(3)
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

                logs.captureLog({ body: 'a' })
                logs.captureLog({ body: 'b' })
                logs.captureLog({ body: 'dropped' })
                expect((logs as any)._logBuffer).toHaveLength(2)

                jest.advanceTimersByTime(3001)
                logs.captureLog({ body: 'c' })
                expect((logs as any)._logBuffer.some((e: any) => e.record.body.stringValue === 'c')).toBe(true)
            })

            it('should work without console log autocapture enabled', () => {
                // captureLog works independently of _isLogsEnabled
                expect((logs as any)._isLogsEnabled).toBeFalsy()

                logs.captureLog({ body: 'works without autocapture' })
                jest.advanceTimersByTime(3000)

                expect(mockPostHog._send_retriable_request).toHaveBeenCalledTimes(1)
            })

            it('should support transport override for unload', () => {
                logs.captureLog({ body: 'unload log' })
                logs.flushLogs('sendBeacon')

                const call = (mockPostHog._send_retriable_request as jest.Mock).mock.calls[0][0]
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

                    const call = (mockPostHog._send_retriable_request as jest.Mock).mock.calls[0][0]
                    const record = call.data.resourceLogs[0].scopeLogs[0].logRecords[0]

                    expect(record.body.stringValue).toBe('test message')
                    const attrs = Object.fromEntries(record.attributes.map((a: any) => [a.key, a.value]))
                    expect(attrs.key).toEqual({ stringValue: 'value' })
                }
            )

            it('logger.info() should work without attributes', () => {
                logs.logger.info('no attrs')
                jest.advanceTimersByTime(3000)

                const call = (mockPostHog._send_retriable_request as jest.Mock).mock.calls[0][0]
                const record = call.data.resourceLogs[0].scopeLogs[0].logRecords[0]
                expect(record.body.stringValue).toBe('no attrs')
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
                expect((logs as any)._logBuffer).toHaveLength(2)
                expect((logs as any)._flushTimeout).toBeDefined()

                logs.reset()

                expect((logs as any)._logBuffer).toHaveLength(0)
                expect((logs as any)._flushTimeout).toBeUndefined()

                // Advancing time should not trigger a flush
                jest.advanceTimersByTime(5000)
                expect(mockPostHog._send_retriable_request).not.toHaveBeenCalled()
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
