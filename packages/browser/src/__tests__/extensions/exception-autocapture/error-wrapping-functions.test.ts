import posthogErrorWrappingFunctions from '../../../entrypoints/exception-autocapture'
import { ErrorTracking } from '@posthog/core'

const { wrapOnError, wrapUnhandledRejection, wrapConsoleError } = posthogErrorWrappingFunctions

describe('error wrapping functions', () => {
    const captureFn = vi.fn<[ErrorTracking.ErrorProperties], void>()
    const win = window as any
    const errorWithThrowingMessage = () => {
        const error = new Error('boom')
        Object.defineProperty(error, 'message', {
            get() {
                throw new TypeError('property building failed')
            },
        })
        return error
    }

    afterEach(() => {
        captureFn.mockClear()
    })

    describe('wrapOnError', () => {
        let unwrap: () => void

        afterEach(() => {
            unwrap?.()
        })

        it('does not throw when window.onerror is a non-callable value', () => {
            // simulate another script / extension clobbering window.onerror with a truthy non-function
            win.onerror = 'not a function' as any
            unwrap = wrapOnError(captureFn)

            expect(() => win.onerror('message', 'source', 1, 1, new Error('boom'))).not.toThrow()
            expect(win.onerror('message', 'source', 1, 1, new Error('boom'))).toBe(false)
            expect(captureFn).toHaveBeenCalled()
        })

        it('still chains to a callable original handler', () => {
            const original = vi.fn().mockReturnValue(true)
            win.onerror = original
            unwrap = wrapOnError(captureFn)

            const result = win.onerror('message', 'source', 1, 1, new Error('boom'))

            expect(original).toHaveBeenCalledWith('message', 'source', 1, 1, expect.any(Error))
            expect(result).toBe(true)
            expect(captureFn).toHaveBeenCalled()
        })

        it('still chains to the original handler when building exception properties throws', () => {
            const original = vi.fn().mockReturnValue(true)
            const error = errorWithThrowingMessage()
            win.onerror = original
            unwrap = wrapOnError(captureFn)

            expect(() => win.onerror('message', 'source', 1, 1, error)).not.toThrow()
            expect(original).toHaveBeenCalledTimes(1)
            expect(original.mock.calls[0][4]).toBe(error)
            expect(captureFn).not.toHaveBeenCalled()
        })

        it('still chains to the original handler when the capture callback throws', () => {
            const original = vi.fn().mockReturnValue(true)
            captureFn.mockImplementationOnce(() => {
                throw new TypeError('capture failed')
            })
            win.onerror = original
            unwrap = wrapOnError(captureFn)

            expect(() => win.onerror('message', 'source', 1, 1, new Error('boom'))).not.toThrow()
            expect(original).toHaveBeenCalledTimes(1)
        })

        it('does not swallow errors from the original handler', () => {
            const error = new TypeError('original handler failed')
            win.onerror = vi.fn(() => {
                throw error
            })
            unwrap = wrapOnError(captureFn)

            expect(() => win.onerror('message', 'source', 1, 1, new Error('boom'))).toThrow(error)
        })

        it('collects source/lineno/colno from the positional args when there is no Error object', () => {
            win.onerror = null
            unwrap = wrapOnError(captureFn)

            win.onerror('Uncaught TypeError: x is not a function', 'https://example.com/app.js', 42, 13, undefined)

            expect(captureFn).toHaveBeenCalledTimes(1)
            const exception = captureFn.mock.calls[0][0].$exception_list[0]
            expect(exception.type).toBe('TypeError')
            expect(exception.value).toBe('x is not a function')
            expect(exception.stacktrace?.frames?.[0]).toMatchObject({
                filename: 'https://example.com/app.js',
                lineno: 42,
                colno: 13,
            })
        })
    })

    describe('wrapUnhandledRejection', () => {
        let unwrap: () => void

        afterEach(() => {
            unwrap?.()
        })

        it('does not throw when window.onunhandledrejection is a non-callable value', () => {
            win.onunhandledrejection = 'not a function' as any
            unwrap = wrapUnhandledRejection(captureFn)

            const ev = { reason: new Error('boom') } as any
            expect(() => win.onunhandledrejection(ev)).not.toThrow()
            expect(win.onunhandledrejection(ev)).toBe(false)
            expect(captureFn).toHaveBeenCalled()
        })

        it('still chains to a callable original handler', () => {
            const original = vi.fn().mockReturnValue(true)
            win.onunhandledrejection = original
            unwrap = wrapUnhandledRejection(captureFn)

            const ev = { reason: new Error('boom') } as any
            const result = win.onunhandledrejection(ev)

            expect(original).toHaveBeenCalledWith(ev)
            expect(result).toBe(true)
            expect(captureFn).toHaveBeenCalled()
        })

        it('still chains to the original handler when building exception properties throws', () => {
            const original = vi.fn().mockReturnValue(true)
            const ev = { reason: errorWithThrowingMessage() } as any
            win.onunhandledrejection = original
            unwrap = wrapUnhandledRejection(captureFn)

            expect(() => win.onunhandledrejection(ev)).not.toThrow()
            expect(original).toHaveBeenCalledTimes(1)
            expect(original.mock.calls[0][0]).toBe(ev)
            expect(captureFn).not.toHaveBeenCalled()
        })

        it('still chains to the original handler when the capture callback throws', () => {
            const original = vi.fn().mockReturnValue(true)
            const ev = { reason: new Error('boom') } as any
            captureFn.mockImplementationOnce(() => {
                throw new TypeError('capture failed')
            })
            win.onunhandledrejection = original
            unwrap = wrapUnhandledRejection(captureFn)

            expect(() => win.onunhandledrejection(ev)).not.toThrow()
            expect(original).toHaveBeenCalledTimes(1)
        })

        it('does not swallow errors from the original handler', () => {
            const error = new TypeError('original handler failed')
            const ev = { reason: new Error('boom') } as any
            win.onunhandledrejection = vi.fn(() => {
                throw error
            })
            unwrap = wrapUnhandledRejection(captureFn)

            expect(() => win.onunhandledrejection(ev)).toThrow(error)
        })
    })

    describe('wrapConsoleError', () => {
        let unwrap: () => void

        afterEach(() => {
            unwrap?.()
        })

        it('does not throw when console.error is a non-callable value', () => {
            const con = console as any
            con.error = 'not a function' as any
            unwrap = wrapConsoleError(captureFn)

            expect(() => con.error('boom')).not.toThrow()
            expect(captureFn).toHaveBeenCalled()
        })

        it('still chains to a callable original handler', () => {
            const con = console as any
            const original = vi.fn()
            con.error = original
            unwrap = wrapConsoleError(captureFn)

            con.error('boom')

            expect(original).toHaveBeenCalledWith('boom')
            expect(captureFn).toHaveBeenCalled()
        })

        it('still calls the original console when building exception properties throws', () => {
            const con = console as any
            const original = vi.fn()
            const error = errorWithThrowingMessage()
            con.error = original
            unwrap = wrapConsoleError(captureFn)

            expect(() => con.error(error)).not.toThrow()
            expect(original).toHaveBeenCalledTimes(1)
            expect(original.mock.calls[0][0]).toBe(error)
            expect(captureFn).not.toHaveBeenCalled()
        })

        it('still calls the original console when the capture callback throws', () => {
            const con = console as any
            const original = vi.fn()
            captureFn.mockImplementationOnce(() => {
                throw new TypeError('capture failed')
            })
            con.error = original
            unwrap = wrapConsoleError(captureFn)

            expect(() => con.error('boom')).not.toThrow()
            expect(original).toHaveBeenCalledTimes(1)
        })

        it('does not swallow errors from the original console', () => {
            const con = console as any
            const error = new TypeError('original console failed')
            con.error = vi.fn(() => {
                throw error
            })
            unwrap = wrapConsoleError(captureFn)

            expect(() => con.error('boom')).toThrow(error)
        })
    })
})
