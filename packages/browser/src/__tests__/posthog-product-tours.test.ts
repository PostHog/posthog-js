import { PostHog } from '../posthog-core'
import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { PRODUCT_TOURS_ENABLED_SERVER_SIDE } from '../constants'
import { RemoteConfig } from '../types'

describe('PostHogProductTours', () => {
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
                [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: true,
            })

            // Call with empty config (simulating config fetch failure)
            instance.productTours.onRemoteConfig({} as RemoteConfig)

            // Should NOT have overwritten the existing value
            expect(instance.persistence?.props[PRODUCT_TOURS_ENABLED_SERVER_SIDE]).toBe(true)
        })

        it('updates persistence when productTours key is present', () => {
            instance.persistence?.register({
                [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: true,
            })

            instance.productTours.onRemoteConfig({
                productTours: false,
            } as RemoteConfig)

            expect(instance.persistence?.props[PRODUCT_TOURS_ENABLED_SERVER_SIDE]).toBe(false)
        })

        it('sets persistence to true when productTours is truthy', () => {
            instance.persistence?.register({
                [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: false,
            })

            instance.productTours.onRemoteConfig({
                productTours: true,
            } as RemoteConfig)

            expect(instance.persistence?.props[PRODUCT_TOURS_ENABLED_SERVER_SIDE]).toBe(true)
        })
    })
})
