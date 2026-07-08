import { PostHog } from '../posthog-core'
import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'

describe('shutdown()', () => {
    let instance: PostHog

    beforeEach(async () => {
        instance = await createPosthogInstance(uuidv7(), {
            api_host: 'https://test.com',
            token: 'testtoken',
        })
    })

    it('exists as a method on the browser client (parity with posthog-node)', () => {
        expect(typeof instance.shutdown).toBe('function')
    })

    it('resolves without throwing', async () => {
        await expect(instance.shutdown()).resolves.toBeUndefined()
    })

    it('accepts an optional timeout argument for parity with the Node.js SDK', async () => {
        await expect(instance.shutdown(5000)).resolves.toBeUndefined()
    })

    it('flushes the request and retry queues', async () => {
        const requestQueueUnload = jest.spyOn(instance._requestQueue!, 'unload')
        const retryQueueUnload = jest.spyOn(instance._retryQueue!, 'unload')

        await instance.shutdown()

        expect(requestQueueUnload).toHaveBeenCalledTimes(1)
        expect(retryQueueUnload).toHaveBeenCalledTimes(1)
    })

    it('destroys feature flags listeners', async () => {
        const featureFlagsDestroy = jest.spyOn(instance.featureFlags!, 'destroy')

        await instance.shutdown()

        expect(featureFlagsDestroy).toHaveBeenCalledTimes(1)
    })

    it('does not throw when called before the client has loaded', async () => {
        const uninitialized = new PostHog()

        await expect(uninitialized.shutdown()).resolves.toBeUndefined()
    })
})
