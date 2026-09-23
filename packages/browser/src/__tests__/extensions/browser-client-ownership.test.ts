import type { Extension } from '@posthog/browser-common'
import { FeatureFlagsCommonExtension } from '@posthog/browser-common/extension-tokens'
import { BrowserClientAdapter } from '../../extensions/browser-client'
import { FeatureFlagsExtension, LogsExtension } from '../../extension-tokens'
import { PostHog } from '../../posthog-core'
import { createPosthogInstance } from '../helpers/posthog-instance'

const createInstance = () => createPosthogInstance(undefined, { capture_pageview: false })

describe('core-owned extension lifecycle', () => {
    it('shares authoritative flags lookups across independent views without starting or stopping products', async () => {
        const instance = await createInstance()
        const setup = vi.spyOn(instance.featureFlags, 'setup')
        const dispose = vi.spyOn(instance.featureFlags, 'dispose')
        const captureHook = vi.spyOn(instance, '_addCaptureHook')
        const request = vi.spyOn(instance, '_send_request')
        const first = new BrowserClientAdapter(instance)
        const second = new BrowserClientAdapter(instance)

        expect(first.getExtension(FeatureFlagsExtension)).toBe(instance.featureFlags)
        expect(second.getExtension(FeatureFlagsCommonExtension)).toBe(instance.featureFlags)
        expect(instance.getExtension(FeatureFlagsCommonExtension)).toBe(instance.featureFlags)
        expect(setup).not.toHaveBeenCalled()
        expect(captureHook).not.toHaveBeenCalled()
        expect(request).not.toHaveBeenCalled()
        first.dispose()
        expect(dispose).not.toHaveBeenCalled()
        expect(second.getExtension(FeatureFlagsExtension)).toBe(instance.featureFlags)

        await instance.shutdown()
        await instance.shutdown()
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(second.getExtension(FeatureFlagsExtension)).toBeUndefined()
        expect(second.getExtension(FeatureFlagsCommonExtension)).toBeUndefined()
        expect(second.canCapture).toBe(false)
        expect(instance._getBrowserClientAdapter().canCapture).toBe(false)
    })

    it.each(['throw', 'reject'] as const)(
        'removes failed setup from lookup and cleans up once (%s)',
        async (failure) => {
            const instance = await createInstance()
            const dispose = vi.fn()
            const extension: Extension = {
                name: LogsExtension,
                setup(client) {
                    expect(client.getExtension(LogsExtension)).toBe(extension)
                    if (failure === 'throw') throw new Error('setup failed')
                    return Promise.reject(new Error('setup failed'))
                },
                dispose,
            }
            instance.logs = extension as any
            await instance['_setupExtension'](extension)
            expect(instance.logs).toBe(extension)
            expect(instance.getExtension(LogsExtension)).toBeUndefined()
            expect(new BrowserClientAdapter(instance).getExtension(LogsExtension)).toBeUndefined()
            expect(dispose).toHaveBeenCalledTimes(1)
            // The mock is not a complete logs facade, so restore the property before normal shutdown flushing.
            instance.logs = undefined as any
            await instance.shutdown()
            expect(dispose).toHaveBeenCalledTimes(1)
        }
    )

    it('disposes pending setup only once when it rejects after shutdown', async () => {
        const instance = await createInstance()
        let reject!: (error: Error) => void
        const dispose = vi.fn()
        const extension: Extension = {
            name: 'pending',
            setup: () =>
                new Promise<void>((_resolve, fail) => {
                    reject = fail
                }),
            dispose,
        }
        const setup = instance['_setupExtension'](extension)
        await instance.shutdown()
        reject(new Error('late rejection'))
        await setup
        await instance.shutdown()
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(instance._isExtensionActive(extension)).toBe(false)
    })

    it('cleans up in reverse setup order and isolates cleanup failures', async () => {
        const instance = await createInstance()
        const order: string[] = []
        for (const name of ['first', 'second']) {
            await instance['_setupExtension']({
                name,
                setup() {},
                dispose() {
                    order.push(name)
                    if (name === 'second') throw new Error('cleanup failed')
                },
            })
        }
        await instance.shutdown()
        await instance.shutdown()
        expect(order).toEqual(['second', 'first'])
    })

    it('continues product cleanup and queue flushing when the host flags subscription fails to unsubscribe', async () => {
        const instance = await createInstance()
        const dispose = vi.spyOn(instance.featureFlags, 'dispose')
        const unload = vi.spyOn(instance._requestQueue!, 'unload')
        instance['_featureFlagsReloadingUnsubscribe'] = () => {
            throw new Error('unsubscribe failed')
        }
        await expect(instance.shutdown()).resolves.toBeUndefined()
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(unload).toHaveBeenCalledTimes(1)
    })

    it('replays host remote configuration published after a fallback view was constructed', async () => {
        const instance = await createInstance()
        const client = new BrowserClientAdapter(instance)
        const result = { ok: false } as const
        instance._onRemoteConfig(result)
        const listener = vi.fn()
        const subscription = client.onRemoteConfig(listener)
        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener).toHaveBeenCalledWith(result)
        subscription.dispose()
        await instance.shutdown()
    })
})

