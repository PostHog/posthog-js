import type { Client, Extension } from '@posthog/browser-common'
import { ExtensionRegistry } from '../src/extensions/registry'
import { flags } from '../src/flags'
import type { FlagsExtension } from '../src/flags-internal'
import type { BrowserClient } from '../src/browser-client'
import { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import { createPostHog } from '../src/core'
import { createFetch, localRemoteConfig } from './helpers'

const logger = { error: vi.fn() } as unknown as Client['logger']
const makeRegistry = () => new ExtensionRegistry(() => ({}) as Client, logger)

afterEach(() => vi.restoreAllMocks())

describe('extension lookup views', () => {
    it('keeps the flags facade public and gives shared consumers its implementation', async () => {
        const facade = flags({ featureFlagEvaluation: false })
        let shared: PostHogFeatureFlags | undefined
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
                        shared = client.getExtension<PostHogFeatureFlags>('featureFlags')
                    },
                },
            ],
        })
        expect(client.getExtension('featureFlags')).toBe(facade)
        expect(shared).toBeInstanceOf(PostHogFeatureFlags)
        expect(shared).not.toBe(facade)
        expect(setup).toHaveBeenCalledTimes(1)
        const reload = vi.spyOn(shared!, 'reloadFeatureFlagsAsync')
        await expect(facade.reloadFeatureFlags()).resolves.toEqual({ status: 'skipped' })
        expect(reload).toHaveBeenCalledOnce()
        await client.dispose()
        expect(dispose).toHaveBeenCalledTimes(1)
        vi.restoreAllMocks()
    })

    it.each(['rollback', 'failure', 'dispose-during-setup'] as const)(
        'cleans real flag subscriptions and both lookup views on %s',
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
            const facade = flags({ featureFlagEvaluation: false }) as FlagsExtension
            const shared = facade._shared
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
            const installed = registry.install(facade, shared)
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
            expect(registry.getShared('featureFlags')).toBeUndefined()
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

    it('uses the same identity for custom extensions without a shared implementation', async () => {
        const registry = makeRegistry()
        const extension = { name: 'custom', setup: vi.fn(), dispose: vi.fn() }
        await registry.install(extension)
        expect(registry.get('custom')).toBe(extension)
        expect(registry.getShared('custom')).toBe(extension)
        await registry.dispose()
        expect(extension.dispose).toHaveBeenCalledTimes(1)
    })

    it.each(['failure', 'rollback', 'dispose-during-setup'] as const)(
        'removes both views with one lifecycle owner on %s',
        async (mode) => {
            const registry = makeRegistry()
            const implementation = { name: 'flags', setup: vi.fn(), dispose: vi.fn() }
            let finish!: () => void
            const owner = {
                name: 'flags',
                setup: vi.fn(
                    () =>
                        new Promise<void>((resolve, reject) => {
                            finish = () => (mode === 'failure' ? reject(new Error('setup failed')) : resolve())
                        })
                ),
                dispose: vi.fn(() => implementation.dispose()),
            }
            const installed = registry.install(owner, implementation)
            const outcome = installed.catch((error) => error)
            expect(registry.get('flags')).toBe(owner)
            expect(registry.getShared('flags')).toBe(implementation)
            expect(implementation.setup).not.toHaveBeenCalled()
            if (mode === 'dispose-during-setup') await registry.dispose()
            finish()
            await outcome
            if (mode === 'rollback') await registry.rollback(owner)
            expect(registry.get('flags')).toBeUndefined()
            expect(registry.getShared('flags')).toBeUndefined()
            await registry.dispose()
            expect(owner.dispose).toHaveBeenCalledTimes(1)
            expect(implementation.dispose).toHaveBeenCalledTimes(1)
        }
    )
})
