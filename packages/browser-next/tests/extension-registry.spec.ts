import type { Client, Extension } from '@posthog/browser-common'
import { FeatureFlagsCommonExtension } from '@posthog/browser-common/extension-tokens'
import { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import { ExtensionRegistry } from '../src/core/extensions/registry'
import { flags } from '../src/products/flags/flags'
import type { IPostHog } from '../src/core/types'
import { createBufferedPostHog as createPostHog, createFetch, localRemoteConfig } from './helpers'

const deferred = <T>() => {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((done, fail) => {
        resolve = done
        reject = fail
    })
    return { promise, resolve, reject }
}
const binding = (): Extension => ({ name: 'binding', setup() {} })
const logger = () => ({ error: vi.fn() }) as unknown as Client['logger']

type Host = Record<string, unknown> & { resolve?(name: string): Promise<Extension<Host> | undefined> }
const makeRegistry = (
    loaders: ConstructorParameters<typeof ExtensionRegistry<Host>>[2] = {},
    canInstall?: () => boolean,
    log = logger()
) => {
    const host: Host = {}
    const registry = new ExtensionRegistry<Host>(host, log, loaders, canInstall)
    host.resolve = (name) => registry.resolve(name)
    return { host, registry, log }
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('extension registry resolution', () => {
    it('shares one acquisition and publishes the extension on the host only after setup', async () => {
        const ready = deferred<void>()
        const target = { name: 'target', setup: vi.fn() }
        const product = { name: 'product', bindings: { common: target }, setup: () => ready.promise, dispose: vi.fn() }
        const load = vi.fn(() => product)
        const { host, registry } = makeRegistry({ product: load })
        expect(load).not.toHaveBeenCalled()
        const first = registry.resolve('product')
        const second = registry.resolve('product')
        expect(second).toBe(first)
        await Promise.resolve()
        expect(load).toHaveBeenCalledOnce()
        expect('product' in host).toBe(false)
        expect(registry.get('product')).toBeUndefined()
        expect(registry.get('common')).toBeUndefined()
        ready.resolve()
        expect(await first).toBe(product)
        expect(await registry.resolve('product')).toBe(product)
        expect(host.product).toBe(product)
        expect(Object.keys(host)).toContain('product')
        expect(registry.get('product')).toBe(product)
        expect(registry.get('common')).toBe(target)
        expect(target.setup).not.toHaveBeenCalled()
        await registry.dispose()
        expect('product' in host).toBe(false)
        expect(registry.get('common')).toBeUndefined()
        expect(product.dispose).toHaveBeenCalledOnce()
    })

    it('returns undefined for names without an installed extension or loader', async () => {
        const { registry, log } = makeRegistry()
        expect(await registry.resolve('missing')).toBeUndefined()
        expect(await registry.resolve('constructor')).toBeUndefined()
        expect(log.error).not.toHaveBeenCalled()
    })

    it('retries acquisition after a failed attempt without reusing a retired instance', async () => {
        const failed = {
            name: 'product',
            setup: vi.fn(() => {
                throw new Error('setup failed')
            }),
            dispose: vi.fn(),
        }
        const next = { name: 'product', setup: vi.fn(), dispose: vi.fn() }
        const load = vi.fn().mockReturnValueOnce(failed).mockReturnValueOnce(next)
        const { registry, log } = makeRegistry({ product: load })
        expect(await registry.resolve('product')).toBeUndefined()
        expect(log.error).toHaveBeenCalledWith('Extension "product" loading failed', expect.any(Error))
        expect(failed.dispose).toHaveBeenCalledOnce()
        await expect(registry.install(failed)).rejects.toThrow('already been disposed')
        expect(await registry.resolve('product')).toBe(next)
        expect(load).toHaveBeenCalledTimes(2)
        await registry.dispose()
        expect(next.dispose).toHaveBeenCalledOnce()
        expect(failed.dispose).toHaveBeenCalledOnce()
    })

    it('releases a late loader result without setup or publication after disposal', async () => {
        const loading = deferred<Extension<Host>>()
        const product = { name: 'product', setup: vi.fn(), dispose: vi.fn() }
        const { host, registry } = makeRegistry({ product: () => loading.promise })
        const pending = registry.resolve('product')
        await Promise.resolve()
        await registry.dispose()
        loading.resolve(product)
        expect(await pending).toBeUndefined()
        expect(product.setup).not.toHaveBeenCalled()
        expect(product.dispose).toHaveBeenCalledOnce()
        expect(registry.get('product')).toBeUndefined()
        expect('product' in host).toBe(false)
    })

    it('releases a late loader result without setup once installation is revoked', async () => {
        let installable = true
        const loading = deferred<Extension<Host>>()
        const product = { name: 'product', setup: vi.fn(), dispose: vi.fn() }
        const { host, registry, log } = makeRegistry({ product: () => loading.promise }, () => installable)
        const pending = registry.resolve('product')
        await Promise.resolve()
        installable = false
        loading.resolve(product)
        expect(await pending).toBeUndefined()
        expect(product.setup).not.toHaveBeenCalled()
        expect(product.dispose).toHaveBeenCalledOnce()
        expect(log.error).not.toHaveBeenCalled()
        expect('product' in host).toBe(false)
    })

    it('reports and disposes a loader result with the wrong name', async () => {
        const setup = vi.fn()
        const dispose = vi.fn()
        const { registry, log } = makeRegistry({ product: () => ({ name: 'other', setup, dispose }) })
        expect(await registry.resolve('product')).toBeUndefined()
        expect(log.error).toHaveBeenCalledWith(
            'Extension "product" loading failed',
            expect.objectContaining({ message: 'Loader for "product" returned extension "other"' })
        )
        expect(setup).not.toHaveBeenCalled()
        expect(dispose).toHaveBeenCalledOnce()
        expect(registry.get('other')).toBeUndefined()
        await registry.dispose()
    })

    it('contains loader failures', async () => {
        const error = new Error('chunk failed')
        const { registry, log } = makeRegistry({
            product: () => {
                throw error
            },
        })
        expect(await registry.resolve('product')).toBeUndefined()
        expect(log.error).toHaveBeenCalledWith('Extension "product" loading failed', error)
    })

    it('lets setup acquire a dependency, including one that resolves back to an installed extension', async () => {
        const first = { name: 'first', setup() {} }
        let dependency: Extension<Host> | undefined
        const second = {
            name: 'second',
            async setup(host: Host) {
                dependency = await host.resolve?.('first')
            },
        }
        let acquired: Extension<Host> | undefined
        const third = {
            name: 'third',
            async setup(host: Host) {
                acquired = await host.resolve?.('second')
            },
        }
        const { host, registry } = makeRegistry({ second: () => second, third: () => third })
        await registry.install(first)
        expect(await host.resolve?.('third')).toBe(third)
        expect(acquired).toBe(second)
        expect(dependency).toBe(first)
        await registry.dispose()
    })

    it('shares one acquisition across a dependency diamond', async () => {
        const leafStarted = deferred<void>()
        const release = deferred<void>()
        const leafLoader = vi.fn(async () => {
            leafStarted.resolve()
            await release.promise
            return { name: 'leaf', setup() {} }
        })
        const dependent = (name: string) => ({
            name,
            async setup(host: Host) {
                await host.resolve?.('leaf')
            },
        })
        const root = {
            name: 'root',
            async setup(host: Host) {
                await Promise.all([host.resolve?.('left'), host.resolve?.('right')])
            },
        }
        const { host, registry } = makeRegistry({
            root: () => root,
            left: () => dependent('left'),
            right: () => dependent('right'),
            leaf: leafLoader,
        })
        const loading = registry.resolve('root')
        await leafStarted.promise
        release.resolve()
        expect(await loading).toBe(root)
        expect(leafLoader).toHaveBeenCalledOnce()
        expect(Object.keys(host).filter((key) => key !== 'resolve')).toEqual(['leaf', 'left', 'right', 'root'])
        await registry.dispose()
    })
})

describe('extension registry activation and installation authority', () => {
    it('blocks activation and acquisition when installation authority is revoked', async () => {
        let open = true
        const load = vi.fn()
        const activate = vi.fn()
        const { registry } = makeRegistry({ dormant: load }, () => open)
        const installed = { name: 'installed', setup() {} }
        await registry.install(installed)
        open = false
        expect(await registry.resolve('installed')).toBeUndefined()
        expect(await registry.resolve('dormant')).toBeUndefined()
        await registry.activate({ name: 'dormant', activate })
        expect(load).not.toHaveBeenCalled()
        expect(activate).not.toHaveBeenCalled()
        expect(registry.get('installed')).toBe(installed)
        await registry.dispose()
    })

    it('activates with the host and an acquisition callback, and skips installed extensions', async () => {
        const product = { name: 'product', setup: vi.fn() }
        const { host, registry } = makeRegistry({ product: () => product })
        const activate = vi.fn((_host: Host, acquire: () => Promise<Extension<Host> | undefined>) => acquire())
        await registry.activate({ name: 'product', activate })
        expect(activate).toHaveBeenCalledWith(host, expect.any(Function))
        expect(host.product).toBe(product)
        await registry.activate({ name: 'product', activate })
        expect(activate).toHaveBeenCalledOnce()
        await registry.dispose()
    })

    it('contains activation failures', async () => {
        const error = new Error('activation failed')
        const { registry, log } = makeRegistry()
        await expect(
            registry.activate({
                name: 'product',
                activate: () => {
                    throw error
                },
            })
        ).resolves.toBeUndefined()
        expect(log.error).toHaveBeenCalledWith('Extension "product" activation failed', error)
    })

    it.each(['revoke', 'dispose'] as const)('does not publish setup that finishes after %s', async (mode) => {
        let open = true
        const ready = deferred<void>()
        const target = { name: 'target', setup() {} }
        const product = { name: 'product', bindings: { common: target }, setup: () => ready.promise, dispose: vi.fn() }
        const { host, registry } = makeRegistry({}, () => open)
        const installed = registry.install(product).catch((error: unknown) => error)
        if (mode === 'revoke') open = false
        else await registry.dispose()
        ready.resolve()
        expect(await installed).toBeInstanceOf(Error)
        expect(registry.get('product')).toBeUndefined()
        expect(registry.get('common')).toBeUndefined()
        expect('product' in host).toBe(false)
        expect(product.dispose).toHaveBeenCalledOnce()
        await registry.dispose()
        expect(product.dispose).toHaveBeenCalledOnce()
    })

    it('disposes an extension during setup, shares its pending acquisition, and does not dispose it again', async () => {
        const ready = deferred<void>()
        const product = { name: 'product', setup: vi.fn(() => ready.promise), dispose: vi.fn(() => ready.resolve()) }
        const { host, registry } = makeRegistry({ product: () => product })
        const first = registry.resolve('product')
        const second = registry.resolve('product')
        expect(second).toBe(first)
        await vi.waitFor(() => expect(product.setup).toHaveBeenCalledOnce())
        await registry.dispose()
        expect(product.dispose).toHaveBeenCalledOnce()
        expect(await first).toBeUndefined()
        expect(await second).toBeUndefined()
        expect('product' in host).toBe(false)
        expect(registry.get('product')).toBeUndefined()
        expect(product.dispose).toHaveBeenCalledOnce()
    })

    it('rejects installation after disposal', async () => {
        const { registry } = makeRegistry()
        await registry.dispose()
        const product = { name: 'product', setup: vi.fn() }
        await expect(registry.install(product)).rejects.toThrow('disposed')
        expect(product.setup).not.toHaveBeenCalled()
    })
})

describe('extension registry lookup namespace', () => {
    it('supports a binding that points to the extension itself', async () => {
        const { registry } = makeRegistry()
        const extension = { name: 'custom', setup: vi.fn(), dispose: vi.fn() }
        Object.assign(extension, { bindings: { customCommon: extension } })
        await registry.install(extension)
        expect(registry.get('custom')).toBe(extension)
        expect(registry.get('customCommon')).toBe(extension)
        await registry.dispose()
        expect(extension.dispose).toHaveBeenCalledOnce()
    })

    it.each([
        ['an installed name', { name: 'owner' }],
        ['an installed binding', { name: 'next', bindings: { common: binding() } }],
        ['a binding that reuses an installed name', { name: 'next', bindings: { owner: binding() } }],
        ['a binding that reuses its own name', { name: 'next', bindings: { next: binding() } }],
        ['a name that reuses an installed binding', { name: 'common' }],
        ['a host member', { name: 'resolve' }],
        ['an empty name', { name: '' }],
        ['an empty binding', { name: 'next', bindings: { '': binding() } }],
    ])('rejects %s atomically', async (_case, conflicting) => {
        const { host, registry } = makeRegistry()
        const target = { name: 'implementation', setup: vi.fn() }
        const owner = { name: 'owner', bindings: { common: target }, setup: vi.fn() }
        await registry.install(owner)
        const extension = { ...conflicting, setup: vi.fn(), dispose: vi.fn() }
        await expect(registry.install(extension)).rejects.toThrow('is invalid or already in use')
        expect(extension.setup).not.toHaveBeenCalled()
        expect(extension.dispose).not.toHaveBeenCalled()
        expect(registry.get('next')).toBeUndefined()
        expect('next' in host).toBe(false)
        expect(registry.get('owner')).toBe(owner)
        expect(registry.get('common')).toBe(target)
        expect(typeof host.resolve).toBe('function')
        await registry.dispose()
    })

    it('reserves names and bindings while setup is in progress', async () => {
        const ready = deferred<void>()
        const { registry } = makeRegistry()
        const first = { name: 'first', bindings: { common: binding() }, setup: () => ready.promise }
        const installing = registry.install(first)
        await expect(registry.install({ name: 'first', setup: vi.fn() })).rejects.toThrow('already in use')
        await expect(
            registry.install({ name: 'other', bindings: { common: binding() }, setup: vi.fn() })
        ).rejects.toThrow('already in use')
        ready.resolve()
        await installing
        expect(registry.get('first')).toBe(first)
        await registry.dispose()
    })

    it.each(['failure', 'dispose-during-setup'] as const)('releases the name and every binding on %s', async (mode) => {
        const { host, registry } = makeRegistry()
        const implementation = { name: 'flags', setup: vi.fn(), dispose: vi.fn() }
        const setup = deferred<void>()
        const owner = {
            name: 'flags',
            bindings: { flagsCommon: implementation },
            setup: vi.fn(() => setup.promise),
            dispose: vi.fn(() => implementation.dispose()),
        }
        const outcome = registry.install(owner).catch((error: unknown) => error)
        expect(registry.get('flags')).toBeUndefined()
        expect(registry.get('flagsCommon')).toBeUndefined()
        if (mode === 'dispose-during-setup') {
            await registry.dispose()
            setup.resolve()
        } else setup.reject(new Error('setup failed'))
        expect(await outcome).toBeInstanceOf(Error)
        expect(registry.get('flags')).toBeUndefined()
        expect(registry.get('flagsCommon')).toBeUndefined()
        expect('flags' in host).toBe(false)
        if (mode === 'failure') {
            const retry = { name: 'flags', bindings: { flagsCommon: binding() }, setup: vi.fn() }
            await registry.install(retry)
            expect(registry.get('flags')).toBe(retry)
        }
        await registry.dispose()
        expect(owner.dispose).toHaveBeenCalledOnce()
        expect(implementation.dispose).toHaveBeenCalledOnce()
        expect(implementation.setup).not.toHaveBeenCalled()
    })

    it('reports cleanup failures after a failed setup and rethrows the setup error', async () => {
        const { registry, log } = makeRegistry()
        const setupError = new Error('setup failed')
        const cleanupError = new Error('cleanup failed')
        await expect(
            registry.install({
                name: 'product',
                setup: () => {
                    throw setupError
                },
                dispose: () => {
                    throw cleanupError
                },
            })
        ).rejects.toBe(setupError)
        expect(log.error).toHaveBeenCalledWith('Extension cleanup failed after setup failed', cleanupError)
    })
})

describe('extension registry flushing and disposal', () => {
    it.each(['flush', 'shutdown'] as const)(
        'awaits each extension once with reason %s, not its bindings',
        async (reason) => {
            const { registry } = makeRegistry()
            const finish = deferred<void>()
            const target = { name: 'target', setup: vi.fn(), flush: vi.fn() }
            const owner = { name: 'owner', setup: vi.fn(), bindings: { target }, flush: vi.fn(() => finish.promise) }
            Object.assign(owner.bindings, { alias: owner })
            await registry.install(owner)
            await registry.install({ name: 'without-flush', setup: vi.fn() })
            let settled = false
            const pending = registry.flush(reason).then(() => {
                settled = true
            })
            await Promise.resolve()
            expect(settled).toBe(false)
            expect(owner.flush).toHaveBeenCalledOnce()
            expect(owner.flush).toHaveBeenCalledWith(reason)
            expect(target.flush).not.toHaveBeenCalled()
            finish.resolve()
            await pending
            await registry.dispose()
            await registry.flush()
            expect(owner.flush).toHaveBeenCalledOnce()
        }
    )

    it('isolates synchronous and asynchronous flush failures', async () => {
        const { registry, log } = makeRegistry()
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
        expect(flush).toHaveBeenCalledOnce()
        expect(flush).toHaveBeenCalledWith('flush')
        expect(log.error).toHaveBeenCalledWith('Extension "sync" flush failed', error)
        expect(log.error).toHaveBeenCalledWith('Extension "async" flush failed', error)
    })

    it('does not flush failed installations', async () => {
        const { registry } = makeRegistry()
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
        await registry.flush()
        expect(flush).not.toHaveBeenCalled()
    })

    it('disposes every extension once, concurrently, and isolates cleanup failures', async () => {
        const { host, registry, log } = makeRegistry()
        const error = new Error('cleanup failed')
        const stuck = deferred<void>()
        const order: string[] = []
        await registry.install({
            name: 'first',
            setup() {},
            dispose: () => {
                order.push('first')
                throw error
            },
        })
        await registry.install({
            name: 'second',
            setup() {},
            dispose: () => {
                order.push('second')
                return stuck.promise
            },
        })
        const third = vi.fn()
        await registry.install({ name: 'third', setup() {}, dispose: third })
        const disposal = registry.dispose()
        expect(Object.keys(host)).toEqual(['resolve'])
        expect(third).toHaveBeenCalledOnce()
        expect(order).toEqual(['second', 'first'])
        stuck.resolve()
        await disposal
        expect(log.error).toHaveBeenCalledWith('Extension "first" cleanup failed', error)
        await registry.dispose()
        expect(third).toHaveBeenCalledOnce()
    })
})

describe('feature flags in the client namespace', () => {
    const base = {
        projectToken: 'ph_test',
        storage: false,
        navigator: false,
        capturePageview: false,
        remoteConfig: localRemoteConfig,
    } as const

    it('publishes the browser facade as a client property and its shared implementation as a binding', async () => {
        const facade = flags({ featureFlagEvaluation: false })
        const setup = vi.spyOn(PostHogFeatureFlags.prototype, 'setup')
        const dispose = vi.spyOn(PostHogFeatureFlags.prototype, 'dispose')
        let shared: PostHogFeatureFlags | undefined
        let host: unknown
        const client = await createPostHog({
            ...base,
            fetch: createFetch([]),
            extensions: [
                facade,
                {
                    name: 'consumer',
                    setup(value) {
                        host = value
                        shared = value.getExtension<PostHogFeatureFlags>(FeatureFlagsCommonExtension)
                    },
                },
            ],
        })
        expect(host).toBe(client)
        expect(client.featureFlags).toBe(facade)
        expect(client.getExtension('featureFlags')).toBe(facade)
        expect(await client.resolveExtension('featureFlags')).toBe(facade)
        expect(shared).toBeInstanceOf(PostHogFeatureFlags)
        expect(client.getExtension(FeatureFlagsCommonExtension)).toBe(shared)
        expect(setup).toHaveBeenCalledOnce()
        expect(setup).toHaveBeenCalledWith(client)
        const reload = vi.spyOn(shared!, 'reloadFeatureFlagsAsync')
        await expect(facade.reloadFeatureFlags()).resolves.toEqual({ status: 'skipped' })
        expect(reload).toHaveBeenCalledOnce()
        await client.dispose()
        expect(dispose).toHaveBeenCalledOnce()
        expect(client.featureFlags).toBeUndefined()
        expect(client.getExtension(FeatureFlagsCommonExtension)).toBeUndefined()
        expect(await client.resolveExtension('featureFlags')).toBeUndefined()
    })

    it.each(['dispose', 'failure', 'dispose-during-setup'] as const)(
        'removes real flag subscriptions and bindings on %s',
        async (mode) => {
            const client: IPostHog = await createPostHog({ ...base, fetch: false })
            const facade = flags({ featureFlagEvaluation: false })
            const shared = facade.bindings![FeatureFlagsCommonExtension] as PostHogFeatureFlags
            const setup = vi.spyOn(shared, 'setup')
            const dispose = vi.spyOn(shared, 'dispose')
            const reload = vi.spyOn(shared, 'reloadFeatureFlags')
            const reset = vi.spyOn(shared, 'reset')
            const registry = new ExtensionRegistry<IPostHog>(client, client.logger)
            const ready = deferred<void>()
            if (mode === 'dispose-during-setup') {
                vi.spyOn(client.kv, 'initialize').mockImplementation(() => ready.promise)
            } else if (mode === 'failure') {
                vi.spyOn(client, 'onReset').mockImplementation(() => {
                    throw new Error('listener setup failed')
                })
            }
            const outcome = registry.install(facade).catch((error: unknown) => error)
            if (mode === 'dispose-during-setup') {
                await vi.waitFor(() => expect(client.kv.initialize).toHaveBeenCalled())
                await registry.dispose()
                ready.resolve()
            }
            await outcome
            expect(setup).toHaveBeenCalledOnce()
            if (mode === 'dispose') {
                expect(client.featureFlags).toBe(facade)
                reload.mockClear()
                client.identify('person')
                expect(reload).toHaveBeenCalledTimes(1)
                client.group('company', 'team')
                expect(reload).toHaveBeenCalledTimes(2)
                client.resetGroups()
                expect(reload).toHaveBeenCalledTimes(3)
                client.reset()
                expect(reload).toHaveBeenCalledTimes(4)
                client.setPersonProperties({ plan: 'paid' })
                expect(reload).toHaveBeenCalledTimes(5)
                expect(reset).toHaveBeenCalledOnce()
                await registry.dispose()
            }
            expect(client.featureFlags).toBeUndefined()
            expect(registry.get('featureFlags')).toBeUndefined()
            expect(registry.get(FeatureFlagsCommonExtension)).toBeUndefined()
            reload.mockClear()
            reset.mockClear()
            client.identify('after-cleanup')
            client.setPersonProperties({ plan: 'free' })
            client.group('company', 'after-cleanup')
            client.resetGroups()
            client.reset()
            expect(reload).not.toHaveBeenCalled()
            expect(reset).not.toHaveBeenCalled()
            expect(dispose).toHaveBeenCalledOnce()
            await client.dispose()
        }
    )
})
