import { assignableWindow } from '../../utils/globals'
import { PostHog } from '../../posthog-core'

// Mock external OpenTelemetry dependencies
jest.mock('@opentelemetry/api-logs', () => ({
    logs: {
        setGlobalLoggerProvider: jest.fn(),
        getLogger: jest.fn(() => ({
            emit: jest.fn(),
        })),
    },
}))

jest.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
    OTLPLogExporter: jest.fn().mockImplementation(() => ({
        export: jest.fn(),
        shutdown: jest.fn(),
    })),
}))

jest.mock('@opentelemetry/sdk-logs', () => ({
    LoggerProvider: jest.fn().mockImplementation(() => ({
        getLogger: jest.fn(() => ({
            emit: jest.fn(),
        })),
        shutdown: jest.fn(),
    })),
    BatchLogRecordProcessor: jest.fn().mockImplementation(() => ({
        onEmit: jest.fn(),
        shutdown: jest.fn(),
    })),
}))

jest.mock('@opentelemetry/resources', () => ({
    resourceFromAttributes: jest.fn((attrs) => ({
        attributes: attrs,
    })),
}))

describe('logs entrypoint', () => {
    let mockPostHog: PostHog
    let originalConsole: Console
    let mockLogger: any
    let mockEmit: jest.Mock

    beforeEach(() => {
        jest.resetModules()
        jest.clearAllMocks()

        // Store original console
        originalConsole = { ...console }

        // Set up mock logger
        mockEmit = jest.fn()
        mockLogger = { emit: mockEmit }

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { logs } = require('@opentelemetry/api-logs')
        logs.getLogger.mockReturnValue(mockLogger)

        // Mock PostHog instance
        mockPostHog = {
            config: {
                api_host: 'https://app.posthog.com',
                token: 'test-token',
            },
            sessionManager: {
                checkAndGetSessionAndWindowId: jest.fn(() => ({
                    sessionId: 'session-123',
                    windowId: 'window-456',
                    sessionStartTimestamp: new Date('2023-01-01T10:00:00Z'),
                    lastActivityTimestamp: new Date('2023-01-01T10:30:00Z'),
                })),
            },
            get_distinct_id: jest.fn(() => 'user-123'),
        } as unknown as PostHog

        // Mock assignableWindow
        Object.defineProperty(assignableWindow, 'location', {
            value: {
                host: 'example.com',
                href: 'https://example.com/test',
            },
            writable: true,
        })

        Object.defineProperty(assignableWindow, 'console', {
            value: {
                log: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            },
            writable: true,
        })

        // Clear existing extensions
        assignableWindow.__PosthogExtensions__ = {}
    })

    afterEach(() => {
        // Restore console
        Object.assign(console, originalConsole)
    })

    describe('module loading', () => {
        it('should initialize PostHog extensions when imported', () => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')

            expect(assignableWindow.__PosthogExtensions__).toBeDefined()
            expect(assignableWindow.__PosthogExtensions__.logs.initializeLogs).toBeDefined()
            expect(typeof assignableWindow.__PosthogExtensions__.logs.initializeLogs).toBe('function')
        })

        it('should preserve existing PostHog extensions', () => {
            const existingExtension = jest.fn()
            assignableWindow.__PosthogExtensions__ = {
                existingExtension,
            }

            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')

            expect(assignableWindow.__PosthogExtensions__.existingExtension).toBe(existingExtension)
            expect(assignableWindow.__PosthogExtensions__.logs.initializeLogs).toBeDefined()
        })
    })

    describe('initializeLogs function', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
        })

        it('should be available as a PostHog extension', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            expect(initializeLogs).toBeDefined()
            expect(typeof initializeLogs).toBe('function')
        })

        it('should set up OpenTelemetry logging when called', () => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { logs } = require('@opentelemetry/api-logs')
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { LoggerProvider, BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs')
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http')

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            expect(OTLPLogExporter).toHaveBeenCalledWith({
                url: 'https://app.posthog.com/i/v1/logs?token=test-token',
            })
            expect(BatchLogRecordProcessor).toHaveBeenCalled()
            expect(LoggerProvider).toHaveBeenCalled()
            expect(logs.setGlobalLoggerProvider).toHaveBeenCalled()
        })

        it('should wrap all console methods', () => {
            const originalMethods = {
                log: assignableWindow.console.log,
                info: assignableWindow.console.info,
                warn: assignableWindow.console.warn,
                error: assignableWindow.console.error,
                debug: assignableWindow.console.debug,
            }

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            // Console methods should be wrapped (different from originals)
            expect(assignableWindow.console.log).not.toBe(originalMethods.log)
            expect(assignableWindow.console.info).not.toBe(originalMethods.info)
            expect(assignableWindow.console.warn).not.toBe(originalMethods.warn)
            expect(assignableWindow.console.error).not.toBe(originalMethods.error)
            expect(assignableWindow.console.debug).not.toBe(originalMethods.debug)
        })
    })

    describe('console wrapping behavior', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)
        })

        it('should emit logs when console methods are called', () => {
            assignableWindow.console.log('Test message')

            expect(mockEmit).toHaveBeenCalledWith({
                severityText: 'INFO',
                body: '"Test message"',
                attributes: expect.objectContaining({
                    'log.source': 'console.log',
                    distinct_id: 'user-123',
                    'location.href': 'https://example.com/test',
                }),
            })
        })

        it('should use correct severity levels for different console methods', () => {
            const testCases = [
                { method: 'log', expectedSeverity: 'INFO' },
                { method: 'info', expectedSeverity: 'INFO' },
                { method: 'warn', expectedSeverity: 'WARNING' },
                { method: 'error', expectedSeverity: 'ERROR' },
                { method: 'debug', expectedSeverity: 'DEBUG' },
            ] as const

            testCases.forEach(({ method, expectedSeverity }) => {
                mockEmit.mockClear()
                ;(assignableWindow.console[method] as any)(`Test ${method} message`)

                expect(mockEmit).toHaveBeenCalledWith({
                    severityText: expectedSeverity,
                    body: `"Test ${method} message"`,
                    attributes: expect.objectContaining({
                        'log.source': `console.${method}`,
                    }),
                })
            })
        })

        it('should not emit logs when no arguments are provided', () => {
            assignableWindow.console.log()
            expect(mockEmit).not.toHaveBeenCalled()
        })

        it('should handle multiple arguments', () => {
            assignableWindow.console.log('arg1', 'arg2', 123)

            expect(mockEmit).toHaveBeenCalledWith({
                severityText: 'INFO',
                body: '"arg1" "arg2" 123',
                attributes: expect.objectContaining({
                    'log.source': 'console.log',
                }),
            })
        })
    })

    describe('object flattening', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)
        })

        it('should flatten nested objects in first argument', () => {
            const nestedObject = {
                user: {
                    name: 'John',
                    details: {
                        age: 30,
                        location: 'NYC',
                    },
                },
                simple: 'value',
            }

            assignableWindow.console.log(nestedObject)

            expect(mockEmit).toHaveBeenCalledWith({
                severityText: 'INFO',
                body: JSON.stringify(nestedObject),
                attributes: expect.objectContaining({
                    'log.source': 'console.log',
                    'user.name': 'John',
                    'user.details.age': 30,
                    'user.details.location': 'NYC',
                    simple: 'value',
                }),
            })
        })

        it('should only flatten the first argument if it is an object', () => {
            assignableWindow.console.log('string', { nested: { value: 'test' } })

            expect(mockEmit).toHaveBeenCalledWith({
                severityText: 'INFO',
                body: expect.any(String),
                attributes: expect.not.objectContaining({
                    'nested.value': 'test',
                }),
            })
        })
    })

    describe('error handling in logs', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)
        })

        it('should handle Error objects correctly', () => {
            const error = new Error('Test error')
            error.stack = 'Error stack trace'

            assignableWindow.console.error(error)

            expect(mockEmit).toHaveBeenCalledWith({
                severityText: 'ERROR',
                body: expect.stringContaining('Test error'),
                attributes: expect.objectContaining({
                    'log.source': 'console.error',
                    name: 'Error',
                    message: 'Test error',
                    stack: 'Error stack trace',
                }),
            })
        })

        it('should handle custom error objects', () => {
            const customError = {
                name: 'CustomError',
                message: 'Custom error message',
                code: 500,
            }

            assignableWindow.console.error(customError)

            expect(mockEmit).toHaveBeenCalledWith({
                severityText: 'ERROR',
                body: JSON.stringify(customError),
                attributes: expect.objectContaining({
                    'log.source': 'console.error',
                    name: 'CustomError',
                    message: 'Custom error message',
                    code: 500,
                }),
            })
        })
    })

    describe('session information', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
        })

        it('should include session information in resource attributes', () => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { resourceFromAttributes } = require('@opentelemetry/resources')

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            expect(resourceFromAttributes).toHaveBeenCalledWith({
                'service.name': 'posthog-browser-logs',
                host: 'example.com',
                'session.id': 'session-123',
                'window.id': 'window-456',
            })
        })

        it('should include session timestamps in log attributes', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('Test message')

            expect(mockEmit).toHaveBeenCalledWith({
                severityText: 'INFO',
                body: '"Test message"',
                attributes: expect.objectContaining({
                    sessionStartTimestamp: '2023-01-01T10:00:00.000Z',
                    lastActivityTimestamp: '2023-01-01T10:30:00.000Z',
                }),
            })
        })

        it('should work without session manager', () => {
            const postHogWithoutSession = {
                ...mockPostHog,
                sessionManager: null,
            }

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            expect(() => initializeLogs(postHogWithoutSession)).not.toThrow()
        })
    })

    describe('rrweb integration', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
        })

        it('should handle rrweb wrapped console methods', () => {
            const originalLog = jest.fn()
            assignableWindow.console.log = Object.assign(jest.fn(), {
                __rrweb_original__: originalLog,
            })

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('Test message')

            // Should call the rrweb original method
            expect(originalLog).toHaveBeenCalledWith('Test message')
            // Should also emit the log
            expect(mockEmit).toHaveBeenCalled()
        })

        it('should wrap the rrweb original method', () => {
            const originalWarn = jest.fn()
            assignableWindow.console.warn = Object.assign(jest.fn(), {
                __rrweb_original__: originalWarn,
            })

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            // The rrweb original should be wrapped with our log wrapper
            expect(assignableWindow.console.warn.__rrweb_original__).not.toBe(originalWarn)
            expect(typeof assignableWindow.console.warn.__rrweb_original__).toBe('function')
        })
    })

    describe('configuration handling', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
        })

        it('should use PostHog config for exporter URL', () => {
            const customPostHog = {
                ...mockPostHog,
                config: {
                    api_host: 'https://custom.example.com',
                    token: 'custom-token-123',
                },
            }

            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http')
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(customPostHog)

            expect(OTLPLogExporter).toHaveBeenCalledWith({
                url: 'https://custom.example.com/i/v1/logs?token=custom-token-123',
            })
        })

        it('should use current location host in resource attributes', () => {
            Object.defineProperty(assignableWindow, 'location', {
                value: { host: 'different.example.com', href: 'https://different.example.com' },
                writable: true,
            })

            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { resourceFromAttributes } = require('@opentelemetry/resources')
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            expect(resourceFromAttributes).toHaveBeenCalledWith(
                expect.objectContaining({
                    host: 'different.example.com',
                })
            )
        })
    })
})
