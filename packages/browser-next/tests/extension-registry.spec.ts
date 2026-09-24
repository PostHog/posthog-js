import type { Client } from '@posthog/browser-common'
import { ExtensionRegistry } from '../src/extensions/registry'
import { flags } from '../src/flags'
import { FeatureFlagsExtension } from '../src/flags-token'
import { FeatureFlagsCommonExtension } from '@posthog/browser-common/extension-tokens'
import type { BrowserClient } from '../src/browser-client'
import { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import { createPostHog } from '../src/core'
import { createFetch, localRemoteConfig } from './helpers'

const logger = { error: vi.fn() } as unknown as Client['logger']
const makeRegistry = () => new ExtensionRegistry(() => ({}) as Client, logger)

afterEach(() => {
    vi.restoreAllMocks()
})

describe('extension flushing', () => {
    it.each(['flush', 'shutdown'] as const)(
        'awaits each owner once with reason %s, not its bindings',
        async (reason) => {
            const registry = makeRegistry()
            let finish!: () => void
            const target = { name: 'target', setup: vi.fn(), flush: vi.fn() }
            const owner = {
                name: 'owner',
                setup: vi.fn(),
                bindings: { target },
                flush: vi.fn(
                    () =>
                        new Promise<void>((resolve) => {
                            finish = resolve
                        })
                ),
            }
            Object.assign(owner.bindings, { alias: owner })
            await registry.install(owner)
            await registry.install({ name: 'without-flush', setup: vi.fn() })
            let settled = false
            const pending = registry.flush(reason).then(() => {
                settled = true
            })
            await Promise.resolve()
            expect(settled).toBe(false)
            expect(owner.flush).toHaveBeenCalledTimes(1)
            expect(owner.flush).toHaveBeenCalledWith(reason)
            expect(target.flush).not.toHaveBeenCalled()
            finish()
            await pending
            await registry.dispose()
            await registry.flush()
            expect(owner.flush).toHaveBeenCalledOnce()
        }
    )

    it('isolates synchronous and asynchronous failures and starts other flushes', async () => {
        const registry = makeRegistry()
        const error = new Error('flush failed')
        await registry.install({
            name: 'sync',
            setup: vi.fn(),
            flush: () => {
                throw error
            },
        })
        await registry.install({
            name: 'async',
            setup: vi.fn(),
            flush: async () => {
                throw error
            },
        })
        const flush = vi.fn(async () => {})
        await registry.install({ name: 'healthy', setup: vi.fn(), flush })
        await expect(registry.flush()).resolves.toBeUndefined()
        expect(flush).toHaveBeenCalledTimes(1)
        expect(flush).toHaveBeenCalledWith('flush')
        expect(logger.error).toHaveBeenCalledWith('Extension "sync" flush failed', error)
        expect(logger.error).toHaveBeenCalledWith('Extension "async" flush failed', error)
    })

    it('does not flush failed or rolled-back installations', async () => {
        const registry = makeRegistry()
        const flush = vi.fn(async () => {})
        await expect(
            registry.install({
                name: 'failed',
                setup: () => {
                    throw new Error('setup failed')
                },
                flush,
            })
        ).rejects.toThrow('setup failed')
        const extension = { name: 'removed', setup: vi.fn(), flush }
        await registry.install(extension)
        await registry.rollback(extension)
        await registry.flush()
        expect(flush).not.toHaveBeenCalled()
    })
})

describe('extension lookup bindings', () => {
    it('resolves SDK and common tokens consistently from public and extension clients', async () => {
        const facade = flags({ featureFlagEvaluation: false })
        let shared: PostHogFeatureFlags | undefined
        let scoped!: Client
        const setup = vi.spyOn(PostHogFeatureFlags.prototype, 'setup')
        const dispose = vi.spyOn(PostHogFeatureFlags.prototype, 'dispose')
        const client = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            capturePageview: false,
            remoteConfig: localRemoteConfig,
            fetch: createFetch([]),
            extensions: [
                facade,
                {
                    name: 'consumer',
                    setup(client) {
                        scoped = client
                        shared = client.getExtension(FeatureFlagsCommonExtension)
                    },
                },
            ],
        })
        expect(client.getExtension(FeatureFlagsExtension)).toBe(facade)
        expect(scoped.getExtension(FeatureFlagsExtension)).toBe(facade)
        expect(client.getExtension(FeatureFlagsCommonExtension)).toBe(shared)
        expect(shared).toBeInstanceOf(PostHogFeatureFlags)
        const subscription = scoped.getExtension(FeatureFlagsExtension)!.onFeatureFlags(vi.fn())
        subscription.dispose()
        expect(shared).not.toBe(facade)
        expect(setup).toHaveBeenCalledTimes(1)
        const reload = vi.spyOn(shared!, 'reloadFeatureFlagsAsync')
        await expect(facade.reloadFeatureFlags()).resolves.toEqual({ status: 'skipped' })
        expect(reload).toHaveBeenCalledOnce()
        await client.dispose()
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(scoped.getExtension(FeatureFlagsExtension)).toBeUndefined()
        expect(scoped.getExtension(FeatureFlagsCommonExtension)).toBeUndefined()
        expect(client.getExtension(FeatureFlagsCommonExtension)).toBeUndefined()
        vi.restoreAllMocks()
    })

    it.each(['rollback', 'failure', 'dispose-during-setup'] as const)(
        'cleans real flag subscriptions and all bindings on %s',
        async (mode) => {
            let scoped!: BrowserClient
            const client = await createPostHog({
                projectToken: 'ph_lifecycle',
                storage: false,
                navigator: false,
                fetch: false,
                capturePageview: false,
                remoteConfig: localRemoteConfig,
                extensions: [
                    {
                        name: 'observer',
                        setup(value: BrowserClient) {
                            scoped = value
                        },
                    },
                ],
            })
            const facade = flags({ featureFlagEvaluation: false })
            const shared = facade.bindings![FeatureFlagsCommonExtension] as PostHogFeatureFlags
            const setup = vi.spyOn(shared, 'setup')
            const dispose = vi.spyOn(shared, 'dispose')
            const reload = vi.spyOn(shared, 'reloadFeatureFlags')
            const reset = vi.spyOn(shared, 'reset')
            const identified = vi.spyOn(scoped, 'onIdentify')
            const grouped = vi.spyOn(scoped, 'onGroup')
            const resetListener = vi.spyOn(scoped, 'onReset')
            const registry = new ExtensionRegistry(() => scoped, client.logger)
            let finish!: () => void
            if (mode === 'dispose-during-setup') {
                vi.spyOn(scoped.kv, 'initialize').mockImplementation(
                    () =>
                        new Promise<void>((resolve) => {
                            finish = resolve
                        })
                )
            } else if (mode === 'failure') {
                resetListener.mockImplementation(() => {
                    throw new Error('listener setup failed')
                })
            }
            const installed = registry.install(facade)
            const outcome = installed.catch((error: unknown) => error)
            if (mode === 'dispose-during-setup') {
                await registry.dispose()
                finish()
            }
            await outcome
            expect(setup).toHaveBeenCalledOnce()
            if (mode === 'rollback') {
                expect(identified).toHaveBeenCalledOnce()
                expect(grouped).toHaveBeenCalledOnce()
                expect(resetListener).toHaveBeenCalledOnce()
                reload.mockClear()
                client.identify('person')
                expect(reload).toHaveBeenCalledTimes(1)
                client.group('company', 'team')
                expect(reload).toHaveBeenCalledTimes(2)
                client.reset()
                expect(reload).toHaveBeenCalledTimes(3)
                expect(reset).toHaveBeenCalledOnce()
                await registry.rollback(facade)
            }
            expect(registry.get('featureFlags')).toBeUndefined()
            expect(registry.get(FeatureFlagsCommonExtension)).toBeUndefined()
            reload.mockClear()
            reset.mockClear()
            client.identify('after-cleanup')
            client.group('company', 'after-cleanup')
            client.reset()
            expect(reload).not.toHaveBeenCalled()
            expect(reset).not.toHaveBeenCalled()
            await registry.dispose()
            await facade.dispose?.()
            expect(dispose).toHaveBeenCalledOnce()
            await client.dispose()
        }
    )

    it('supports an additional token pointing to the owner itself', async () => {
        const registry = makeRegistry()
        const extension = { name: 'custom', setup: vi.fn(), dispose: vi.fn() }
        Object.assign(extension, { bindings: { customCommon: extension } })
        await registry.install(extension)
        expect(registry.get('custom')).toBe(extension)
        expect(registry.get('customCommon')).toBe(extension)
        await registry.dispose()
        expect(extension.dispose).toHaveBeenCalledTimes(1)
    })

    it.each(['owner', 'common'])('rejects collisions with an installed %s atomically', async (key) => {
        const registry = makeRegistry()
        const target = { name: 'implementation', setup: vi.fn() }
        const owner = { name: 'owner', bindings: { common: target }, setup: vi.fn() }
        await registry.install(owner)
        const conflicting = {
            name: 'next',
            bindings: { available: target, [key]: target },
            setup: vi.fn(),
            dispose: vi.fn(),
        }
        await expect(registry.install(conflicting)).rejects.toThrow('already installed')
        await expect(registry.install({ name: key, setup: vi.fn() })).rejects.toThrow('already installed')
        expect(registry.get('next')).toBeUndefined()
        expect(registry.get('available')).toBeUndefined()
        expect(registry.get('owner')).toBe(owner)
        expect(registry.get('common')).toBe(target)
        expect(conflicting.setup).not.toHaveBeenCalled()
        expect(conflicting.dispose).not.toHaveBeenCalled()
        await registry.dispose()
    })

    it('rejects a binding that duplicates its owner name before setup', async () => {
        const registry = makeRegistry()
        const owner = { name: 'owner', bindings: { owner: { name: 'target', setup: vi.fn() } }, setup: vi.fn() }
        await expect(registry.install(owner)).rejects.toThrow('already installed')
        expect(registry.get('owner')).toBeUndefined()
        expect(owner.setup).not.toHaveBeenCalled()
    })

    it.each(['failure', 'rollback', 'dispose-during-setup'] as const)(
        'removes all bindings with one lifecycle owner on %s',
        async (mode) => {
            const registry = makeRegistry()
            const implementation = { name: 'flags', setup: vi.fn(), dispose: vi.fn() }
            let finish!: () => void
            const owner = {
                name: 'flags',
                bindings: { flagsCommon: implementation },
                setup: vi.fn(
                    () =>
                        new Promise<void>((resolve, reject) => {
                            finish = () => (mode === 'failure' ? reject(new Error('setup failed')) : resolve())
                        })
                ),
                dispose: vi.fn(() => implementation.dispose()),
            }
            const installed = registry.install(owner)
            const outcome = installed.catch((error) => error)
            expect(registry.get('flags')).toBe(owner)
            expect(registry.get('flagsCommon')).toBe(implementation)
            expect(implementation.setup).not.toHaveBeenCalled()
            if (mode === 'dispose-during-setup') await registry.dispose()
            finish()
            await outcome
            if (mode === 'rollback') await registry.rollback(owner)
            expect(registry.get('flags')).toBeUndefined()
            expect(registry.get('flagsCommon')).toBeUndefined()
            await registry.dispose()
            expect(owner.dispose).toHaveBeenCalledTimes(1)
            expect(implementation.dispose).toHaveBeenCalledTimes(1)
        }
    )
})
