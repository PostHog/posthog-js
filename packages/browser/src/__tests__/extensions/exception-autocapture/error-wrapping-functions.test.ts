import posthogErrorWrappingFunctions from '../../../entrypoints/exception-autocapture'
import { ErrorTracking } from '@posthog/core'

const { wrapOnError, wrapUnhandledRejection, wrapConsoleError } = posthogErrorWrappingFunctions

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
            const original = jest.fn().mockReturnValue(true)
            win.onunhandledrejection = original
            unwrap = wrapUnhandledRejection(captureFn)

            const ev = { reason: new Error('boom') } as any
            const result = win.onunhandledrejection(ev)

            expect(original).toHaveBeenCalledWith(ev)
            expect(result).toBe(true)
            expect(captureFn).toHaveBeenCalled()
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
