import '../../entrypoints/exception-autocapture'
import { assignableWindow, window } from '../../utils/globals'

describe('exception-autocapture entrypoint', () => {
    let originalOnError: typeof window.onerror
    let originalOnUnhandledRejection: typeof window.onunhandledrejection

    beforeEach(() => {
        originalOnError = window!.onerror
        originalOnUnhandledRejection = window!.onunhandledrejection
    })

    afterEach(() => {
        window!.onerror = originalOnError
        window!.onunhandledrejection = originalOnUnhandledRejection
    })

    it('exposes errorWrappingFunctions on __PosthogExtensions__', () => {
        expect(typeof assignableWindow.__PosthogExtensions__?.errorWrappingFunctions?.wrapOnError).toBe('function')
    })

    it('exposes posthogErrorWrappingFunctions on the window for pre-1.161.1 cores', () => {
        expect(typeof assignableWindow.posthogErrorWrappingFunctions.wrapOnError).toBe('function')
    })

    describe('extendPostHogWithExceptionAutocapture back-compat shim', () => {
        it('is a function on the window so pre-aaded54 cores do not throw TypeError', () => {
            expect(typeof assignableWindow.extendPostHogWithExceptionAutocapture).toBe('function')
        })

        it('does nothing and does not throw when called with no instance', () => {
            expect(() => assignableWindow.extendPostHogWithExceptionAutocapture(undefined)).not.toThrow()
            expect(() => assignableWindow.extendPostHogWithExceptionAutocapture(null)).not.toThrow()
            expect(() => assignableWindow.extendPostHogWithExceptionAutocapture({})).not.toThrow()
        })

        it('routes window.onerror through the legacy instance.capture as a $exception event', () => {
            const captureMock = jest.fn()
            const fakeInstance = { capture: captureMock }

            assignableWindow.extendPostHogWithExceptionAutocapture(fakeInstance, { autocaptureExceptions: true })

            const error = new Error('legacy back-compat error')
            window!.onerror?.call(window!, 'message', 'source', 0, 0, error)

            expect(captureMock).toHaveBeenCalledTimes(1)
            const [eventName, properties, options] = captureMock.mock.calls[0]
            expect(eventName).toBe('$exception')
            expect(properties.$exception_list?.[0]).toMatchObject({
                type: 'Error',
                value: 'legacy back-compat error',
            })
            expect(options).toMatchObject({ _noTruncate: true, _batchKey: 'exceptionEvent' })
        })
    })
})
