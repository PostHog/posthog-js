/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { PostHog } from '../../../posthog-core'
import { DecideResponse, PostHogConfig } from '../../../types'
import { ExceptionObserver } from '../../../extensions/exceptions/exception-autocapture'

describe('Exception Observer', () => {
    let exceptionObserver: ExceptionObserver
    let mockPostHogInstance: any
    const mockCapture = jest.fn()
    const mockConfig: Partial<PostHogConfig> = {
        api_host: 'https://app.posthog.com',
    }

    beforeEach(() => {
        mockPostHogInstance = {
            config: mockConfig,
            get_distinct_id: jest.fn(() => 'mock-distinct-id'),
            capture: mockCapture,
        }
        exceptionObserver = new ExceptionObserver(mockPostHogInstance as PostHog)
    })

    describe('when enabled', () => {
        beforeEach(() => {
            exceptionObserver.afterDecideResponse({ autocaptureExceptions: true } as DecideResponse)
        })

        it('should instrument handlers when started', () => {
            expect(exceptionObserver.isCapturing()).toBe(true)
            expect(exceptionObserver.isEnabled()).toBe(true)

            expect((window.onerror as any).__POSTHOG_INSTRUMENTED__).toBe(true)
            expect((window.onunhandledrejection as any).__POSTHOG_INSTRUMENTED__).toBe(true)
        })

        it('should remove instrument handlers when stopped', () => {
            exceptionObserver.stopCapturing()

            expect((window.onerror as any)?.__POSTHOG_INSTRUMENTED__).not.toBeDefined()
            expect((window.onunhandledrejection as any)?.__POSTHOG_INSTRUMENTED__).not.toBeDefined()

            expect(exceptionObserver.isCapturing()).toBe(false)
        })
    })

    describe('when no decide response', () => {
        it('cannot be started', () => {
            expect(exceptionObserver.isEnabled()).toBe(false)
            expect(exceptionObserver.isCapturing()).toBe(false)
            exceptionObserver.startCapturing()
            expect(exceptionObserver.isCapturing()).toBe(false)
        })
    })

    describe('when disabled', () => {
        beforeEach(() => {
            exceptionObserver.afterDecideResponse({ autocaptureExceptions: false } as DecideResponse)
        })

        it('cannot be started', () => {
            expect(exceptionObserver.isEnabled()).toBe(false)
            expect(exceptionObserver.isCapturing()).toBe(false)
            exceptionObserver.startCapturing()
            expect(exceptionObserver.isCapturing()).toBe(false)
        })
    })

    describe('with drop rules', () => {
        it('drops errors matching rules', () => {
            exceptionObserver.afterDecideResponse({
                autocaptureExceptions: {
                    errors_to_ignore: ['drop me', '.*drop me (too|as well)'],
                },
            } as DecideResponse)

            exceptionObserver.captureException(['drop me', undefined, undefined, undefined, new Error('drop me')])
            expect(mockCapture).not.toHaveBeenCalled()

            exceptionObserver.captureException([
                'drop me as well',
                undefined,
                undefined,
                undefined,
                new Error('drop me as well'),
            ])
            expect(mockCapture).not.toHaveBeenCalled()

            exceptionObserver.captureException([
                'drop me too',
                undefined,
                undefined,
                undefined,
                new Error('drop me too'),
            ])
            expect(mockCapture).not.toHaveBeenCalled()

            // matches because first rule has no position anchors
            exceptionObserver.captureException([
                'drop me - nah not really',
                undefined,
                undefined,
                undefined,
                new Error('drop me - nah not really'),
            ])
            expect(mockCapture).not.toHaveBeenCalled()
        })

        it('rules respect anchors', () => {
            exceptionObserver.afterDecideResponse({
                autocaptureExceptions: {
                    errors_to_ignore: ['^drop me$', '.*drop me (too|as well)'],
                },
            } as DecideResponse)

            exceptionObserver.captureException([
                'drop me - nah not really',
                undefined,
                undefined,
                undefined,
                new Error('drop me - nah not really'),
            ])
            expect(mockCapture).toHaveBeenCalled()
        })
    })
})
