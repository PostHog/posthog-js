import { PostHog } from '../../posthog-core'
import { createPosthogInstance } from '../helpers/posthog-instance'
import { uuidv7 } from '../../uuidv7'
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
