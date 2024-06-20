/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { PostHog } from '../../../posthog-core'
import { DecideResponse } from '../../../types'
import { ExceptionObserver } from '../../../extensions/exception-autocapture'
import { window } from '../../../utils/globals'
import { createPosthogInstance } from '../../helpers/posthog-instance'
import { uuidv7 } from '../../../uuidv7'

describe('Exception Observer', () => {
    let exceptionObserver: ExceptionObserver
    let posthog: PostHog
    const mockCapture = jest.fn()

    beforeEach(async () => {
        posthog = await createPosthogInstance(uuidv7(), { _onCapture: mockCapture })
        exceptionObserver = new ExceptionObserver(posthog)
    })

    describe('when enabled', () => {
        beforeEach(() => {
            exceptionObserver.afterDecideResponse({ autocaptureExceptions: true } as DecideResponse)
        })

        it.skip('should instrument handlers when started', () => {
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
