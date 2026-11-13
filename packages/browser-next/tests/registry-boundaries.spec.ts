import type { Client, Extension } from '@posthog/browser-common'
import { ExtensionRegistry } from '../src/extensions/registry'

const deferred = <T>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => {
        resolve = done
    })
    return { promise, resolve }
}
const logger = () => ({ error: vi.fn() }) as unknown as Client['logger']

describe('registry lifecycle and dependency boundaries', () => {
    it('blocks activation and acquisition when host installation authority is revoked', async () => {
        let open = true
        const load = vi.fn()
        const activate = vi.fn()
        const registry = new ExtensionRegistry(
            () => ({}) as Client,
            logger(),
            { dormant: load },
            undefined,
            () => open
        )
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

    it('does not activate an already installed owner', async () => {
        const activate = vi.fn()
        const registry = new ExtensionRegistry(() => ({}) as Client, logger())
        await registry.install({ name: 'product', setup() {} })
        await registry.activate({ name: 'product', activate })
        expect(activate).not.toHaveBeenCalled()
        await registry.dispose()
    })

    it.each(['rollback', 'revoke'] as const)('does not publish setup that finishes after %s', async (mode) => {
        let open = true
        const ready = deferred<void>()
        const target = { name: 'target', setup() {} }
        const product = { name: 'product', bindings: { common: target }, setup: () => ready.promise, dispose: vi.fn() }
        const registry = new ExtensionRegistry(
            () => ({}) as Client,
            logger(),
            {},
            undefined,
            () => open
        )
        const view = {}
        registry.expose(view)
        const installed = registry.install(product).catch((error: unknown) => error)
        const resolved = registry.resolve('product')
        if (mode === 'rollback') await registry.rollback(product)
        else open = false
        ready.resolve()
        expect(await installed).toBeInstanceOf(Error)
        expect(await resolved).toBeUndefined()
        expect(registry.get('product')).toBeUndefined()
        expect(registry.getShared('common')).toBeUndefined()
        expect('product' in view).toBe(false)
        expect(product.dispose).toHaveBeenCalledOnce()
        await registry.dispose()
    })

    it('waits for an in-progress direct installation without using its fallback loader', async () => {
        const ready = deferred<void>()
        const load = vi.fn()
        const product = { name: 'product', setup: () => ready.promise }
        const registry = new ExtensionRegistry(() => ({}) as Client, logger(), { product: load })
        const installed = registry.install(product)
        const resolved = registry.resolve('product')
        expect(registry.get('product')).toBeUndefined()
        ready.resolve()
        await installed
        expect(await resolved).toBe(product)
        expect(load).not.toHaveBeenCalled()
        await registry.dispose()
    })

    it('ignores rollback of an unowned instance and missing optional flush methods', async () => {
        const log = logger()
        const registry = new ExtensionRegistry(() => ({}) as Client, log)
        const unknown = { name: 'unknown', setup() {}, dispose: vi.fn() }
        await expect(registry.rollback(unknown)).resolves.toBeUndefined()
        await registry.install({ name: 'product', setup() {} })
        await registry.flush()
        expect(unknown.dispose).not.toHaveBeenCalled()
        expect(log.error).not.toHaveBeenCalled()
        await registry.dispose()
    })

    it('reports a wrong loader name even when that instance has no disposal method', async () => {
        const log = logger()
        const setup = vi.fn()
        const registry = new ExtensionRegistry(() => ({}) as Client, log, { product: () => ({ name: 'other', setup }) })
        expect(await registry.resolve('product')).toBeUndefined()
        expect(log.error).toHaveBeenCalledWith(
            'Extension "product" loading failed',
            expect.objectContaining({ message: 'Loader for "product" returned extension "other"' })
        )
        expect(setup).not.toHaveBeenCalled()
        await registry.dispose()
    })

    it.each(['removed', 'replaced'] as const)(
        'preserves consumer ownership of a %s namespace during cleanup',
        async (mode) => {
            const dispose = vi.fn()
            const registry = new ExtensionRegistry(() => ({}) as Client, logger())
            const view: { product?: unknown } = {}
            registry.expose(view)
            await registry.install({ name: 'product', setup() {}, dispose })
            delete view.product
            if (mode === 'replaced')
                Object.defineProperty(view, 'product', { configurable: true, value: 'consumer value' })
            await expect(registry.dispose()).resolves.toBeUndefined()
            expect(view.product).toBe(mode === 'replaced' ? 'consumer value' : undefined)
            expect(dispose).toHaveBeenCalledOnce()
        }
    )

    it('allows an installed owner to acquire a dependency that resolves back to it', async () => {
        type Host = Client & { resolve(name: string): Promise<Extension<Host> | undefined> }
        let host!: Host
        const first = {
            name: 'first',
            setup(value: Host) {
                host = value
            },
        }
        let dependency: Extension<Host> | undefined
        const second = {
            name: 'second',
            async setup(value: Host) {
                dependency = await value.resolve('first')
            },
        }
        const registry = new ExtensionRegistry<Host>(
            (_name, resolve) => Object.assign({} as Client, { resolve }),
            logger(),
            { second: () => second }
        )
        await registry.install(first)
        expect(await host.resolve('second')).toBe(second)
        expect(dependency).toBe(first)
        await registry.dispose()
    })

    it('does not mistake a shared dependency diamond for a cycle', async () => {
        type Host = Client & { resolve(name: string): Promise<Extension<Host> | undefined> }
        const leafStarted = deferred<void>()
        const release = deferred<void>()
        const finalStarted = deferred<void>()
        let finalDependency: Extension<Host> | undefined
        const root = { name: 'root', setup() {} }
        const registry = new ExtensionRegistry<Host>(
            (_name, resolve) => Object.assign({} as Client, { resolve }),
            logger(),
            {
                root: async (host) => {
                    await Promise.all([host.resolve('left'), host.resolve('right')])
                    return root
                },
                left: async (host) => {
                    await host.resolve('leaf')
                    return { name: 'left', setup() {} }
                },
                right: async (host) => {
                    await host.resolve('leaf')
                    return { name: 'right', setup() {} }
                },
                leaf: async () => {
                    leafStarted.resolve()
                    await release.promise
                    return { name: 'leaf', setup() {} }
                },
                final: async (host) => {
                    finalStarted.resolve()
                    finalDependency = await host.resolve('root')
                    return { name: 'final', setup() {} }
                },
            }
        )
        const loading = registry.resolve('root')
        await leafStarted.promise
        const final = registry.resolve('final')
        await finalStarted.promise
        release.resolve()
        await Promise.all([loading, final])
        expect(finalDependency).toBe(root)
        await registry.dispose()
    })
})