describe('historical client adaptation', () => {
    it('uses the older opt-out API when is_capturing is absent', () => {
        const hasOptedOut = vi.fn(() => false)
        const instance = { has_opted_out_capturing: hasOptedOut } as unknown as PostHog
        const client = new BrowserClientAdapter(instance)
        expect(client.canCapture).toBe(true)
        expect(client.isOptedOut).toBe(false)
        hasOptedOut.mockReturnValue(true)
        expect(client.canCapture).toBe(false)
        expect(client.isOptedOut).toBe(true)
        hasOptedOut.mockReturnValue(false)
        expect(client.canCapture).toBe(true)
    })

    it('prefers the cookieless-aware current-core admission API', () => {
        const instance = {
            has_opted_out_capturing: () => true,
            is_capturing: () => true,
        } as unknown as PostHog
        const client = new BrowserClientAdapter(instance)
        expect(client.isOptedOut).toBe(true)
        expect(client.canCapture).toBe(true)
    })

    it('isolates historical capture-hook callbacks and unsubscribes idempotently', () => {
        const callbacks = new Set<Parameters<PostHog['_addCaptureHook']>[0]>()
        const unsubscribe = vi.fn()
        const instance = {
            _addCaptureHook(callback: Parameters<PostHog['_addCaptureHook']>[0]) {
                callbacks.add(callback)
                return () => {
                    callbacks.delete(callback)
                    unsubscribe()
                }
            },
        } as unknown as PostHog
        const client = new BrowserClientAdapter(instance)
        const error = vi.spyOn(client.logger, 'error').mockImplementation(() => {})
        const failed = client.onEvent(() => {
            throw new Error('listener failed')
        })
        const sibling = vi.fn()
        const subscription = client.onEvent(sibling)
        const payload = { event: 'captured', properties: { answer: 42 } } as any
        expect(() => callbacks.forEach((callback) => callback('captured', payload))).not.toThrow()
        expect(sibling).toHaveBeenCalledWith({ event: 'captured', properties: { answer: 42 } })
        expect(error).toHaveBeenCalledTimes(1)
        callbacks.forEach((callback) => callback('no-payload'))
        expect(sibling).toHaveBeenCalledTimes(1)
        failed.dispose()
        failed.dispose()
        subscription.dispose()
        expect(unsubscribe).toHaveBeenCalledTimes(2)
        expect(callbacks.size).toBe(0)
        error.mockRestore()
    })

    it('reads historical host extension properties without assuming a lifecycle API', () => {
        const flags = { setup: vi.fn(), dispose: vi.fn() }
        const instance = { featureFlags: flags } as unknown as PostHog
        const client = new BrowserClientAdapter(instance)
        expect(client.getExtension(FeatureFlagsCommonExtension)).toBe(flags)
        client.dispose()
        expect(flags.setup).not.toHaveBeenCalled()
        expect(flags.dispose).not.toHaveBeenCalled()
    })
})
