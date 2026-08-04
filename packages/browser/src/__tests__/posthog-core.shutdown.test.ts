import type { Extension } from '@posthog/browser-common'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'

import { PostHog } from '../posthog-core'
import { createPosthogInstance } from './helpers/posthog-instance'

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

    it('stops periodic remote config refreshes', async () => {
        const remoteConfigStop = jest.spyOn(instance._remoteConfigLoader!, 'stop')

        await instance.shutdown()

        expect(remoteConfigStop).toHaveBeenCalledTimes(1)
    })

    it('destroys feature flags listeners', async () => {
        const featureFlagsDestroy = jest.spyOn(instance.featureFlags!, 'destroy')

        await instance.shutdown()

        expect(featureFlagsDestroy).toHaveBeenCalledTimes(1)
    })

    it('isolates extension cleanup failures and continues queue flushing', async () => {
        const order: string[] = []
        const requestQueueUnload = jest.spyOn(instance._requestQueue!, 'unload')
        const retryQueueUnload = jest.spyOn(instance._retryQueue!, 'unload')
        const host = instance._getBrowserClientAdapter()
        jest.spyOn(host.logger, 'error').mockImplementation()
        await host.add({
            name: 'failing',
            setup: jest.fn(),
            dispose: () => {
                order.push('failing')
                throw new Error('disposal failure')
            },
        })
        await host.add({
            name: 'survivor',
            setup: jest.fn(),
            dispose: () => {
                order.push('survivor')
            },
        })

        await expect(instance.shutdown()).resolves.toBeUndefined()

        expect(order).toEqual(expect.arrayContaining(['failing', 'survivor']))
        expect(requestQueueUnload).toHaveBeenCalledTimes(1)
        expect(retryQueueUnload).toHaveBeenCalledTimes(1)
    })

    it('cleans pending setup immediately and does not delay queue flushing', async () => {
        const requestQueueUnload = jest.spyOn(instance._requestQueue!, 'unload')
        const retryQueueUnload = jest.spyOn(instance._retryQueue!, 'unload')
        const pendingSetup: Extension = {
            name: 'pending-setup',
            setup: () => new Promise<void>(() => undefined),
            dispose: jest.fn(),
        }
        void instance._getBrowserClientAdapter().add(pendingSetup)

        await expect(instance.shutdown(0)).resolves.toBeUndefined()

        expect(pendingSetup.dispose).toHaveBeenCalledTimes(1)
        expect(requestQueueUnload).toHaveBeenCalledTimes(1)
        expect(retryQueueUnload).toHaveBeenCalledTimes(1)
    })

    it('runs synchronous extension cleanup before unloading queues', async () => {
        const order: string[] = []
        jest.spyOn(instance._requestQueue!, 'unload').mockImplementation(() => {
            order.push('request-unload')
        })
        await instance._getBrowserClientAdapter().add({
            name: 'synchronous-cleanup',
            setup: jest.fn(),
            dispose: () => {
                order.push('extension-dispose')
            },
        })

        await instance.shutdown()

        expect(order).toEqual(['extension-dispose', 'request-unload'])
    })

    it('does not throw when called before the client has loaded', async () => {
        const uninitialized = new PostHog()

        await expect(uninitialized.shutdown()).resolves.toBeUndefined()
    })
})
