import { PostHog } from '../../posthog-core'
import { createPosthogInstance } from '../helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
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

        it('swallows a stack overflow so it cannot be recaptured', () => {
            const overflow = new RangeError('Maximum call stack size exceeded')
            vi.spyOn(instance.exceptions, 'sendExceptionEvent').mockImplementation(() => {
                throw overflow
            })

            expect(() => instance.exceptionObserver.captureException(errorProperties)).not.toThrow()
        })

        it('rethrows any other error', () => {
            vi.spyOn(instance.exceptions, 'sendExceptionEvent').mockImplementation(() => {
                throw new TypeError('something else')
            })

            expect(() => instance.exceptionObserver.captureException(errorProperties)).toThrow(TypeError)
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
