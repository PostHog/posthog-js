import { assignableWindow } from '../../utils/globals'
import { PostHog } from '../../posthog-core'
import { PostHogLogs } from '../../posthog-logs'
import { patch as rrwebPatch } from '@posthog/rrweb-utils'
import { LOGS_CAPTURE_ENABLED_SERVER_SIDE } from '../../constants'
import type { Client } from '@posthog/browser-common'

describe('logs entrypoint', () => {
    let mockPostHog: PostHog
    let originalConsole: Console
    // Legacy PostHog capture routes through its historical console capture ABI.
    let mockEmit: jest.Mock

    beforeEach(() => {
        jest.resetModules()
        jest.clearAllMocks()

        // Store original console
        originalConsole = { ...console }

        // Set up capture spy
        mockEmit = jest.fn()

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
            is_capturing: jest.fn(() => true),
            version: '1.392.0',
            logs: { le: mockEmit },
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

    describe('core capture routing', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
        })

        it('routes legacy PostHog capture through its historical console method with the mapped level', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.warn('uh oh')

            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'warn',
                    body: '"uh oh"',
                    attributes: expect.objectContaining({
                        'log.source': 'console.warn',
                    }),
                })
            )
        })

        it('does not set distinct_id or location.href — core adds posthogDistinctId/url.full downstream', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('hello')

            const attributes = mockEmit.mock.calls[0][0].attributes
            expect(attributes).not.toHaveProperty('distinct_id')
            expect(attributes).not.toHaveProperty('location.href')
        })

        it('sets host on the captured record', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('hello')

            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    attributes: expect.objectContaining({ host: 'example.com' }),
                })
            )
        })

        it.each(['window.id', 'sessionStartTimestamp', 'lastActivityTimestamp'])(
            'does not set %s — core adds session attributes from the SDK context downstream',
            (attribute) => {
                const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
                initializeLogs(mockPostHog)

                assignableWindow.console.log('hello')

                expect(mockEmit.mock.calls[0][0].attributes).not.toHaveProperty(attribute)
            }
        )
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

        it('should preserve bounded attributes when the log body is truncated', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log({
                code: 'E_TOO_LARGE',
                userId: 'user-123',
                payload: 'x'.repeat(10001),
            })

            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.stringContaining('...'),
                    attributes: expect.objectContaining({
                        body_truncated: 'true',
                        code: 'E_TOO_LARGE',
                        userId: 'user-123',
                    }),
                })
            )
        })

        it('should not read object properties after the body size limit is reached', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            const getterAfterLimit = jest.fn(() => {
                throw new Error('should not be read')
            })
            const objectWithUnreadPropertyAfterLimit: any = {
                largeKey: 'x'.repeat(10001),
            }
            Object.defineProperty(objectWithUnreadPropertyAfterLimit, 'unreadAfterLimit', {
                enumerable: true,
                get: getterAfterLimit,
            })

            expect(() => assignableWindow.console.log(objectWithUnreadPropertyAfterLimit)).not.toThrow()

            expect(getterAfterLimit).not.toHaveBeenCalled()
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

        it('should not leak body truncation state to subsequent logs', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('x'.repeat(10001))
            assignableWindow.console.log('small message')

            expect(mockEmit.mock.calls[0][0].attributes).toEqual(
                expect.objectContaining({
                    body_truncated: 'true',
                })
            )
            expect(mockEmit.mock.calls[1][0]).toEqual(
                expect.objectContaining({
                    body: '"small message"',
                    attributes: expect.not.objectContaining({
                        body_truncated: 'true',
                    }),
                })
            )
        })

        it('should not corrupt truncated strings with escaped characters', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('\\'.repeat(9998))

            const emitted = mockEmit.mock.calls[0][0]
            expect(emitted.attributes).toEqual(
                expect.objectContaining({
                    body_truncated: 'true',
                })
            )
            expect(() => JSON.parse(emitted.body.slice(0, -3))).not.toThrow()
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

        it('should omit unreadable properties when logging', () => {
            const originalConsoleLog = assignableWindow.console.log as jest.Mock
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            const objectWithUnreadableProperties: any = {}
            Object.defineProperty(objectWithUnreadableProperties, 'toJSON', {
                get() {
                    throw new Error('SecurityError')
                },
            })
            Object.defineProperty(objectWithUnreadableProperties, 'unreadable', {
                enumerable: true,
                get() {
                    throw new Error('SecurityError')
                },
            })
            objectWithUnreadableProperties.readable = 'value'

            expect(() => assignableWindow.console.log(objectWithUnreadableProperties)).not.toThrow()

            expect(originalConsoleLog).toHaveBeenCalledWith(objectWithUnreadableProperties)
            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: '{"readable":"value"}',
                    attributes: expect.objectContaining({
                        readable: 'value',
                    }),
                })
            )
            expect(mockEmit.mock.calls[0][0].attributes).not.toHaveProperty('unreadable')
        })

        it('should serialize representative objects without corrupting body or attributes', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            const payload: any = {
                message: 'hello "quoted"\nline',
                nested: {
                    enabled: true,
                    count: 2,
                    empty: null,
                },
                list: ['first', undefined, () => 'ignored', Symbol('ignored'), null],
                createdAt: new Date('2023-01-02T03:04:05.000Z'),
            }
            payload.self = payload

            assignableWindow.console.log(payload)

            const emitted = mockEmit.mock.calls[0][0]
            expect(JSON.parse(emitted.body)).toEqual({
                message: 'hello "quoted"\nline',
                nested: {
                    enabled: true,
                    count: 2,
                    empty: null,
                },
                list: ['first', null, null, null, null],
                createdAt: '2023-01-02T03:04:05.000Z',
                self: '[Circular]',
            })
            expect(emitted.attributes).toEqual(
                expect.objectContaining({
                    message: 'hello "quoted"\nline',
                    'nested.enabled': true,
                    'nested.count': 2,
                    'nested.empty': null,
                    self: '[Circular]',
                })
            )
        })

        it('should serialize Error objects with their details intact', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            const error = new Error('boom') as Error & { code?: string }
            error.name = 'CustomError'
            error.stack = 'CustomError: boom\n    at test'
            error.code = 'E_BOOM'

            assignableWindow.console.error(error)

            expect(JSON.parse(mockEmit.mock.calls[0][0].body)).toEqual({
                code: 'E_BOOM',
                name: 'CustomError',
                message: 'boom',
                stack: 'CustomError: boom\n    at test',
            })
            expect(mockEmit.mock.calls[0][0].attributes).toEqual(
                expect.objectContaining({
                    'log.source': 'console.error',
                    code: 'E_BOOM',
                    name: 'CustomError',
                    message: 'boom',
                    stack: 'CustomError: boom\n    at test',
                })
            )
        })

        it('should handle toJSON returning itself without recursing forever', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            const payload = {
                toJSON() {
                    return this
                },
            }

            expect(() => assignableWindow.console.log(payload)).not.toThrow()
            expect(JSON.parse(mockEmit.mock.calls[0][0].body)).toEqual('[Circular]')
        })

        it('should omit object properties whose toJSON returns non-serializable values', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log({
                kept: 'value',
                omitted: {
                    toJSON() {
                        return undefined
                    },
                },
            })

            expect(JSON.parse(mockEmit.mock.calls[0][0].body)).toEqual({
                kept: 'value',
            })
        })

        it('should serialize boxed primitives like JSON.stringify does', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log(new String('abc'), new Number(123), new Boolean(false))

            expect(mockEmit.mock.calls[0][0].body).toEqual(
                `${JSON.stringify(new String('abc'))} ${JSON.stringify(new Number(123))} ${JSON.stringify(
                    new Boolean(false)
                )}`
            )
        })

        it('should fall back when Object.prototype.toString throws', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            const payload = { kept: 'value' }
            Object.defineProperty(payload, Symbol.toStringTag, {
                get() {
                    throw new Error('cross-origin object tag')
                },
            })

            expect(() => assignableWindow.console.log(payload)).not.toThrow()
            expect(JSON.parse(mockEmit.mock.calls[0][0].body)).toEqual({ kept: 'value' })
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

    describe('console output safety', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
        })

        it('still calls the original console method when capture throws', () => {
            const originalConsoleLog = assignableWindow.console.log as jest.Mock
            mockEmit.mockImplementation(() => {
                throw new Error('capture blew up')
            })

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            expect(() => assignableWindow.console.log('user message')).not.toThrow()
            expect(originalConsoleLog).toHaveBeenCalledWith('user message')
        })
    })

    describe('re-entrancy protection', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
        })

        it('exposes the original console method via __rrweb_original__ so the internal logger does not re-enter capture', () => {
            const originalConsoleLog = assignableWindow.console.log
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            expect((assignableWindow.console.log as any).__rrweb_original__).toBe(originalConsoleLog)
        })

        it('flattens an existing __rrweb_original__ marker while preserving the wrapper chain for user logs', () => {
            const deepestOriginalConsoleLog = jest.fn()
            const firstWrapper = jest.fn()
            const secondWrapper = jest.fn()
            ;(firstWrapper as any).__rrweb_original__ = deepestOriginalConsoleLog
            ;(secondWrapper as any).__rrweb_original__ = firstWrapper
            assignableWindow.console.log = secondWrapper as any

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            expect((assignableWindow.console.log as any).__rrweb_original__).toBe(deepestOriginalConsoleLog)

            assignableWindow.console.log('user message')

            expect(secondWrapper).toHaveBeenCalledWith('user message')
        })

        it('does not recurse when the capture path itself logs to the console', () => {
            // Simulate the real fault: the console capture method logs to the wrapped console,
            // as checkAndGetSessionAndWindowId does via PostHog's internal logger.
            mockEmit.mockImplementation(() => {
                assignableWindow.console.log('internal debug from capture path')
            })

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            expect(() => assignableWindow.console.log('user message')).not.toThrow()
            // The user's log is captured once; the nested internal log is not re-captured.
            expect(mockEmit).toHaveBeenCalledTimes(1)
            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: '"user message"',
                })
            )
        })

        it('resumes capturing after a nested log completes', () => {
            mockEmit.mockImplementationOnce(() => {
                assignableWindow.console.log('internal debug from capture path')
            })

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('first message')
            assignableWindow.console.log('second message')

            expect(mockEmit).toHaveBeenCalledTimes(2)
            expect(mockEmit.mock.calls[0][0].body).toBe('"first message"')
            expect(mockEmit.mock.calls[1][0].body).toBe('"second message"')
        })
    })

    describe('consent / opt-out handling', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
        })

        it('should not emit logs when capturing is opted out', () => {
            const originalConsoleLog = assignableWindow.console.log as jest.Mock
            ;(mockPostHog.is_capturing as jest.Mock).mockReturnValue(false)

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('should not be captured')

            expect(mockEmit).not.toHaveBeenCalled()
            // the original console method must still be called so local output isn't suppressed
            expect(originalConsoleLog).toHaveBeenCalledWith('should not be captured')
        })

        it('should resume emitting once capturing is opted back in', () => {
            const isCapturing = mockPostHog.is_capturing as jest.Mock
            isCapturing.mockReturnValue(false)

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('while opted out')
            expect(mockEmit).not.toHaveBeenCalled()

            isCapturing.mockReturnValue(true)
            assignableWindow.console.log('after opt back in')

            expect(mockEmit).toHaveBeenCalledTimes(1)
            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: '"after opt back in"',
                })
            )
        })

        it('should check capturing status on every log, not just at init', () => {
            const isCapturing = mockPostHog.is_capturing as jest.Mock

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('captured')
            expect(mockEmit).toHaveBeenCalledTimes(1)

            isCapturing.mockReturnValue(false)
            assignableWindow.console.log('not captured')
            expect(mockEmit).toHaveBeenCalledTimes(1)
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
    describe('re-entrancy across multiple nested logs', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
        })

        it('keeps the guard held when a nested log skips capture', () => {
            // The capture path can write to the console more than once; the first nested
            // line must not release the guard while the outer capture is still running.
            mockEmit.mockImplementationOnce(() => {
                assignableWindow.console.log('internal one')
                assignableWindow.console.log('internal two')
            })
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('user message')

            expect(mockEmit).toHaveBeenCalledTimes(1)
        })
    })

    describe('teardown under another console wrapper', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
        })

        it('splices itself out when a later wrapper sits on top', () => {
            const realLog = assignableWindow.console.log as jest.Mock
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            const dispose = initializeLogs(mockPostHog)
            const ourWrapper = assignableWindow.console.log

            // Session replay's console plugin, or any other library, wrapping after us.
            rrwebPatch(
                assignableWindow.console,
                'log',
                (next: any) =>
                    (...args: any[]) =>
                        next.apply(assignableWindow.console, args)
            )
            const outerLayer = (assignableWindow.console.log as any).__rrweb_layer__
            expect(outerLayer.next).toBe(ourWrapper)

            dispose()

            expect(outerLayer.next).toBe(realLog)
            realLog.mockClear()
            assignableWindow.console.log('after teardown')
            expect(realLog).toHaveBeenCalledTimes(1)
        })
    })

    describe('handover from the main-bundle console recorder', () => {
        // Runs the real recorder against the real entrypoint wrapper — mocking either
        // side hides whether the handover leaves the console chain clean.
        // The entrypoint reaches capture through `getCapturingLogs`, which uses the
        // Client path; `loadIfEnabled` hands it `this._client`, so drive it the same way.
        const noopClient = () =>
            ({
                onRemoteConfig: jest.fn(() => ({ dispose: jest.fn() })),
                canCapture: true,
                getExtension: () => (mockPostHog as any).logs,
            }) as unknown as Client
        let logs: PostHogLogs
        let realConsoleLog: jest.Mock
        let capturedBuffered: jest.Mock

        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')

            realConsoleLog = assignableWindow.console.log as jest.Mock
            capturedBuffered = jest.fn()
            ;(mockPostHog as any).config = { logs: {} }
            ;(mockPostHog as any).persistence = {
                register: jest.fn(),
                props: { [LOGS_CAPTURE_ENABLED_SERVER_SIDE]: true },
            }
            ;(mockPostHog as any).logs = {
                captureConsoleLog: mockEmit,
                captureBufferedConsoleLog: capturedBuffered,
            }
            assignableWindow.__PosthogExtensions__.loadExternalDependency = jest.fn(
                (_instance: any, _name: any, callback: any) => callback(null)
            ) as any

            logs = new PostHogLogs(mockPostHog)
        })

        afterEach(() => {
            logs?.reset()
        })

        it('removes the temporary recorder from the console chain once the entrypoint takes over', () => {
            logs.setup(noopClient())
            expect((logs as any)._isRecordingConsole).toBe(true)
            const recorder: any = assignableWindow.console.log
            expect(recorder.__posthog_layer__).toBeDefined()

            logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: true } } } as any)

            expect((logs as any)._isRecordingConsole).toBe(false)
            // The entrypoint's wrapper now sits directly on the real console: the
            // recorder is neither on top of the chain nor buried inside it.
            const wrapper: any = assignableWindow.console.log
            expect(wrapper).not.toBe(recorder)
            expect(wrapper.__rrweb_original__).toBe(realConsoleLog)
            expect(recorder.__posthog_layer__.next).toBe(realConsoleLog)

            let recorderRan = false
            recorder.__posthog_layer__.next = () => {
                recorderRan = true
            }
            assignableWindow.console.log('after handover')
            expect(recorderRan).toBe(false)
        })

        it('writes to the real console once and captures once after handover', () => {
            logs.setup(noopClient())
            logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: true } } } as any)

            realConsoleLog.mockClear()
            mockEmit.mockClear()

            assignableWindow.console.log('live message')

            expect(realConsoleLog).toHaveBeenCalledTimes(1)
            expect(mockEmit).toHaveBeenCalledTimes(1)
        })

        it.each(['debug', 'log', 'warn', 'error', 'info'] as const)(
            'maps a buffered console.%s to its log severity',
            (level) => {
                logs.setup(noopClient())
                ;(assignableWindow.console[level] as any)('early')

                logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: true } } } as any)

                const [options] = capturedBuffered.mock.calls[0]
                expect(options.attributes['log.source']).toBe(`console.${level}`)
                expect(options.level).toBe(
                    { debug: 'debug', log: 'info', warn: 'warn', error: 'error', info: 'info' }[level]
                )
            }
        )

        it('keeps replaying after one entry fails to capture', () => {
            logs.setup(noopClient())
            assignableWindow.console.log('first')
            assignableWindow.console.log('second')
            assignableWindow.console.log('third')

            capturedBuffered.mockImplementation((options: any) => {
                if (options.body.includes('second')) {
                    throw new Error('capture blew up')
                }
            })

            logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: true } } } as any)

            expect(capturedBuffered.mock.calls.map((c: any[]) => c[0].body)).toEqual([
                expect.stringContaining('first'),
                expect.stringContaining('second'),
                expect.stringContaining('third'),
            ])
        })

        it('replays a buffered entry stamped at the console call, not at the handover', () => {
            const nowSpy = jest.spyOn(Date, 'now')
            try {
                logs.setup(noopClient())
                nowSpy.mockReturnValue(1700000000000)
                assignableWindow.console.log('early')
                nowSpy.mockReturnValue(1700000005000)

                logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: true } } } as any)

                const [, , occurredAtMs] = capturedBuffered.mock.calls[0]
                expect(occurredAtMs).toBe(1700000000000)
            } finally {
                nowSpy.mockRestore()
            }
        })

        it('replays a buffered entry through the entrypoint serializer with its captured context', () => {
            logs.setup(noopClient())

            const cyclic: any = { name: 'early' }
            cyclic.self = cyclic
            assignableWindow.console.log('early', cyclic)

            const entry = (logs as any)._consoleBuffer[0]
            expect(entry.context).toEqual(expect.objectContaining({ distinctId: 'user-123', sessionId: 'session-123' }))

            // A later identify must not re-stamp the buffered entry.
            ;(mockPostHog.get_distinct_id as jest.Mock).mockReturnValue('identified-456')

            logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: true } } } as any)

            expect(capturedBuffered).toHaveBeenCalledTimes(1)
            const [options, context, occurredAtMs] = capturedBuffered.mock.calls[0]
            expect(options.attributes['log.source']).toBe('console.log')
            expect(options.body).toContain('early')
            // The entrypoint's serializer, not a second copy in the main bundle.
            expect(options.body).toContain('[Circular]')
            expect(context.distinctId).toBe('user-123')
            expect(occurredAtMs).toBe(entry.occurredAtMs)
        })
    })
})
