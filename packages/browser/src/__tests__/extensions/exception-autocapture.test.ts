import Config from '@posthog/browser-common/config'
import { window } from '@posthog/browser-common/utils/globals'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { PostHog } from '../../posthog-core'
import { createPosthogInstance } from '../helpers/posthog-instance'
import { EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE } from '../../constants'
import { CaptureResult, RemoteConfig } from '../../types'
import { jsonStringify } from '@posthog/browser-common/utils/request-utils'

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

        function captureAdditionalProperties(additionalProperties: Record<string, unknown>) {
            const beforeSend = vi.fn((_event: CaptureResult | null) => null)
            instance.set_config({ before_send: beforeSend })
            instance.captureException(new Error('original exception'), additionalProperties)
            expect(beforeSend).toHaveBeenCalledTimes(1)
            return JSON.parse(jsonStringify(beforeSend.mock.calls[0][0])).properties
        }

        it('serializes Date and custom toJSON additional properties on the wire', () => {
            class ErrorWithToJSON extends Error {
                toJSON() {
                    return { name: 'custom error', message: this.message }
                }
            }
            const customDate = new Date('2025-01-02T03:04:05.000Z')
            customDate.toJSON = () => 'custom date'
            const toJSON = vi.fn(function (this: { value: string }, key: string) {
                return `${key}: ${this.value}`
            })
            const properties = {
                date: new Date('2025-01-02T03:04:05.000Z'),
                invalidDate: new Date(NaN),
                customDate,
                error: new ErrorWithToJSON('custom message'),
                nested: [{ custom: { value: 'kept', toJSON } }],
                ordinary: { name: 'justin', age: 101, pets: ['dog', 'cat'], enabled: true, missing: null },
            }

            expect(captureAdditionalProperties(properties)).toMatchObject({
                date: '2025-01-02T03:04:05.000Z',
                invalidDate: null,
                customDate: 'custom date',
                error: { name: 'custom error', message: 'custom message' },
                nested: [{ custom: 'custom: kept' }],
                ordinary: properties.ordinary,
            })
            expect(toJSON).toHaveBeenCalledTimes(1)
        })

        it('serializes Error additional properties without losing custom fields or mutating inputs', () => {
            const error = Object.assign(new TypeError('additional error'), { code: 'E_TEST' })
            const properties = { error, nested: [{ error }] }
            const expected = { name: 'TypeError', message: error.message, stack: error.stack, code: 'E_TEST' }

            expect(captureAdditionalProperties(properties)).toMatchObject({
                error: expected,
                nested: [{ error: expected }],
            })
            expect(properties.error).toBe(error)
            expect(Object.keys(error)).toEqual(['code'])
        })

        it('keeps additional properties available for before_send mutation before calling toJSON', () => {
            const toJSON = vi.fn(function (this: { message: string }) {
                return { message: this.message }
            })
            const error = Object.assign(new Error('original message'), { toJSON })
            const beforeSend = vi.fn((event: CaptureResult | null) => {
                expect(toJSON).not.toHaveBeenCalled()
                expect(event!.properties.error).toBe(error)
                event!.properties.error.message = 'updated message'
                return null
            })
            instance.set_config({ before_send: beforeSend })
            instance.captureException(new Error('original exception'), { error })

            expect(beforeSend).toHaveBeenCalledTimes(1)
            expect(JSON.parse(jsonStringify(beforeSend.mock.calls[0][0])).properties.error).toEqual({
                message: 'updated message',
            })
            expect(toJSON).toHaveBeenCalledTimes(1)
        })

        it('contains serialization failures without re-entering exception capture', () => {
            const toJSON = vi.fn(() => {
                throw new Error('cannot serialize')
            })
            const beforeSend = vi.fn((event: CaptureResult | null) => {
                jsonStringify(event)
                return null
            })
            instance.set_config({ before_send: beforeSend })

            expect(() =>
                instance.captureException(new Error('original exception'), { value: { toJSON } })
            ).not.toThrow()
            expect(beforeSend).toHaveBeenCalledTimes(1)
        })

        it('preserves circular-reference handling and shared additional properties', () => {
            const shared = { name: 'shared' }
            const circular: Record<string, unknown> = { first: shared, second: shared }
            circular.self = circular

            expect(captureAdditionalProperties({ circular })).toMatchObject({
                circular: { first: shared, second: shared, self: '[Circular]' },
            })
        })

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
