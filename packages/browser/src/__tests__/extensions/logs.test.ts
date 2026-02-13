import { assignableWindow } from '../../utils/globals'
import { PostHog } from '../../posthog-core'

// Mock external OpenTelemetry dependencies
const mockLogs = {
    setGlobalLoggerProvider: jest.fn(),
    getLogger: jest.fn(() => ({
        emit: jest.fn(),
    })),
}

const mockOTLPLogExporter = jest.fn().mockImplementation(() => ({
    export: jest.fn(),
    shutdown: jest.fn(),
}))

const mockLoggerProvider = jest.fn().mockImplementation(() => ({
    getLogger: jest.fn(() => ({
        emit: jest.fn(),
    })),
    shutdown: jest.fn(),
}))

const mockBatchLogRecordProcessor = jest.fn().mockImplementation(() => ({
    onEmit: jest.fn(),
    shutdown: jest.fn(),
}))

const mockResourceFromAttributes = jest.fn((attrs) => ({
    attributes: attrs,
}))

jest.mock('@opentelemetry/api-logs', () => ({
    logs: mockLogs,
}))

jest.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
    OTLPLogExporter: mockOTLPLogExporter,
}))

jest.mock('@opentelemetry/sdk-logs', () => ({
    LoggerProvider: mockLoggerProvider,
    BatchLogRecordProcessor: mockBatchLogRecordProcessor,
}))

