import type { Client, Extension } from '@posthog/browser-common'
import { ExtensionRegistry } from '../src/extensions/registry'
import { flags } from '../src/flags'
import { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import { createPostHog } from '../src/core'
import { createFetch, localRemoteConfig } from './helpers'

const logger = { error: vi.fn() } as unknown as Client['logger']
const makeRegistry = () => new ExtensionRegistry(() => ({}) as Client, logger)

describe('extension lookup views', () => {
    it('keeps the flags facade public and gives shared consumers its implementation', async () => {
        const facade = flags({ featureFlagEvaluation: false })
        let shared: Extension | undefined
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
                        shared = client.getExtension('featureFlags')
                    },
                },
            ],
        })
        expect(client.getExtension('featureFlags')).toBe(facade)
        expect(shared).toBeInstanceOf(PostHogFeatureFlags)
        expect(shared).not.toBe(facade)
        expect(setup).toHaveBeenCalledTimes(1)
        await client.dispose()
        expect(dispose).toHaveBeenCalledTimes(1)
        vi.restoreAllMocks()
    })

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
