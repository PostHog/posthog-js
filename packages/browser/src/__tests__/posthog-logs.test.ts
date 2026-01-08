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
                    endpointFor: jest.fn(() => 'https://app.posthog.com'),
                },
                _send_request: jest.fn(),
                get_property: jest.fn(),
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
                    _send_request: jest.fn((_url, _params, callback) => {
                        callback({ statusCode: 200, json: flagsResponse })
                    }),
                    getFeatureFlag: jest.fn((flag) => {
                        return flagsResponse.featureFlags[flag as keyof typeof flagsResponse.featureFlags]
                    }),
                    isFeatureEnabled: jest.fn((flag) => {
                        return !!flagsResponse.featureFlags[flag as keyof typeof flagsResponse.featureFlags]
                    }),
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
