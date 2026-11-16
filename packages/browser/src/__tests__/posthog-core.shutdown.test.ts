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
        const requestQueueUnload = vi.spyOn(instance._requestQueue!, 'unload')
        const retryQueueUnload = vi.spyOn(instance._retryQueue!, 'unload')

        await instance.shutdown()

        expect(requestQueueUnload).toHaveBeenCalledTimes(1)
        expect(retryQueueUnload).toHaveBeenCalledTimes(1)
    })

    it('disposes session recording visibility tracking', async () => {
        const sessionRecordingDispose = vi.spyOn(instance.sessionRecording!, 'dispose')

        await instance.shutdown()

        expect(sessionRecordingDispose).toHaveBeenCalledTimes(1)
    })

    it('disposes metrics, which removes the network wrappers', async () => {
        const metricsDispose = vi.spyOn(instance.metrics!, 'dispose')

        await instance.shutdown()

        expect(metricsDispose).toHaveBeenCalledTimes(1)
    })

    it('disposes core-owned feature flags', async () => {
        const featureFlagsDispose = vi.spyOn(instance.featureFlags!, 'destroy')

        await instance.shutdown()

        expect(featureFlagsDispose).toHaveBeenCalledTimes(1)
    })

    it('destroys persistence storage listeners', async () => {
        const persistenceDestroy = vi.spyOn(instance.persistence!, 'destroy')
        const sessionPersistenceDestroy = vi.spyOn(instance.sessionPersistence!, 'destroy')

        await instance.shutdown()

        expect(persistenceDestroy).toHaveBeenCalledTimes(1)
        expect(sessionPersistenceDestroy).toHaveBeenCalledTimes(1)
    })

    it('isolates extension cleanup failures and continues queue flushing', async () => {
        const order: string[] = []
        const requestQueueUnload = vi.spyOn(instance._requestQueue!, 'unload')
        const retryQueueUnload = vi.spyOn(instance._retryQueue!, 'unload')
        const host = instance._getBrowserClientAdapter()
        vi.spyOn(host.logger, 'error').mockImplementation(() => {})
        vi.spyOn(instance.logs!, 'dispose').mockImplementation(() => {
            order.push('failing')
            throw new Error('disposal failure')
        })
        vi.spyOn(instance.surveys!, 'dispose').mockImplementation(() => {
            order.push('survivor')
        })

        await expect(instance.shutdown()).resolves.toBeUndefined()

        expect(order).toEqual(expect.arrayContaining(['failing', 'survivor']))
        expect(requestQueueUnload).toHaveBeenCalledTimes(1)
        expect(retryQueueUnload).toHaveBeenCalledTimes(1)
    })

    it.each(['recording', 'logs-flush', 'metrics-flush', 'metrics-dispose', 'request-unload'])(
        'continues cleanup after %s throws',
        async (failure) => {
            const unsubscribe = vi.fn()
            instance['_featureFlagsReloadingUnsubscribe'] = unsubscribe
            const targets = {
                recording: vi.spyOn(instance.sessionRecording!, 'dispose'),
                'logs-flush': vi.spyOn(instance.logs!, 'flushLogs'),
                'metrics-flush': vi.spyOn(instance.metrics!, 'flush'),
                'metrics-dispose': vi.spyOn(instance.metrics!, 'dispose'),
                'request-unload': vi.spyOn(instance._requestQueue!, 'unload'),
            }
            targets[failure as keyof typeof targets].mockImplementation(() => {
                throw new Error('cleanup failed')
            })
            const surveys = vi.spyOn(instance.surveys!, 'dispose')
            const flags = vi.spyOn(instance.featureFlags, 'destroy')
            const retryQueue = vi.spyOn(instance._retryQueue!, 'unload')
            const persistence = vi.spyOn(instance.persistence!, 'destroy')

            await expect(instance.shutdown()).resolves.toBeUndefined()

            expect(surveys).toHaveBeenCalledTimes(1)
            expect(unsubscribe).toHaveBeenCalledTimes(1)
            expect(flags).toHaveBeenCalledTimes(1)
            expect(targets['request-unload']).toHaveBeenCalledTimes(1)
            expect(retryQueue).toHaveBeenCalledTimes(1)
            expect(persistence).toHaveBeenCalledTimes(1)
        }
    )

    it('cleans pending setup immediately and does not delay queue flushing', async () => {
        const requestQueueUnload = vi.spyOn(instance._requestQueue!, 'unload')
        const retryQueueUnload = vi.spyOn(instance._retryQueue!, 'unload')
        vi.spyOn(instance.logs!, 'setup').mockImplementation(() => new Promise<void>(() => undefined))
        const dispose = vi.spyOn(instance.logs!, 'dispose')
        const tasks: Array<() => void> = []
        instance['_enrollExtension'](instance.logs!, tasks)
        tasks[0]()

        await expect(instance.shutdown(0)).resolves.toBeUndefined()

        expect(dispose).toHaveBeenCalledTimes(1)
        expect(requestQueueUnload).toHaveBeenCalledTimes(1)
        expect(retryQueueUnload).toHaveBeenCalledTimes(1)
    })

    it('runs synchronous extension cleanup before unloading queues', async () => {
        const order: string[] = []
        vi.spyOn(instance._requestQueue!, 'unload').mockImplementation(() => {
            order.push('request-unload')
        })
        vi.spyOn(instance.logs!, 'dispose').mockImplementation(() => {
            order.push('extension-dispose')
        })

        await instance.shutdown()

        expect(order).toEqual(['extension-dispose', 'request-unload'])
    })

    it('cancels a time-sliced initialization continuation', async () => {
        vi.useFakeTimers()
        const now = vi.spyOn(performance, 'now').mockReturnValue(0).mockReturnValueOnce(31)
        const initialize = vi.fn()
        try {
            instance.config.__preview_deferred_init_extensions = true
            instance['_processInitTaskQueue']([initialize], 0)
            expect(initialize).not.toHaveBeenCalled()
            await instance.shutdown()
            vi.advanceTimersByTime(1)
            expect(initialize).not.toHaveBeenCalled()
        } finally {
            now.mockRestore()
            vi.useRealTimers()
        }
    })

    it('does not throw when called before the client has loaded', async () => {
        const uninitialized = new PostHog()

        await expect(uninitialized.shutdown()).resolves.toBeUndefined()
    })
})
