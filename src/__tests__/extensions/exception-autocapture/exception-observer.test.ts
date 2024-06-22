/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { PostHog } from '../../../posthog-core'
import { DecideResponse } from '../../../types'
import { ExceptionObserver } from '../../../extensions/exception-autocapture'
import { assignableWindow, window } from '../../../utils/globals'
import { createPosthogInstance } from '../../helpers/posthog-instance'
import { uuidv7 } from '../../../uuidv7'
import { loadScript } from '../../../utils'
import posthogErrorWrappingFunctions from '../../../loader-exception-autocapture'
import { afterEach } from '@jest/globals'

/** help out jsdom */
export type PromiseRejectionEventTypes = 'rejectionhandled' | 'unhandledrejection'

export type PromiseRejectionEventInit = {
    promise: Promise<any>
    reason: any
}

export class PromiseRejectionEvent extends Event {
    public readonly promise: Promise<any>
    public readonly reason: any

    public constructor(type: PromiseRejectionEventTypes, options: PromiseRejectionEventInit) {
        super(type)

        this.promise = options.promise
        this.reason = options.reason
    }
}

/* finished helping js-dom */

jest.mock('../../../utils', () => ({
    ...jest.requireActual('../../../utils'),
    loadScript: jest.fn(),
}))

const loadScriptMock = loadScript as jest.Mock

describe('Exception Observer', () => {
    let exceptionObserver: ExceptionObserver
    let posthog: PostHog
    const mockCapture = jest.fn()

    const addErrorWrappingFlagToWindow = () => {
        // assignableWindow.onerror = jest.fn()
        // assignableWindow.onerror__POSTHOG_INSTRUMENTED__ = true

        assignableWindow.posthogErrorHandlers = posthogErrorWrappingFunctions
    }

    beforeEach(async () => {
        loadScriptMock.mockImplementation((_path, callback) => {
            addErrorWrappingFlagToWindow()
            callback()
        })

        posthog = await createPosthogInstance(uuidv7(), { _onCapture: mockCapture })
        exceptionObserver = new ExceptionObserver(posthog)
    })

    afterEach(() => {
        exceptionObserver['stopCapturing']()
    })

    describe('when enabled', () => {
        beforeEach(() => {
            exceptionObserver.afterDecideResponse({ autocaptureExceptions: true } as DecideResponse)
        })

        it('should instrument handlers when started', () => {
            expect(exceptionObserver.isCapturing).toBe(true)
            expect(exceptionObserver.isEnabled).toBe(true)

            expect((window?.onerror as any).__POSTHOG_INSTRUMENTED__).toBe(true)
            expect((window?.onunhandledrejection as any).__POSTHOG_INSTRUMENTED__).toBe(true)
        })

        it('should remove instrument handlers when stopped', () => {
            exceptionObserver['stopCapturing']()

            expect((window?.onerror as any)?.__POSTHOG_INSTRUMENTED__).not.toBeDefined()
            expect((window?.onunhandledrejection as any)?.__POSTHOG_INSTRUMENTED__).not.toBeDefined()

            expect(exceptionObserver.isCapturing).toBe(false)
        })

        it('captures an event when an error is thrown', () => {
            const error = new Error('test error')
            window!.onerror?.call(window, 'message', 'source', 0, 0, error)

            const captureCalls = mockCapture.mock.calls
            expect(captureCalls.length).toBe(1)
            const singleCall = captureCalls[0]
            expect(singleCall[0]).toBe('$exception')
            expect(singleCall[1]).toMatchObject({
                properties: {
                    $exception_message: 'test error',
                    $exception_type: 'Error',
                    $exception_personURL: expect.any(String),
                },
            })
        })

        it('captures an event when an unhandled rejection occurs', () => {
            const error = new Error('test error')
            const promiseRejectionEvent = new PromiseRejectionEvent('unhandledrejection', {
                // this is a test not a browser, so we don't care there's no Promise in IE11
                // eslint-disable-next-line compat/compat
                promise: Promise.resolve(),
                reason: error,
            })
            window!.onunhandledrejection?.call(window!, promiseRejectionEvent)

            const captureCalls = mockCapture.mock.calls
            expect(captureCalls.length).toBe(1)
            const singleCall = captureCalls[0]
            expect(singleCall[0]).toBe('$exception')
            expect(singleCall[1]).toMatchObject({
                properties: {
                    $exception_message: 'test error',
                    $exception_type: 'UnhandledRejection',
                    $exception_personURL: expect.any(String),
                },
            })
        })
    })

    describe('when there are handlers already', () => {
        const originalOnError = jest.fn()
        const originalOnUnhandledRejection = jest.fn()

        beforeEach(() => {
            jest.clearAllMocks()
            window!.onerror = originalOnError
            window!.onunhandledrejection = originalOnUnhandledRejection

            exceptionObserver.afterDecideResponse({ autocaptureExceptions: true } as DecideResponse)
        })

        it('should wrap original onerror handler if one was present when wrapped', () => {
            expect(window!.onerror).toBeDefined()
            expect(window!.onerror).not.toBe(originalOnError)
        })

        it('should wrap original onunhandledrejection handler if one was present when wrapped', () => {
            expect(window!.onunhandledrejection).toBeDefined()
            expect(window!.onunhandledrejection).not.toBe(originalOnUnhandledRejection)
        })

        it('should call original onerror handler if one was present when wrapped', () => {
            // throw an error so that it will be caught by window.onerror
            const error = new Error('test error')
            window!.onerror?.call(window, 'message', 'source', 0, 0, error)

            expect(originalOnError).toHaveBeenCalledWith('message', 'source', 0, 0, error)
        })

        it('should call original onunhandledrejection handler if one was present when wrapped', () => {
            // throw an error so that it will be caught by window.onunhandledrejection
            const error = new Error('test error')
            const promiseRejectionEvent = new PromiseRejectionEvent('unhandledrejection', {
                // this is a test not a browser, so we don't care there's no Promise in IE11
                // eslint-disable-next-line compat/compat
                promise: Promise.resolve(),
                reason: error,
            })
            window!.onunhandledrejection?.call(window!, promiseRejectionEvent)

            expect(originalOnUnhandledRejection).toHaveBeenCalledWith(promiseRejectionEvent)
        })

        it('should reinstate original onerror handler if one was present when wrapped', () => {
            exceptionObserver['stopCapturing']()

            expect(window!.onerror).toBe(originalOnError)
        })

        it('should reinstate original onunhandledrejection handler if one was present when wrapped', () => {
            exceptionObserver['stopCapturing']()

            expect(window!.onunhandledrejection).toBe(originalOnUnhandledRejection)
        })
    })

    describe('when no decide response', () => {
        it('cannot be started', () => {
            expect(exceptionObserver.isEnabled).toBe(false)
            expect(exceptionObserver.isCapturing).toBe(false)
            exceptionObserver['startCapturing']()
            expect(exceptionObserver.isCapturing).toBe(false)
        })
    })

    describe('when disabled', () => {
        beforeEach(() => {
            exceptionObserver.afterDecideResponse({ autocaptureExceptions: false } as DecideResponse)
        })

        it('cannot be started', () => {
            expect(exceptionObserver.isEnabled).toBe(false)
            expect(exceptionObserver.isCapturing).toBe(false)
            exceptionObserver['startCapturing']()
            expect(exceptionObserver.isCapturing).toBe(false)
        })
    })
})
