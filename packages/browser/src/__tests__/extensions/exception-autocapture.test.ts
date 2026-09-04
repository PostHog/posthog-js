import Config from '@posthog/browser-common/config'
import { window } from '@posthog/browser-common/utils/globals'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { PostHog } from '../../posthog-core'
import { createPosthogInstance } from '../helpers/posthog-instance'
import { EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE } from '../../constants'
import { RemoteConfig } from '../../types'

describe('ExceptionObserver', () => {
    let instance: PostHog

    beforeEach(async () => {
        instance = await createPosthogInstance(uuidv7(), {
            api_host: 'https://test.com',
            token: 'testtoken',
        })
    })

    describe('captureException', () => {
        const errorProperties = { $exception_list: [{ type: 'TypeError' }] } as any

        it.each([
            ['Chromium', new RangeError('Maximum call stack size exceeded')],
            ['WebKit', new RangeError('Maximum call stack size exceeded.')],
            ['Firefox', Object.assign(new Error('too much recursion'), { name: 'InternalError' })],
        ])('swallows %s stack overflow errors', (_browser, stackOverflowError) => {
            vi.spyOn(instance.exceptions, 'sendExceptionEvent').mockImplementation(() => {
                throw stackOverflowError
            })

            expect(() => instance.exceptionObserver.captureException(errorProperties)).not.toThrow()
        })

        it.each([
            new RangeError('Invalid array length'),
            Object.assign(new Error('allocation size overflow'), { name: 'InternalError' }),
            new TypeError('something else'),
        ])('swallows unrelated errors from exception capture', (error) => {
            vi.spyOn(instance.exceptions, 'sendExceptionEvent').mockImplementation(() => {
                throw error
            })

            expect(() => instance.exceptionObserver.captureException(errorProperties)).not.toThrow()
        })

        it.each([new RangeError('Maximum call stack size exceeded'), new TypeError('rate limiter failed')])(
            'swallows errors raised before sending the exception',
            (error) => {
                vi.spyOn(instance.exceptionObserver['_rateLimiter'], 'consumeRateLimit').mockImplementation(() => {
                    throw error
                })
                const sendExceptionEvent = vi.spyOn(instance.exceptions, 'sendExceptionEvent')

                expect(() => instance.exceptionObserver.captureException(errorProperties)).not.toThrow()
                expect(sendExceptionEvent).not.toHaveBeenCalled()
            }
        )

        it('swallows errors while building a manually captured exception', () => {
            vi.spyOn(instance.exceptions, 'buildProperties').mockImplementation(() => {
                throw new TypeError('property building failed')
            })

            expect(() => instance.captureException(new Error('original exception'))).not.toThrow()
        })

        it('swallows errors while sending a manually captured exception', () => {
            vi.spyOn(instance.exceptions, 'sendExceptionEvent').mockImplementation(() => {
                throw new TypeError('exception sending failed')
            })

            expect(() => instance.captureException(new Error('original exception'))).not.toThrow()
        })

        it.each(['automatic', 'manual'])('does not re-enter autocapture after a %s capture overflows', (mode) => {
            const stackOverflowError = new RangeError('Maximum call stack size exceeded')
            const capture = vi.spyOn(instance, 'capture').mockImplementation(() => {
                throw stackOverflowError
            })
            const consoleError = vi.fn(() => instance.exceptionObserver.captureException(errorProperties))
            const originalConsoleError = window!.console.error
            const originalConsoleLog = window!.console.log
            const originalDebug = Config.DEBUG
            window!.console.error = consoleError
            window!.console.log = vi.fn()
            Config.DEBUG = true

            try {
                if (mode === 'automatic') {
                    instance.exceptionObserver.captureException(errorProperties)
                } else {
                    instance.captureException(new Error('original exception'))
                }

                expect(capture).toHaveBeenCalledTimes(1)
                expect(consoleError).not.toHaveBeenCalled()
            } finally {
                capture.mockRestore()
                Config.DEBUG = originalDebug
                window!.console.error = originalConsoleError
                window!.console.log = originalConsoleLog
            }
        })
    })

    describe('onRemoteConfig', () => {
        it('does not overwrite persistence when called with empty config', () => {
            // Set up existing persisted value
            instance.persistence?.register({
                [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: true,
            })

            // Call with empty config (server returned no setting for this feature)
            instance.exceptionObserver.onRemoteConfig({ ok: true, config: {} as RemoteConfig })

            // Should NOT have overwritten the existing value
            expect(instance.persistence?.props[EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]).toBe(true)
        })

        it('updates persistence when autocaptureExceptions key is present', () => {
            instance.persistence?.register({
                [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: true,
            })

            instance.exceptionObserver.onRemoteConfig({
                ok: true,
                config: {
                    autocaptureExceptions: false,
                } as RemoteConfig,
            })

            expect(instance.persistence?.props[EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]).toBe(false)
        })

        it('enables exception capture when autocaptureExceptions is truthy', () => {
            instance.persistence?.register({
                [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: false,
            })

            instance.exceptionObserver.onRemoteConfig({
                ok: true,
                config: {
                    autocaptureExceptions: true,
                } as RemoteConfig,
            })

            expect(instance.persistence?.props[EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]).toBe(true)
        })
    })
})
