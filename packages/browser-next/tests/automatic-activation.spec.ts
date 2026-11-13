import type { BrowserExtension } from '../src/browser-client'
import type { IPostHog, PostHogOptions, RemoteConfig } from '../src/types'
import { createPostHog as createCore } from '../src/core'
import { AUTOCAPTURE_DISABLED_SERVER_SIDE } from '@posthog/browser-common/constants'
import { SURVEYS } from '@posthog/browser-common/surveys-config'
import { MemoryStorage, localRemoteConfig } from './helpers'

const base = {
    projectToken: 'ph_activation',
    storage: false,
    navigator: false,
    fetch: false,
    capturePageview: false,
    analytics: false,
    flags: false,
    logs: false,
    surveys: false,
    autocapture: false,
} as const
const inactive: RemoteConfig = {
    ...localRemoteConfig,
    logs: { captureConsoleLogs: false },
    surveys: false,
    autocapture_opt_out: true,
}
const products = [
    {
        name: 'logs',
        module: '../src/logs',
        factory: 'logs',
        key: 'consoleCaptureEnabled',
        cached: true,
        enabled: { ...inactive, logs: { captureConsoleLogs: true } },
    },
    {
        name: 'surveys',
        module: '../src/automatic-surveys',
        factory: 'surveys',
        key: SURVEYS,
        cached: [{ id: 'cached' }],
        enabled: { ...inactive, surveys: true },
    },
    {
        name: 'autocapture',
        module: '../src/autocapture',
        factory: 'autocapture',
        key: AUTOCAPTURE_DISABLED_SERVER_SIDE,
        cached: false,
        enabled: { ...inactive, autocapture_opt_out: false },
    },
] as const
const clients: IPostHog[] = []
afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    for (const product of products) vi.doUnmock(product.module)
    vi.resetModules()
})

for (const product of products) {
    describe(`${product.name} automatic activation`, () => {
        const mock = () => {
            const extension: BrowserExtension = { name: product.name, setup: vi.fn(), dispose: vi.fn() }
            const imported = vi.fn()
            vi.doMock(product.module, () => {
                imported()
                return { [product.factory]: () => extension }
            })
            return { extension, imported }
        }
        const create = async (options: Partial<PostHogOptions>) => {
            const { createPostHog } = await import('../src')
            const client = await createPostHog({ ...base, [product.name]: undefined, ...options })
            clients.push(client)
            return client
        }

        it('stays unloaded without activation signals but can be explicitly acquired', async () => {
            const { extension, imported } = mock()
            const client = await create({ remoteConfig: inactive })
            expect(imported).not.toHaveBeenCalled()
            expect(Reflect.get(client, product.name)).toBeUndefined()
            expect(await client.resolveExtension(product.name)).toBe(extension)
            expect(Reflect.get(client, product.name)).toBe(extension)
            expect(imported).toHaveBeenCalledOnce()
            expect(extension.setup).toHaveBeenCalledOnce()
        })

        it('loads an explicitly configured product before factory readiness', async () => {
            const { extension, imported } = mock()
            const client = await create({ remoteConfig: inactive, [product.name]: {} })
            expect(Reflect.get(client, product.name)).toBe(extension)
            expect(imported).toHaveBeenCalledOnce()
        })

        it('loads from an inline activation signal before factory readiness', async () => {
            const { extension, imported } = mock()
            const client = await create({ remoteConfig: product.enabled })
            expect(Reflect.get(client, product.name)).toBe(extension)
            expect(imported).toHaveBeenCalledOnce()
        })

        it('loads from saved product state without waiting for remote configuration', async () => {
            const { extension, imported } = mock()
            const storage = new MemoryStorage()
            const writer = await createCore({
                ...base,
                storage,
                extensions: [
                    {
                        name: product.name,
                        setup(host) {
                            host.kv.set(product.key, product.cached)
                        },
                    },
                ],
            })
            await writer.dispose()
            const client = await create({ storage, fetch: () => new Promise(() => {}) })
            expect(Reflect.get(client, product.name)).toBe(extension)
            expect(imported).toHaveBeenCalledOnce()
        })

        it('acquires after a delayed remote activation signal', async () => {
            const { extension, imported } = mock()
            let respond!: (response: Response) => void
            const pending = new Promise<Response>((resolve) => {
                respond = resolve
            })
            const client = await create({ fetch: () => pending })
            expect(imported).not.toHaveBeenCalled()
            respond(new Response(JSON.stringify(product.enabled)))
            await client.getRemoteConfig()
            await vi.waitFor(() => expect(Reflect.get(client, product.name)).toBe(extension))
            expect(imported).toHaveBeenCalledOnce()
        })

        it('does not implicitly activate an explicitly disabled product', async () => {
            const { imported } = mock()
            const client = await create({ remoteConfig: product.enabled, [product.name]: false })
            expect(Reflect.get(client, product.name)).toBeUndefined()
            expect(await client.resolveExtension(product.name)).toBeUndefined()
            expect(imported).not.toHaveBeenCalled()
        })

        it('does not acquire from a remote result arriving after disposal', async () => {
            const { imported } = mock()
            let respond!: (response: Response) => void
            const pending = new Promise<Response>((resolve) => {
                respond = resolve
            })
            const client = await create({ fetch: () => pending })
            await client.dispose()
            respond(new Response(JSON.stringify(product.enabled)))
            await client.getRemoteConfig()
            expect(imported).not.toHaveBeenCalled()
            expect(Reflect.get(client, product.name)).toBeUndefined()
        })
    })
}
