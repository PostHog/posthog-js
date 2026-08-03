import posthogErrorWrappingFunctions from '../../../entrypoints/exception-autocapture'
import { ErrorTracking } from '@posthog/core'

const { wrapOnError, wrapUnhandledRejection, wrapConsoleError } = posthogErrorWrappingFunctions

const createPromiseRejectionEvent = (reason: unknown): PromiseRejectionEvent => {
    const event = new Event('unhandledrejection')
    Object.defineProperty(event, 'reason', { value: reason })
    Object.defineProperty(event, Symbol.toStringTag, { value: 'PromiseRejectionEvent' })
    return event as PromiseRejectionEvent
}

describe('error wrapping functions', () => {
    const captureFn = jest.fn<void, [ErrorTracking.ErrorProperties]>()
    const win = window as any

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
            const original = jest.fn().mockReturnValue(true)
            win.onerror = original
            unwrap = wrapOnError(captureFn)

            const result = win.onerror('message', 'source', 1, 1, new Error('boom'))

            expect(original).toHaveBeenCalledWith('message', 'source', 1, 1, expect.any(Error))
            expect(result).toBe(true)
            expect(captureFn).toHaveBeenCalled()
        })

        it('preserves a cross-realm error stack', () => {
            const iframe = document.createElement('iframe')
            document.body.appendChild(iframe)
            const crossRealmError = new iframe.contentWindow!.TypeError('cross-realm onerror')
            crossRealmError.stack =
                'TypeError: cross-realm onerror\n    at crossRealmOrigin (https://example.com/cross-realm.js:42:13)'
            expect(crossRealmError).not.toBeInstanceOf(Error)
            unwrap = wrapOnError(captureFn)

            win.onerror('cross-realm onerror', 'https://example.com/fallback.js', 1, 2, crossRealmError)

            expect(captureFn.mock.calls[0][0].$exception_list[0].stacktrace?.frames).toEqual([
                expect.objectContaining({
                    filename: 'https://example.com/cross-realm.js',
                    function: 'crossRealmOrigin',
                    lineno: 42,
                    colno: 13,
                }),
            ])
            iframe.remove()
        })

        it('uses positional location when onerror has no Error object', () => {
            unwrap = wrapOnError(captureFn)

            win.onerror('error without object', 'https://example.com/positional-fallback.js', 73, 9)

            expect(captureFn.mock.calls[0][0].$exception_list[0]).toMatchObject({
                value: 'error without object',
                stacktrace: {
                    frames: [
                        expect.objectContaining({
                            filename: 'https://example.com/positional-fallback.js',
                            lineno: 73,
                            colno: 9,
                        }),
                    ],
                },
            })
        })

        it('does not parse frame-shaped lines from a multiline onerror message', () => {
            unwrap = wrapOnError(captureFn)
            const message = 'oops\n    at https://example.com/injected.js:1:2'

            win.onerror(message, 'https://example.com/genuine.js', 73, 9)

            const exception = captureFn.mock.calls[0][0].$exception_list[0]
            expect(exception.value).toBe(message)
            expect(exception.stacktrace?.frames).toEqual([
                expect.objectContaining({
                    filename: 'https://example.com/genuine.js',
                    lineno: 73,
                    colno: 9,
                }),
            ])
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

            const ev = createPromiseRejectionEvent(new Error('boom'))
            expect(() => win.onunhandledrejection(ev)).not.toThrow()
            expect(win.onunhandledrejection(ev)).toBe(false)
            expect(captureFn).toHaveBeenCalled()
        })

        it('still chains to a callable original handler', () => {
            const original = jest.fn().mockReturnValue(true)
            win.onunhandledrejection = original
            unwrap = wrapUnhandledRejection(captureFn)

            const ev = createPromiseRejectionEvent(new Error('boom'))
            const result = win.onunhandledrejection(ev)

            expect(original).toHaveBeenCalledWith(ev)
            expect(result).toBe(true)
            expect(captureFn).toHaveBeenCalled()
        })

        it('preserves a cross-realm rejection stack', () => {
            const iframe = document.createElement('iframe')
            document.body.appendChild(iframe)
            const crossRealmError = new iframe.contentWindow!.TypeError('cross-realm rejection')
            crossRealmError.stack =
                'TypeError: cross-realm rejection\n    at rejectionOrigin (https://example.com/rejection.js:51:7)'
            expect(crossRealmError).not.toBeInstanceOf(Error)
            unwrap = wrapUnhandledRejection(captureFn)

            win.onunhandledrejection(createPromiseRejectionEvent(crossRealmError))

            expect(captureFn.mock.calls[0][0].$exception_list[0].stacktrace?.frames).toEqual([
                expect.objectContaining({
                    filename: 'https://example.com/rejection.js',
                    function: 'rejectionOrigin',
                    lineno: 51,
                    colno: 7,
                }),
            ])
            iframe.remove()
        })

        it('does not attach the wrapper stack to a primitive rejection', () => {
            unwrap = wrapUnhandledRejection(captureFn)

            win.onunhandledrejection(createPromiseRejectionEvent('primitive rejection'))

            expect(captureFn.mock.calls[0][0].$exception_list[0].stacktrace).toBeUndefined()
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
            const original = jest.fn()
            con.error = original
            unwrap = wrapConsoleError(captureFn)

            con.error('boom')

            expect(original).toHaveBeenCalledWith('boom')
            expect(captureFn).toHaveBeenCalled()
        })
    })
})
