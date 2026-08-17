import '../../entrypoints/exception-autocapture'
import { assignableWindow, window } from '../../utils/globals'

describe('exception-autocapture entrypoint', () => {
    const originalOnError = window?.onerror
    const originalOnUnhandledRejection = window?.onunhandledrejection

    afterEach(() => {
        if (window) {
            window.onerror = originalOnError
            window.onunhandledrejection = originalOnUnhandledRejection
        }
    })

    it('exposes both exception autocapture names used by posthog-js <= 1.141.0', () => {
        expect(assignableWindow.extendPostHogWithExceptionAutoCapture).toBe(
            assignableWindow.extendPostHogWithExceptionAutocapture
        )
    })

    it('captures errors for legacy clients', () => {
        const capture = jest.fn()

        assignableWindow.extendPostHogWithExceptionAutocapture({ capture })
        window?.onerror?.('message', 'source', 1, 2, new Error('legacy error'))

        expect(capture).toHaveBeenCalledWith(
            '$exception',
            expect.objectContaining({
                $exception_list: [expect.objectContaining({ type: 'Error', value: 'legacy error' })],
            }),
            { _noTruncate: true, _batchKey: 'exceptionEvent' }
        )
    })

    it('captures unhandled rejections for legacy clients', () => {
        const capture = jest.fn()

        assignableWindow.extendPostHogWithExceptionAutocapture({ capture })
        window?.onunhandledrejection?.({ reason: new Error('legacy rejection') } as PromiseRejectionEvent)

        expect(capture).toHaveBeenCalledWith(
            '$exception',
            expect.objectContaining({
                $exception_list: [expect.objectContaining({ value: 'legacy rejection' })],
            }),
            { _noTruncate: true, _batchKey: 'exceptionEvent' }
        )
    })
})
