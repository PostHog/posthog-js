import type { Client, Extension } from '@posthog/browser-common'
import { ExtensionRegistry } from '../src/core/extensions/registry'

const deferred = <T>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => {
        resolve = done
    })
    return { promise, resolve }
}
const logger = () => ({ error: vi.fn() }) as unknown as Client['logger']

describe('extension registry resolution', () => {
    it('shares acquisition and readiness without publishing owners or shared bindings during setup', async () => {
        const ready = deferred<void>()
        const shared = { name: 'shared', setup: vi.fn() }
        const owner = { name: 'product', bindings: { product: shared }, setup: () => ready.promise, dispose: vi.fn() }
        const load = vi.fn(() => owner)
        const registry = new ExtensionRegistry(() => ({}) as Client, logger(), { product: load })
        const view: { product?: typeof owner } = {}
        registry.expose(view)
        expect(view.product).toBeUndefined()
        expect(load).not.toHaveBeenCalled()
        const first = registry.resolve('product')
        const second = registry.resolve('product')
        expect(second).toBe(first)
        await Promise.resolve()
        expect(load).toHaveBeenCalledOnce()
        expect(view.product).toBeUndefined()
        expect(registry.getShared('product')).toBeUndefined()
        ready.resolve()
        expect(await first).toBe(owner)
        expect(await second).toBe(owner)
        expect(view.product).toBe(owner)
        expect(registry.getShared('product')).toBe(shared)
        expect(shared.setup).not.toHaveBeenCalled()
        await registry.dispose()
        expect(view.product).toBeUndefined()
        expect(owner.dispose).toHaveBeenCalledOnce()
    })

    it('retries acquisition after a failed attempt without reusing a retired owner', async () => {
        const failed = {
            name: 'product',
            setup: vi.fn(() => {
                throw new Error('setup failed')
            }),
            dispose: vi.fn(),
        }
        const next = { name: 'product', setup: vi.fn(), dispose: vi.fn() }
        const load = vi.fn().mockReturnValueOnce(failed).mockReturnValueOnce(next)
        const registry = new ExtensionRegistry(() => ({}) as Client, logger(), { product: load })
        expect(await registry.resolve('product')).toBeUndefined()
        expect(failed.dispose).toHaveBeenCalledOnce()
        await expect(registry.install(failed)).rejects.toThrow('already been disposed')
        expect(await registry.resolve('product')).toBe(next)
        expect(load).toHaveBeenCalledTimes(2)
        await registry.dispose()
        expect(next.dispose).toHaveBeenCalledOnce()
    })

    it('releases a late loader result without setup or publication after disposal', async () => {
        const loading = deferred<Extension>()
        const owner = { name: 'product', setup: vi.fn(), dispose: vi.fn() }
        const registry = new ExtensionRegistry(() => ({}) as Client, logger(), { product: () => loading.promise })
        const pending = registry.resolve('product')
        await Promise.resolve()
        await registry.dispose()
        loading.resolve(owner)
        expect(await pending).toBeUndefined()
        expect(owner.setup).not.toHaveBeenCalled()
        expect(owner.dispose).toHaveBeenCalledOnce()
        expect(registry.get('product')).toBeUndefined()
    })

    it('contains cyclic setup dependencies without leaving unresolved readiness', async () => {
        type Host = { resolve(name: string): Promise<Extension<Host> | undefined> }
        const log = logger()
        let backReference: Extension<Host> | undefined
        const second = {
            name: 'second',
            async setup(host: Host) {
                backReference = await host.resolve('first')
            },
        }
        const first = {
            name: 'first',
            async setup(host: Host) {
                await host.resolve('second')
            },
        }
        const registry = new ExtensionRegistry<Host>((_name, resolve) => ({ resolve }), log, {
            first: () => first,
            second: () => second,
        })
        expect(await registry.resolve('first')).toBe(first)
        expect(backReference).toBeUndefined()
        expect(log.error).toHaveBeenCalledWith('Circular extension dependency: "second" -> "first"', expect.any(Error))
        await registry.dispose()
    })
})
