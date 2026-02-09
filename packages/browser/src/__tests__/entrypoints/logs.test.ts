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
                headers: {
                    'Content-Type': 'text/plain',
                },
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

    describe('log truncation features', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
        })

        it('should truncate log body when it exceeds size limit', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            // Create a large string that exceeds LOG_BODY_SIZE_LIMIT (100,000 chars)
            const largeString = 'a'.repeat(10001)

            // Trigger console.log with the large string
            assignableWindow.console.log(largeString)

            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.stringContaining('...'),
                    attributes: expect.objectContaining({
                        body_truncated: 'true',
                    }),
                })
            )
        })

        it('should not truncate log body when within size limit', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            const normalString = 'test message'

            assignableWindow.console.log(normalString)

            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: '"test message"',
                    attributes: expect.not.objectContaining({
                        body_truncated: 'true',
                    }),
                })
            )
        })

        it('should handle large objects in body without crashing', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            // Create an object with many keys to test body handling
            const largeObject: Record<string, string> = {}
            for (let i = 0; i < 51; i++) {
                largeObject[`key${i}`] = `value${i}`
            }

            assignableWindow.console.log(largeObject)

            // Verify that the call was made and includes the object data in the body
            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.stringContaining('value0'),
                    attributes: expect.objectContaining({
                        'log.source': 'console.log',
                    }),
                })
            )
        })

        it('should handle objects with large values in body without crashing', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            // Create an object with large values
            const largeValueObject = {
                largeKey1: 'x'.repeat(1000),
                largeKey2: 'y'.repeat(2000),
            }

            assignableWindow.console.log(largeValueObject)

            // Verify that the call was made
            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.stringContaining('largeKey1'),
                    attributes: expect.objectContaining({
                        'log.source': 'console.log',
                    }),
                })
            )
        })

        it('should handle nested objects in flattenObject correctly', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            const nestedObject = {
                level1: {
                    level2: {
                        level3: 'deep value',
                    },
                    simple: 'value',
                },
                root: 'root value',
            }

            assignableWindow.console.log(nestedObject)

            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    attributes: expect.objectContaining({
                        'level1.level2.level3': 'deep value',
                        'level1.simple': 'value',
                        root: 'root value',
                    }),
                })
            )
        })

        it('should handle objects with null and undefined values without crashing', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            const objectWithNullish = {
                message: 'Something went wrong',
                detail: null,
                code: undefined,
                status: 500,
            }

            expect(() => {
                assignableWindow.console.error(objectWithNullish)
            }).not.toThrow()

            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    attributes: expect.objectContaining({
                        message: 'Something went wrong',
                        detail: null,
                        code: undefined,
                        status: 500,
                    }),
                })
            )
        })

        it('should not add attributes_truncated when within limits', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            const smallObject = {
                key1: 'value1',
                key2: 'value2',
                nested: {
                    key3: 'value3',
                },
            }

            assignableWindow.console.log(smallObject)

            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    attributes: expect.not.objectContaining({
                        attributes_truncated: true,
                    }),
                })
            )
        })

        it('should handle mixed content with truncation', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            // Test with multiple arguments including a large string
            const largeString = 'x'.repeat(10001)
            const smallObject = { key: 'value' }

            assignableWindow.console.log(largeString, smallObject)

            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.stringContaining('...'), // Body should be truncated
                    attributes: expect.objectContaining({
                        body_truncated: 'true',
                    }),
                })
            )
        })

        it('should handle Error objects properly in truncation', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            const error = new Error('x'.repeat(10001)) // Large error message

            assignableWindow.console.error(error)

            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.stringContaining('...'), // Should be truncated
                    attributes: expect.objectContaining({
                        body_truncated: 'true',
                    }),
                })
            )
        })
    })

    describe('performance tests', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
        })

        it('should not take more than 50ms to log a 2MB object with big body', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs

            // Create a 2MB object with a large body (single large string)
            const largeString = 'x'.repeat(2 * 1024 * 1024) // 2MB string
            const largeBodyObject = { data: largeString }

            initializeLogs(mockPostHog)
            // initial log to warm up the jit
            assignableWindow.console.log(largeBodyObject)

            const wrappedStart = performance.now()
            const iterations = 50
            for (let i = 0; i < iterations; i++) {
                assignableWindow.console.log(largeBodyObject)
            }
            const wrappedTime = (performance.now() - wrappedStart) / iterations

            expect(wrappedTime).toBeLessThanOrEqual(50)

            console.log(`Performance test (big body): wrapped=${wrappedTime.toFixed(2)}ms`)
        })

        it('should not take more than 100ms to log a 2MB object with lots of keys', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs

            // Create a 2MB object with lots of keys (each key-value pair ~40 bytes)
            const lotsOfKeysObject: Record<string, string> = {}
            const keyValueSize = 40 // approximate size of each key-value pair
            const targetKeys = Math.floor((2 * 1024 * 1024) / keyValueSize) // ~52,428 keys for 2MB

            for (let i = 0; i < targetKeys; i++) {
                lotsOfKeysObject[`key${i.toString().padStart(8, '0')}`] = `value${i.toString().padStart(8, '0')}`
            }

            initializeLogs(mockPostHog)
            // initial log to warm up the jit
            assignableWindow.console.log(lotsOfKeysObject)

            const wrappedStart = performance.now()
            const iterations = 25
            for (let i = 0; i < iterations; i++) {
                assignableWindow.console.log(lotsOfKeysObject)
            }

            const wrappedTime = (performance.now() - wrappedStart) / iterations

            expect(wrappedTime).toBeLessThanOrEqual(100)

            console.log(`Performance test (big body): wrapped=${wrappedTime.toFixed(2)}ms`)
        })

        it('should not take more than 0.1ms to log a small object', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs

            const smallObject = { key: 'value' }

            initializeLogs(mockPostHog)

            // Test wrapped console.log performance
            const wrappedStart = performance.now()
            const iterations = 1000
            for (let i = 0; i < iterations; i++) {
                assignableWindow.console.log(smallObject)
            }
            const wrappedTime = (performance.now() - wrappedStart) / iterations / 1000

            expect(wrappedTime).toBeLessThanOrEqual(0.1)

            console.log(`Performance test (small object): wrapped=${wrappedTime.toFixed(2)}ms`)
        })

        it('should not take more than 0.1ms to log a medium object', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs

            const mediumObject = { body: 'x'.repeat(1000), key: 'value', key2: 'value2', key3: 'value3' }

            initializeLogs(mockPostHog)

            // Test wrapped console.log performance
            const wrappedStart = performance.now()
            const iterations = 1000
            for (let i = 0; i < iterations; i++) {
                assignableWindow.console.log(mediumObject)
            }
            const wrappedTime = (performance.now() - wrappedStart) / iterations / 1000

            expect(wrappedTime).toBeLessThanOrEqual(0.1)

            console.log(`Performance test (small object): wrapped=${wrappedTime.toFixed(2)}ms`)
        })
    })
})
