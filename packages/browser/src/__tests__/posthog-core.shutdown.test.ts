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

    it('destroys feature flags listeners', async () => {
        const featureFlagsDestroy = jest.spyOn(instance.featureFlags!, 'destroy')

        await instance.shutdown()

        expect(featureFlagsDestroy).toHaveBeenCalledTimes(1)
    })

    it.each([
        {
            mode: 'synchronous',
            fail: () => {
                throw new Error('synchronous disposal failure')
            },
        },
        {
            mode: 'asynchronous',
            fail: () => Promise.reject(new Error('asynchronous disposal failure')),
        },
    ])('continues shutdown after $mode extension disposal failures', async ({ fail }) => {
        const order: string[] = []
        const requestQueueUnload = jest.spyOn(instance._requestQueue!, 'unload')
        const retryQueueUnload = jest.spyOn(instance._retryQueue!, 'unload')
        const host = instance._getBrowserExtensionHost()
        jest.spyOn(host.logger, 'error').mockImplementation()
        await host.add({
            name: 'survivor',
            setup: jest.fn(),
            dispose: () => {
                order.push('survivor')
            },
        })
        await host.add({
            name: 'failing',
            setup: jest.fn(),
            dispose: () => {
                order.push('failing')
                return fail()
            },
        })

        await expect(instance.shutdown()).resolves.toBeUndefined()

        expect(order).toEqual(['failing', 'survivor'])
        expect(requestQueueUnload).toHaveBeenCalledTimes(1)
        expect(retryQueueUnload).toHaveBeenCalledTimes(1)
    })

    it('bounds pending extension setup and still unloads both queues', async () => {
        jest.useFakeTimers()
        try {
            const requestQueueUnload = jest.spyOn(instance._requestQueue!, 'unload')
            const retryQueueUnload = jest.spyOn(instance._retryQueue!, 'unload')
            const pendingSetup: Extension = {
                name: 'pending-setup',
                setup: () => new Promise<void>(() => undefined),
                dispose: jest.fn(),
            }
            instance._getBrowserExtensionHost().add(pendingSetup)

            const shutdown = instance.shutdown(10)
            await Promise.resolve()
            expect(requestQueueUnload).not.toHaveBeenCalled()
            await jest.advanceTimersByTimeAsync(10)
            await expect(shutdown).resolves.toBeUndefined()
            expect(requestQueueUnload).toHaveBeenCalledTimes(1)
            expect(retryQueueUnload).toHaveBeenCalledTimes(1)
        } finally {
            jest.useRealTimers()
        }
    })

    it('bounds pending extension disposal and still unloads both queues', async () => {
        jest.useFakeTimers()
        try {
            const requestQueueUnload = jest.spyOn(instance._requestQueue!, 'unload')
            const retryQueueUnload = jest.spyOn(instance._retryQueue!, 'unload')
            const pendingDisposal: Extension = {
                name: 'pending-disposal',
                setup: jest.fn(),
                dispose: () => new Promise<void>(() => undefined),
            }
            await instance._getBrowserExtensionHost().add(pendingDisposal)

            const shutdown = instance.shutdown(10)
            await Promise.resolve()
            expect(requestQueueUnload).not.toHaveBeenCalled()
            await jest.advanceTimersByTimeAsync(10)
            await expect(shutdown).resolves.toBeUndefined()
            expect(requestQueueUnload).toHaveBeenCalledTimes(1)
            expect(retryQueueUnload).toHaveBeenCalledTimes(1)
        } finally {
            jest.useRealTimers()
        }
    })

    it('finishes within-budget extension disposal before unloading queues', async () => {
        jest.useFakeTimers()
        try {
            const order: string[] = []
            jest.spyOn(instance._requestQueue!, 'unload').mockImplementation(() => {
                order.push('request-unload')
            })
            const extension: Extension = {
                name: 'within-budget',
                setup: jest.fn(),
                dispose: () =>
                    new Promise<void>((resolve) => {
                        setTimeout(() => {
                            order.push('extension-dispose')
                            resolve()
                        }, 5)
                    }),
            }
            await instance._getBrowserExtensionHost().add(extension)

            const shutdown = instance.shutdown(10)
            await jest.advanceTimersByTimeAsync(5)
            await shutdown
            expect(order).toEqual(['extension-dispose', 'request-unload'])
        } finally {
            jest.useRealTimers()
        }
    })

    it('does not throw when called before the client has loaded', async () => {
        const uninitialized = new PostHog()

        await expect(uninitialized.shutdown()).resolves.toBeUndefined()
    })
})
