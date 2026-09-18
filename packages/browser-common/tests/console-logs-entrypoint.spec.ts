import type { Mock } from 'vitest'
/* oxlint-disable compat/compat */
import { initializeLogs } from '../src/console-logs'
import type { ConsoleLogsHost } from '../src/console-logs'

describe('shared console logs', () => {
    let host: ConsoleLogsHost
    let mockEmit: Mock
    const disposers: Array<() => void> = []
    const initialize = () => {
        const dispose = initializeLogs(host)
        disposers.push(dispose)
        return dispose
    }
    beforeEach(() => {
        mockEmit = vi.fn()
        host = {
            console: {
                log: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
            } as unknown as Console,
            hostname: 'example.com',
            getCapturingLogs: () => ({ captureConsoleLog: mockEmit }),
        }
    })
    afterEach(() => {
        disposers
            .splice(0)
            .reverse()
            .forEach((dispose) => dispose())
    })

    describe('log truncation features', () => {
        it('should truncate log body when it exceeds size limit', () => {
            initialize()

            // Create a large string that exceeds LOG_BODY_SIZE_LIMIT (100,000 chars)
            const largeString = 'a'.repeat(10001)

            // Trigger console.log with the large string
            host.console.log(largeString)

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
            initialize()

            host.console.log({
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
            initialize()

            const getterAfterLimit = vi.fn(() => {
                throw new Error('should not be read')
            })
            const objectWithUnreadPropertyAfterLimit: any = {
                largeKey: 'x'.repeat(10001),
            }
            Object.defineProperty(objectWithUnreadPropertyAfterLimit, 'unreadAfterLimit', {
                enumerable: true,
                get: getterAfterLimit,
            })

            expect(() => host.console.log(objectWithUnreadPropertyAfterLimit)).not.toThrow()

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
            initialize()

            const normalString = 'test message'

            host.console.log(normalString)

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
            initialize()

            host.console.log('x'.repeat(10001))
            host.console.log('small message')

            expect(mockEmit.mock.calls[0]![0].attributes).toEqual(
                expect.objectContaining({
                    body_truncated: 'true',
                })
            )
            expect(mockEmit.mock.calls[1]![0]).toEqual(
                expect.objectContaining({
                    body: '"small message"',
                    attributes: expect.not.objectContaining({
                        body_truncated: 'true',
                    }),
                })
            )
        })

        it('should not corrupt truncated strings with escaped characters', () => {
            initialize()

            host.console.log('\\'.repeat(9998))

            const emitted = mockEmit.mock.calls[0]![0]
            expect(emitted.attributes).toEqual(
                expect.objectContaining({
                    body_truncated: 'true',
                })
            )
            expect(() => JSON.parse(emitted.body.slice(0, -3))).not.toThrow()
        })

        it('should handle large objects in body without crashing', () => {
            initialize()

            // Create an object with many keys to test body handling
            const largeObject: Record<string, string> = {}
            for (let i = 0; i < 51; i++) {
                largeObject[`key${i}`] = `value${i}`
            }

            host.console.log(largeObject)

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
            initialize()

            // Create an object with large values
            const largeValueObject = {
                largeKey1: 'x'.repeat(1000),
                largeKey2: 'y'.repeat(2000),
            }

            host.console.log(largeValueObject)

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
            initialize()

            const nestedObject = {
                level1: {
                    level2: {
                        level3: 'deep value',
                    },
                    simple: 'value',
                },
                root: 'root value',
            }

            host.console.log(nestedObject)

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
            initialize()

            const objectWithNullish = {
                message: 'Something went wrong',
                detail: null,
                code: undefined,
                status: 500,
            }

            expect(() => {
                host.console.error(objectWithNullish)
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
            const originalConsoleLog = host.console.log as Mock
            initialize()

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

            expect(() => host.console.log(objectWithUnreadableProperties)).not.toThrow()

            expect(originalConsoleLog).toHaveBeenCalledTimes(1)
            expect(originalConsoleLog.mock.calls[0]![0]).toBe(objectWithUnreadableProperties)
            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: '{"readable":"value"}',
                    attributes: expect.objectContaining({
                        readable: 'value',
                    }),
                })
            )
            expect(mockEmit.mock.calls[0]![0].attributes).not.toHaveProperty('unreadable')
        })

        it('should serialize representative objects without corrupting body or attributes', () => {
            initialize()

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

            host.console.log(payload)

            const emitted = mockEmit.mock.calls[0]![0]
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
            initialize()

            const error = new Error('boom') as Error & { code?: string }
            error.name = 'CustomError'
            error.stack = 'CustomError: boom\n    at test'
            error.code = 'E_BOOM'

            host.console.error(error)

            expect(JSON.parse(mockEmit.mock.calls[0]![0].body)).toEqual({
                code: 'E_BOOM',
                name: 'CustomError',
                message: 'boom',
                stack: 'CustomError: boom\n    at test',
            })
            expect(mockEmit.mock.calls[0]![0].attributes).toEqual(
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
            initialize()

            const payload = {
                toJSON() {
                    return this
                },
            }

            expect(() => host.console.log(payload)).not.toThrow()
            expect(JSON.parse(mockEmit.mock.calls[0]![0].body)).toEqual('[Circular]')
        })

        it('should omit object properties whose toJSON returns non-serializable values', () => {
            initialize()

            host.console.log({
                kept: 'value',
                omitted: {
                    toJSON() {
                        return undefined
                    },
                },
            })

            expect(JSON.parse(mockEmit.mock.calls[0]![0].body)).toEqual({
                kept: 'value',
            })
        })

        it('should serialize boxed primitives like JSON.stringify does', () => {
            initialize()

            host.console.log(new String('abc'), new Number(123), new Boolean(false))

            expect(mockEmit.mock.calls[0]![0].body).toEqual(
                `${JSON.stringify(new String('abc'))} ${JSON.stringify(new Number(123))} ${JSON.stringify(
                    new Boolean(false)
                )}`
            )
        })

        it('should fall back when Object.prototype.toString throws', () => {
            initialize()

            const payload = { kept: 'value' }
            Object.defineProperty(payload, Symbol.toStringTag, {
                get() {
                    throw new Error('cross-origin object tag')
                },
            })

            expect(() => host.console.log(payload)).not.toThrow()
            expect(JSON.parse(mockEmit.mock.calls[0]![0].body)).toEqual({ kept: 'value' })
        })

        it('should not add attributes_truncated when within limits', () => {
            initialize()

            const smallObject = {
                key1: 'value1',
                key2: 'value2',
                nested: {
                    key3: 'value3',
                },
            }

            host.console.log(smallObject)

            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    attributes: expect.not.objectContaining({
                        attributes_truncated: true,
                    }),
                })
            )
        })

        it('should handle mixed content with truncation', () => {
            initialize()

            // Test with multiple arguments including a large string
            const largeString = 'x'.repeat(10001)
            const smallObject = { key: 'value' }

            host.console.log(largeString, smallObject)

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
            initialize()

            const error = new Error('x'.repeat(10001)) // Large error message

            host.console.error(error)

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
        it('still calls the original console method when capture throws', () => {
            const originalConsoleLog = host.console.log as Mock
            mockEmit.mockImplementation(() => {
                throw new Error('capture blew up')
            })
            initialize()

            expect(() => host.console.log('user message')).not.toThrow()
            expect(originalConsoleLog).toHaveBeenCalledWith('user message')
        })
    })

    describe('re-entrancy protection', () => {
        it('exposes the original console method via __rrweb_original__ so the internal logger does not re-enter capture', () => {
            const originalConsoleLog = host.console.log
            initialize()

            expect((host.console.log as any).__rrweb_original__).toBe(originalConsoleLog)
        })

        it('flattens an existing __rrweb_original__ marker while preserving the wrapper chain for user logs', () => {
            const deepestOriginalConsoleLog = vi.fn()
            const firstWrapper = vi.fn()
            const secondWrapper = vi.fn()
            ;(firstWrapper as any).__rrweb_original__ = deepestOriginalConsoleLog
            ;(secondWrapper as any).__rrweb_original__ = firstWrapper
            host.console.log = secondWrapper as any
            initialize()

            expect((host.console.log as any).__rrweb_original__).toBe(deepestOriginalConsoleLog)

            host.console.log('user message')

            expect(secondWrapper).toHaveBeenCalledWith('user message')
        })

        it('does not recurse when the capture path itself logs to the console', () => {
            // Simulate the real fault: the console capture method logs to the wrapped console,
            // as checkAndGetSessionAndWindowId does via PostHog's internal logger.
            mockEmit.mockImplementation(() => {
                host.console.log('internal debug from capture path')
            })
            initialize()

            expect(() => host.console.log('user message')).not.toThrow()
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
                host.console.log('internal debug from capture path')
            })
            initialize()

            host.console.log('first message')
            host.console.log('second message')

            expect(mockEmit).toHaveBeenCalledTimes(2)
            expect(mockEmit.mock.calls[0]![0].body).toBe('"first message"')
            expect(mockEmit.mock.calls[1]![0].body).toBe('"second message"')
        })
    })

    describe('performance tests', () => {
        it('should not take more than 50ms to log a 2MB object with big body', () => {
            // Create a 2MB object with a large body (single large string)
            const largeString = 'x'.repeat(2 * 1024 * 1024) // 2MB string
            const largeBodyObject = { data: largeString }

            initialize()
            // initial log to warm up the jit
            host.console.log(largeBodyObject)

            const wrappedStart = performance.now()
            const iterations = 50
            for (let i = 0; i < iterations; i++) {
                host.console.log(largeBodyObject)
            }
            const wrappedTime = (performance.now() - wrappedStart) / iterations

            expect(wrappedTime).toBeLessThanOrEqual(50)
        })

        it('should not take more than 100ms to log a 2MB object with lots of keys', () => {
            // Create a 2MB object with lots of keys (each key-value pair ~40 bytes)
            const lotsOfKeysObject: Record<string, string> = {}
            const keyValueSize = 40 // approximate size of each key-value pair
            const targetKeys = Math.floor((2 * 1024 * 1024) / keyValueSize) // ~52,428 keys for 2MB

            for (let i = 0; i < targetKeys; i++) {
                lotsOfKeysObject[`key${i.toString().padStart(8, '0')}`] = `value${i.toString().padStart(8, '0')}`
            }

            initialize()
            // initial log to warm up the jit
            host.console.log(lotsOfKeysObject)

            const wrappedStart = performance.now()
            const iterations = 25
            for (let i = 0; i < iterations; i++) {
                host.console.log(lotsOfKeysObject)
            }

            const wrappedTime = (performance.now() - wrappedStart) / iterations

            expect(wrappedTime).toBeLessThanOrEqual(100)
        })

        it('should not take more than 0.1ms to log a small object', () => {
            const smallObject = { key: 'value' }

            initialize()

            // Test wrapped console.log performance
            const wrappedStart = performance.now()
            const iterations = 1000
            for (let i = 0; i < iterations; i++) {
                host.console.log(smallObject)
            }
            const wrappedTime = (performance.now() - wrappedStart) / iterations / 1000

            expect(wrappedTime).toBeLessThanOrEqual(0.1)
        })

        it('should not take more than 0.1ms to log a medium object', () => {
            const mediumObject = { body: 'x'.repeat(1000), key: 'value', key2: 'value2', key3: 'value3' }

            initialize()

            // Test wrapped console.log performance
            const wrappedStart = performance.now()
            const iterations = 1000
            for (let i = 0; i < iterations; i++) {
                host.console.log(mediumObject)
            }
            const wrappedTime = (performance.now() - wrappedStart) / iterations / 1000

            expect(wrappedTime).toBeLessThanOrEqual(0.1)
        })
    })
    describe('re-entrancy across multiple nested logs', () => {
        it('keeps the guard held when a nested log skips capture', () => {
            // The capture path can write to the console more than once; the first nested
            // line must not release the guard while the outer capture is still running.
            mockEmit.mockImplementationOnce(() => {
                host.console.log('internal one')
                host.console.log('internal two')
            })
            initialize()

            host.console.log('user message')

            expect(mockEmit).toHaveBeenCalledTimes(1)
        })
    })
})
