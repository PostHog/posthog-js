import { PostHog } from '../../posthog-core'
import { createPosthogInstance } from '../helpers/posthog-instance'
import { uuidv7 } from '../../uuidv7'
import { EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE } from '../../constants'
import { PostHogConfig, RemoteConfig } from '../../types'

describe('ExceptionObserver', () => {
    let instance: PostHog

    beforeEach(async () => {
        instance = await createPosthogInstance(uuidv7(), {
            api_host: 'https://test.com',
            token: 'testtoken',
        })
    })

    describe('burst protection', () => {
        async function captureRepeatedExceptions(errorTracking: PostHogConfig['error_tracking']): Promise<jest.Mock> {
            const configuredInstance = await createPosthogInstance(uuidv7(), {
                api_host: 'https://test.com',
                token: 'testtoken',
                error_tracking: errorTracking,
            })
            const sendExceptionEvent = jest.fn()
            configuredInstance.exceptions = { sendExceptionEvent } as unknown as PostHog['exceptions']

            for (let i = 0; i < 10; i++) {
                configuredInstance.exceptionObserver.captureException({
                    $exception_list: [{ type: 'Error', value: 'boom' }],
                })
            }
            return sendExceptionEvent
        }

        it('honours the configured burstProtection bucket size', async () => {
            const sendExceptionEvent = await captureRepeatedExceptions({ burstProtection: { bucketSize: 3 } })

            // a bucket of 3 lets 2 through before the limiter kicks in
            expect(sendExceptionEvent).toHaveBeenCalledTimes(2)
        })

        it('prefers burstProtection over the deprecated __ options', async () => {
            const sendExceptionEvent = await captureRepeatedExceptions({
                burstProtection: { bucketSize: 3 },
                __exceptionRateLimiterBucketSize: 50,
            })

            expect(sendExceptionEvent).toHaveBeenCalledTimes(2)
        })

        it('falls back to the deprecated __ options when burstProtection is not set', async () => {
            const sendExceptionEvent = await captureRepeatedExceptions({ __exceptionRateLimiterBucketSize: 3 })

            expect(sendExceptionEvent).toHaveBeenCalledTimes(2)
        })
    })

    describe('onRemoteConfig', () => {
        it('does not overwrite persistence when called with empty config', () => {
            // Set up existing persisted value
            instance.persistence?.register({
                [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: true,
            })

            // Call with empty config (simulating config fetch failure)
            instance.exceptionObserver.onRemoteConfig({} as RemoteConfig)

            // Should NOT have overwritten the existing value
            expect(instance.persistence?.props[EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]).toBe(true)
        })

        it('updates persistence when autocaptureExceptions key is present', () => {
            instance.persistence?.register({
                [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: true,
            })

            instance.exceptionObserver.onRemoteConfig({
                autocaptureExceptions: false,
            } as RemoteConfig)

            expect(instance.persistence?.props[EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]).toBe(false)
        })

        it('enables exception capture when autocaptureExceptions is truthy', () => {
            instance.persistence?.register({
                [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: false,
            })

            instance.exceptionObserver.onRemoteConfig({
                autocaptureExceptions: true,
            } as RemoteConfig)

            expect(instance.persistence?.props[EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]).toBe(true)
        })
    })
})
