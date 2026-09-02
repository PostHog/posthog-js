import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'

import { PostHog } from '../posthog-core'
import { createPosthogInstance } from './helpers/posthog-instance'

describe('HMAC identity lifecycle', () => {
    let instance: PostHog

    beforeEach(async () => {
        instance = await createPosthogInstance(uuidv7(), {
            api_host: 'https://test.com',
            token: 'test-token',
        })
        instance.config.identity_claims = {
            email: { value: 'viewer@example.com', hash: 'email-claim-hash' },
        }
    })

    it('clears claims when setting a base identity', () => {
        instance.setIdentity('user_123', 'base-identity-hash')

        expect(instance.config.identity_distinct_id).toBe('user_123')
        expect(instance.config.identity_hash).toBe('base-identity-hash')
        expect(instance.config.identity_claims).toBeUndefined()
    })

    it('clears claims with the base identity', () => {
        instance.config.identity_distinct_id = 'user_123'
        instance.config.identity_hash = 'base-identity-hash'

        instance.clearIdentity()

        expect(instance.config.identity_distinct_id).toBeUndefined()
        expect(instance.config.identity_hash).toBeUndefined()
        expect(instance.config.identity_claims).toBeUndefined()
    })

    it('clears claims on reset', () => {
        instance.config.identity_distinct_id = 'user_123'
        instance.config.identity_hash = 'base-identity-hash'

        instance.reset()

        expect(instance.config.identity_distinct_id).toBeUndefined()
        expect(instance.config.identity_hash).toBeUndefined()
        expect(instance.config.identity_claims).toBeUndefined()
    })
})
