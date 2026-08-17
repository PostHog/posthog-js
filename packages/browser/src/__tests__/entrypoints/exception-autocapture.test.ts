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
            { _noTruncate: true, _batchKey: 'exceptionEvent', _noHeatmaps: true }
        )
    })

    it('still calls the original error handler when legacy capture throws', () => {
        const originalErrorHandler = jest.fn(() => true)
        const capture = jest.fn(() => {
            throw new Error('capture failed')
        })
        if (!window) {
            throw new Error('window is required for this test')
        }
        window.onerror = originalErrorHandler

        assignableWindow.extendPostHogWithExceptionAutocapture({ capture })

        expect(() => window.onerror?.('message', 'source', 1, 2, new Error('legacy error'))).not.toThrow()
        expect(originalErrorHandler).toHaveBeenCalledTimes(1)
    })

    it('does not capture errors matching legacy exclusion rules', () => {
        const capture = jest.fn()

        assignableWindow.extendPostHogWithExceptionAutocapture(
            { capture },
            {
                autocaptureExceptions: {
                    errors_to_ignore: ['^ignored error$'],
                },
            }
        )
        window?.onerror?.('ignored error', 'source', 1, 2, new Error('ignored error'))
        window?.onerror?.('reported error', 'source', 1, 2, new Error('reported error'))

        expect(capture).toHaveBeenCalledTimes(1)
        expect(capture).toHaveBeenCalledWith(
            '$exception',
            expect.objectContaining({
                $exception_list: [expect.objectContaining({ value: 'reported error' })],
            }),
            { _noTruncate: true, _batchKey: 'exceptionEvent', _noHeatmaps: true }
        )
    })

    it('captures errors when a legacy exclusion rule is invalid', () => {
        const capture = jest.fn()

        expect(() =>
            assignableWindow.extendPostHogWithExceptionAutocapture(
                { capture },
                {
                    autocaptureExceptions: {
                        errors_to_ignore: ['['],
                    },
                }
            )
        ).not.toThrow()
        window?.onerror?.('reported error', 'source', 1, 2, new Error('reported error'))

        expect(capture).toHaveBeenCalledTimes(1)
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
            { _noTruncate: true, _batchKey: 'exceptionEvent', _noHeatmaps: true }
        )
    })
})
