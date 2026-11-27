import type { ExtensionToken } from '@posthog/browser-common'
import type { BrowserExtension } from '../src/core/context/browser-client'
import type { IPostHog } from '../src/core/types'
import { createPostHogCore } from '../src/core/posthog'
import { createPostHog } from '../src/composition/npm/core'
import { createAnalyticsDelivery } from '../src/products/analytics/delivery/analytics-delivery'
import { localRemoteConfig, MemoryStorage } from './helpers'

const options = {
    projectToken: 'ph_resolution',
    storage: false,
    navigator: false,
    fetch: false,
    capturePageview: false,
    remoteConfig: localRemoteConfig,
} as const

it('resolves typed custom extensions for the application and for other extensions', async () => {
    interface Probe extends BrowserExtension {
        read(): string
    }
    const Probe = 'probe' as ExtensionToken<Probe>
    let host: IPostHog | undefined
    const probe: Probe = { name: Probe, setup() {}, read: () => 'ready' }
    const client = await createPostHog({
        ...options,
        extensions: [
            probe,
            {
                name: 'observer',
                setup(value) {
                    host = value
                },
            },
        ],
    })
    expect((await client.resolveExtension(Probe))?.read()).toBe('ready')
    expect(host).toBe(client)
    expect(client.getExtension(Probe)).toBe(probe)
    expect(Reflect.get(client, 'probe')).toBe(probe)
    expect(await client.resolveExtension('missing')).toBeUndefined()
    await client.dispose()
    expect(await client.resolveExtension(Probe)).toBeUndefined()
    expect(Reflect.get(client, 'probe')).toBeUndefined()
})

it('supplies client persistence before a generic loader and publishes only after setup', async () => {
    const storage = new MemoryStorage()
    const writer = await createPostHog({
        ...options,
        storage,
        extensions: [
            {
                name: 'probe',
                setup(host) {
                    host.kv.set('saved', 'value')
                },
            },
        ],
    })
    await writer.dispose()
    let loadingHost: IPostHog | undefined
    let saved: unknown
    const probe = { name: 'probe', setup: vi.fn(), dispose: vi.fn() }
    const load = vi.fn(() => {
        loadingHost = client
        saved = client.kv.get('saved')
        expect(Reflect.get(client, 'probe')).toBeUndefined()
        return probe
    })
    const client = await createPostHogCore({ ...options, storage }, createAnalyticsDelivery, [], { probe: load })
    expect(Reflect.get(client, 'probe')).toBeUndefined()
    expect(load).not.toHaveBeenCalled()
    const [first, second] = await Promise.all([client.resolveExtension('probe'), client.resolveExtension('probe')])
    expect(first).toBe(probe)
    expect(second).toBe(probe)
    expect(saved).toBe('value')
    expect(probe.setup).toHaveBeenCalledWith(loadingHost)
    expect(load).toHaveBeenCalledOnce()
    await client.dispose()
    expect(probe.dispose).toHaveBeenCalledOnce()
})
