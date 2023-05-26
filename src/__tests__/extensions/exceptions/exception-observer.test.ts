/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { PostHog } from '../../../posthog-core'
import { PostHogConfig } from '../../../types'
import { ExceptionObserver } from '../../../extensions/exceptions/exception-autocapture'

describe('Exception Observer', () => {
    let exceptionObserver: ExceptionObserver
    let mockPostHogInstance: any
    const mockConfig: Partial<PostHogConfig> = {
        api_host: 'https://app.posthog.com',
    }

    beforeEach(() => {
        mockPostHogInstance = {
            get_config: jest.fn((key: string) => mockConfig[key as keyof PostHogConfig]),
        }
        exceptionObserver = new ExceptionObserver(mockPostHogInstance as PostHog)
        jest.clearAllMocks()
    })

    describe('catch exceptions', () => {
        it('should instrument handlers when started', () => {
            exceptionObserver.startCapturing()

            expect((window.onerror as any).__POSTHOG_INSTRUMENTED__).toBe(true)
            expect((window.onunhandledrejection as any).__POSTHOG_INSTRUMENTED__).toBe(true)
        })

        it('should remove instrument handlers when stopped', () => {
            exceptionObserver.stopCapturing()

            expect((window.onerror as any)?.__POSTHOG_INSTRUMENTED__).not.toBeDefined()
            expect((window.onunhandledrejection as any)?.__POSTHOG_INSTRUMENTED__).not.toBeDefined()
        })

        it('can report that it has started', () => {
            expect(exceptionObserver.isCapturing()).toBe(false)
            exceptionObserver.startCapturing()
            expect(exceptionObserver.isCapturing()).toBe(true)
        })
    })
})