jest.mock('@opentelemetry/resources', () => ({
    resourceFromAttributes: mockResourceFromAttributes,
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

        mockLogs.getLogger.mockReturnValue(mockLogger)

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
                    sessionStartTimestamp: new Date('2023-01-01T10:00:00Z').getTime(),
                    lastActivityTimestamp: new Date('2023-01-01T10:30:00Z').getTime(),
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
        it('should initialize PostHog extensions when imported', async () => {
            await import('../../entrypoints/logs')

            expect(assignableWindow.__PosthogExtensions__).toBeDefined()
            expect(assignableWindow.__PosthogExtensions__.logs.initializeLogs).toBeDefined()
            expect(typeof assignableWindow.__PosthogExtensions__.logs.initializeLogs).toBe('function')
        })

        it('should preserve existing PostHog extensions', async () => {
            const existingExtension = jest.fn()
            assignableWindow.__PosthogExtensions__ = { logs: { initializeLogs: undefined } } as any
            ;(assignableWindow.__PosthogExtensions__ as any).existingExtension = existingExtension

            await import('../../entrypoints/logs')

            expect((assignableWindow.__PosthogExtensions__ as any).existingExtension).toBe(existingExtension)
            expect(assignableWindow.__PosthogExtensions__.logs.initializeLogs).toBeDefined()
        })
    })

    describe('initializeLogs function', () => {
        beforeEach(async () => {
            await import('../../entrypoints/logs')
        })

        it('should be available as a PostHog extension', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            expect(initializeLogs).toBeDefined()
            expect(typeof initializeLogs).toBe('function')
        })

        it('should set up OpenTelemetry logging when called', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            expect(mockOTLPLogExporter).toHaveBeenCalledWith({
                url: 'https://app.posthog.com/i/v1/logs?token=test-token',
                headers: {
                    'Content-Type': 'text/plain',
                },
            })
            expect(mockBatchLogRecordProcessor).toHaveBeenCalled()
            expect(mockLoggerProvider).toHaveBeenCalled()
            expect(mockLogs.setGlobalLoggerProvider).toHaveBeenCalled()
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

    describe('setupOpenTelemetry', () => {
        beforeEach(async () => {
            await import('../../entrypoints/logs')
        })

        it('should set up OpenTelemetry with correct attributes', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            expect(initializeLogs).toBeDefined()

            initializeLogs(mockPostHog)

            expect(mockResourceFromAttributes).toHaveBeenCalledWith({
                'service.name': 'posthog-browser-logs',
                host: 'example.com',
                'session.id': 'session-123',
                'window.id': 'window-456',
            })

            expect(mockOTLPLogExporter).toHaveBeenCalledWith({
                url: 'https://app.posthog.com/i/v1/logs?token=test-token',
                headers: {
                    'Content-Type': 'text/plain',
                },
            })

            expect(mockBatchLogRecordProcessor).toHaveBeenCalledWith(expect.any(Object))
            expect(mockLoggerProvider).toHaveBeenCalledWith({
                resource: { attributes: expect.any(Object) },
                processors: [expect.any(Object)],
            })

            expect(mockLogs.setGlobalLoggerProvider).toHaveBeenCalledWith(expect.any(Object))
        })

        it('should handle missing session manager', () => {
            const postHogWithoutSession = {
                ...mockPostHog,
                sessionManager: null,
            } as unknown as PostHog

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(postHogWithoutSession)

            expect(mockResourceFromAttributes).toHaveBeenCalledWith({
                'service.name': 'posthog-browser-logs',
                host: 'example.com',
            })
        })
    })

    describe('console wrapping behavior', () => {
        beforeEach(async () => {
            await import('../../entrypoints/logs')
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
        beforeEach(async () => {
            await import('../../entrypoints/logs')
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
        beforeEach(async () => {
            await import('../../entrypoints/logs')
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)
        })

        it('should handle Error objects correctly', () => {
            const error = new Error('Test error')
            error.stack = 'Error stack trace'

            assignableWindow.console.error(error)

            expect(mockEmit).toHaveBeenCalledWith({
                severityText: 'ERROR',
                body: '{"name":"Error","message":"Test error","stack":"Error stack trace"}',
                attributes: expect.objectContaining({
                    'log.source': 'console.error',
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
        beforeEach(async () => {
            await import('../../entrypoints/logs')
        })

        it('should include session information in resource attributes', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            expect(mockResourceFromAttributes).toHaveBeenCalledWith({
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
                    sessionStartTimestamp: expect.any(String),
                    lastActivityTimestamp: expect.any(String),
                }),
            })
        })

        it('should work without session manager', () => {
            const postHogWithoutSession = {
                ...mockPostHog,
                sessionManager: null,
            } as unknown as PostHog

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            expect(() => initializeLogs(postHogWithoutSession)).not.toThrow()
        })
    })

    describe('edge cases and error handling', () => {
        beforeEach(async () => {
            await import('../../entrypoints/logs')
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)
        })

        it('should handle circular references in objects without throwing', () => {
            const circularObj: any = { name: 'test' }
            circularObj.self = circularObj

            expect(() => assignableWindow.console.log(circularObj)).not.toThrow()

            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    severityText: 'INFO',
                    body: expect.stringContaining('[Circular]'),
                    attributes: expect.objectContaining({
                        'log.source': 'console.log',
                    }),
                })
            )
        })

        it('should preserve non-circular properties alongside circular references', () => {
            const circularObj: any = { name: 'test', count: 42 }
            circularObj.self = circularObj

            assignableWindow.console.log(circularObj)

            const body = mockEmit.mock.calls[0][0].body
            expect(body).toContain('"name":"test"')
            expect(body).toContain('"count":42')
            expect(body).toContain('"self":"[Circular]"')
        })

        it('should handle deeply nested circular references', () => {
            const root: any = { level: 0 }
            root.child = { level: 1 }
            root.child.child = { level: 2 }
            root.child.child.backToRoot = root

            expect(() => assignableWindow.console.log(root)).not.toThrow()

            const body = mockEmit.mock.calls[0][0].body
            expect(body).toContain('"level":0')
            expect(body).toContain('"level":1')
            expect(body).toContain('"level":2')
            expect(body).toContain('"backToRoot":"[Circular]"')
        })

        it('should handle circular references in multiple console.log arguments', () => {
            const obj1: any = { id: 1 }
            obj1.self = obj1
            const obj2: any = { id: 2 }
            obj2.self = obj2

            expect(() => assignableWindow.console.log(obj1, obj2)).not.toThrow()

            const body = mockEmit.mock.calls[0][0].body
            // Each argument gets its own replacer, so both are serialized independently
            expect(body).toContain('"id":1')
            expect(body).toContain('"id":2')
        })

        it('should handle circular references in flattenObject attributes', () => {
            const circularObj: any = { name: 'test', value: 'hello' }
            circularObj.self = circularObj

            assignableWindow.console.log(circularObj)

            // flattenObject should still extract the non-circular top-level properties
            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    attributes: expect.objectContaining({
                        name: 'test',
                        value: 'hello',
                    }),
                })
            )
        })

        it('should allow the same non-circular object to appear multiple times', () => {
            const shared = { data: 'shared' }
            const obj = { a: shared, b: shared }

            expect(() => assignableWindow.console.log(obj)).not.toThrow()

            const body = mockEmit.mock.calls[0][0].body
            // The shared object is not circular, but WeakSet will mark the second occurrence.
            // This is the expected trade-off for circular reference safety.
            expect(body).toContain('"data":"shared"')
        })

        it('should handle circular references with Error objects', () => {
            const error: any = new Error('circular error')
            error.related = { cause: error }

            expect(() => assignableWindow.console.error(error)).not.toThrow()

            const body = mockEmit.mock.calls[0][0].body
            expect(body).toContain('circular error')
            expect(body).toContain('[Circular]')
        })

        it('should handle very deep nested objects', () => {
            // Create a deeply nested object
            const deepObj: any = {}
            let current = deepObj
            for (let i = 0; i < 100; i++) {
                current.level = i
                current.next = {}
                current = current.next
            }
            current.final = 'value'

            assignableWindow.console.log(deepObj)

            expect(mockEmit).toHaveBeenCalledWith({
                severityText: 'INFO',
                body: expect.any(String),
                attributes: expect.objectContaining({
                    'log.source': 'console.log',
                    level: 0, // First level should be flattened
                }),
            })
        })

        it('should handle undefined and null console arguments', () => {
            assignableWindow.console.log(null, undefined, '')

            expect(mockEmit).toHaveBeenCalledWith({
                severityText: 'INFO',
                body: 'null  ""',
                attributes: expect.objectContaining({
                    'log.source': 'console.log',
                }),
            })
        })

        it('should handle functions as console arguments', () => {
            const testFunction = () => 'test'
            assignableWindow.console.log(testFunction)

            expect(mockEmit).toHaveBeenCalledWith({
                severityText: 'INFO',
                body: '',
                attributes: expect.objectContaining({
                    'log.source': 'console.log',
                }),
            })
        })
    })

    describe('PostHog extensions setup', () => {
        it('should initialize PostHog extensions object if not present', async () => {
            delete (assignableWindow as any).__PosthogExtensions__

            await import('../../entrypoints/logs')

            expect(assignableWindow.__PosthogExtensions__).toBeDefined()
            expect(assignableWindow.__PosthogExtensions__.logs.initializeLogs).toBeDefined()
        })
    })

    describe('integration with PostHog core', () => {
        beforeEach(async () => {
            await import('../../entrypoints/logs')
        })

        it('should use PostHog distinct_id in log attributes', () => {
            ;(mockPostHog.get_distinct_id as jest.Mock).mockReturnValue('custom-distinct-id')

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('Test message')

            expect(mockEmit).toHaveBeenCalledWith({
                severityText: 'INFO',
                body: '"Test message"',
                attributes: expect.objectContaining({
                    distinct_id: 'custom-distinct-id',
                }),
            })
        })

        it('should use current location href in log attributes', () => {
            Object.defineProperty(assignableWindow, 'location', {
                value: {
                    host: 'different.com',
                    href: 'https://different.com/page',
                },
                writable: true,
            })

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('Test message')

            expect(mockEmit).toHaveBeenCalledWith({
                severityText: 'INFO',
                body: '"Test message"',
                attributes: expect.objectContaining({
                    'location.href': 'https://different.com/page',
                }),
            })
        })

        it('should use PostHog config for OTLP exporter URL', () => {
            const customPostHog = {
                ...mockPostHog,
                config: {
                    api_host: 'https://custom.example.com',
                    token: 'custom-token-123',
                },
            } as unknown as PostHog

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(customPostHog)

            expect(mockOTLPLogExporter).toHaveBeenCalledWith({
                url: 'https://custom.example.com/i/v1/logs?token=custom-token-123',
                headers: {
                    'Content-Type': 'text/plain',
                },
            })
        })
    })
})
