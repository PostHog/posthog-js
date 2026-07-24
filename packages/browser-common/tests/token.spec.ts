import type { ExtensionToken } from '../src/token'
import { createTestClient } from './helpers/test-client'

describe('ExtensionToken', () => {
    it('resolves equivalent string tokens declared independently', () => {
        interface Capability {
            value: string
        }

        const providerToken = 'posthog.test-capability' as ExtensionToken<Capability>
        const consumerToken = `${'posthog.test-capability'}` as ExtensionToken<Capability>
        const capability: Capability = { value: 'provided' }
        const client = createTestClient()

        const registration = client.registerExtension(providerToken, capability)
        const resolved: Capability | undefined = client.getExtension(consumerToken)

        expect(typeof providerToken).toBe('string')
        expect(resolved).toBe(capability)

        registration.dispose()
        expect(client.getExtension(consumerToken)).toBeUndefined()
    })
})
