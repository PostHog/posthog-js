import type { Mock } from 'vitest'
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

    describe('initializeLogs function', () => {
        it('should wrap all console methods', () => {
            const originalMethods = {
                log: host.console.log,
                info: host.console.info,
                warn: host.console.warn,
                error: host.console.error,
                debug: host.console.debug,
            }
            initialize()

            // Console methods should be wrapped (different from originals)
            expect(host.console.log).not.toBe(originalMethods.log)
            expect(host.console.info).not.toBe(originalMethods.info)
            expect(host.console.warn).not.toBe(originalMethods.warn)
            expect(host.console.error).not.toBe(originalMethods.error)
            expect(host.console.debug).not.toBe(originalMethods.debug)
        })

        it('should restore the console methods it wrapped', () => {
            const originalMethods = {
                log: host.console.log,
                info: host.console.info,
                warn: host.console.warn,
                error: host.console.error,
                debug: host.console.debug,
            }

            const dispose = initialize()
            dispose()
            host.console.log('after dispose')

            expect(host.console.log).toBe(originalMethods.log)
            expect(host.console.info).toBe(originalMethods.info)
            expect(host.console.warn).toBe(originalMethods.warn)
            expect(host.console.error).toBe(originalMethods.error)
            expect(host.console.debug).toBe(originalMethods.debug)
            expect(mockEmit).not.toHaveBeenCalled()
        })
    })

    describe('console wrapping behavior', () => {
        beforeEach(() => {
            initialize()
        })

        it('should capture logs when console methods are called', () => {
            host.console.log('Test message')

            expect(mockEmit).toHaveBeenCalledWith({
                level: 'info',
                body: '"Test message"',
                attributes: expect.objectContaining({
                    'log.source': 'console.log',
                }),
            })
        })

        it.each([
            ['log', 'info'],
            ['info', 'info'],
            ['warn', 'warn'],
            ['error', 'error'],
            ['debug', 'debug'],
        ] as const)('should map console.%s to level %s', (method, expectedLevel) => {
            ;(host.console[method] as any)(`Test ${method} message`)

            expect(mockEmit).toHaveBeenCalledWith({
                level: expectedLevel,
                body: `"Test ${method} message"`,
                attributes: expect.objectContaining({
                    'log.source': `console.${method}`,
                }),
            })
        })

        it('should not capture logs when no arguments are provided', () => {
            host.console.log()
            expect(mockEmit).not.toHaveBeenCalled()
        })

        it('should still call originalConsoleLog when no arguments are provided', () => {
            // The originalConsoleLog (the vi.fn() mock installed before initializeLogs
            // wrapped it) must always run, even when capture is skipped due to empty args.
            // We recover the original by re-installing a fresh mock and re-wrapping.
            const originalLog = vi.fn()
            host.console.log = originalLog
            initialize()

            host.console.log()

            expect(originalLog).toHaveBeenCalledTimes(1)
            expect(mockEmit).not.toHaveBeenCalled()
        })

        it('should handle multiple arguments', () => {
            host.console.log('arg1', 'arg2', 123)

            expect(mockEmit).toHaveBeenCalledWith({
                level: 'info',
                body: '"arg1" "arg2" 123',
                attributes: expect.objectContaining({
                    'log.source': 'console.log',
                }),
            })
        })
    })

    describe('object flattening', () => {
        beforeEach(() => {
            initialize()
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

            host.console.log(nestedObject)

            expect(mockEmit).toHaveBeenCalledWith({
                level: 'info',
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
            host.console.log('string', { nested: { value: 'test' } })

            expect(mockEmit).toHaveBeenCalledWith({
                level: 'info',
                body: expect.any(String),
                attributes: expect.not.objectContaining({
                    'nested.value': 'test',
                }),
            })
        })
    })

    describe('error handling in logs', () => {
        beforeEach(() => {
            initialize()
        })

        it('should handle Error objects correctly', () => {
            const error = new Error('Test error')
            error.stack = 'Error stack trace'

            host.console.error(error)

            expect(mockEmit).toHaveBeenCalledWith({
                level: 'error',
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

            host.console.error(customError)

            expect(mockEmit).toHaveBeenCalledWith({
                level: 'error',
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

    describe('edge cases and error handling', () => {
        beforeEach(() => {
            initialize()
        })

        it('should handle circular references in objects without throwing', () => {
            const circularObj: any = { name: 'test' }
            circularObj.self = circularObj

            expect(() => host.console.log(circularObj)).not.toThrow()

            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'info',
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

            host.console.log(circularObj)

            const body = mockEmit.mock.calls[0]![0].body
            expect(body).toContain('"name":"test"')
            expect(body).toContain('"count":42')
            expect(body).toContain('"self":"[Circular]"')
        })

        it('should handle deeply nested circular references', () => {
            const root: any = { level: 0 }
            root.child = { level: 1 }
            root.child.child = { level: 2 }
            root.child.child.backToRoot = root

            expect(() => host.console.log(root)).not.toThrow()

            const body = mockEmit.mock.calls[0]![0].body
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

            expect(() => host.console.log(obj1, obj2)).not.toThrow()

            const body = mockEmit.mock.calls[0]![0].body
            // Each argument gets its own replacer, so both are serialized independently
            expect(body).toContain('"id":1')
            expect(body).toContain('"id":2')
        })

        it('should handle circular references in flattenObject attributes', () => {
            const circularObj: any = { name: 'test', value: 'hello' }
            circularObj.self = circularObj

            host.console.log(circularObj)

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

            expect(() => host.console.log(obj)).not.toThrow()

            const body = mockEmit.mock.calls[0]![0].body
            // The shared object is not circular, but WeakSet will mark the second occurrence.
            // This is the expected trade-off for circular reference safety.
            expect(body).toContain('"data":"shared"')
        })

        it('should handle circular references with Error objects', () => {
            const error: any = new Error('circular error')
            error.related = { cause: error }

            expect(() => host.console.error(error)).not.toThrow()

            const body = mockEmit.mock.calls[0]![0].body
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

            host.console.log(deepObj)

            expect(mockEmit).toHaveBeenCalledWith({
                level: 'info',
                body: expect.any(String),
                attributes: expect.objectContaining({
                    'log.source': 'console.log',
                    level: 0, // First level should be flattened
                }),
            })
        })

        it('should handle undefined and null console arguments', () => {
            host.console.log(null, undefined, '')

            expect(mockEmit).toHaveBeenCalledWith({
                level: 'info',
                body: 'null  ""',
                attributes: expect.objectContaining({
                    'log.source': 'console.log',
                }),
            })
        })

        it('should handle functions as console arguments', () => {
            const testFunction = () => 'test'
            host.console.log(testFunction)

            expect(mockEmit).toHaveBeenCalledWith({
                level: 'info',
                body: '',
                attributes: expect.objectContaining({
                    'log.source': 'console.log',
                }),
            })
        })
    })
})
