import type { Client, Extension } from '@posthog/browser-common'
import { createPostHog } from '../src/core'
import { localRemoteConfig, MemoryStorage } from './helpers'

const options = {
    projectToken: 'ph_kv',
    storage: false,
    navigator: false,
    fetch: false,
    capturePageview: false,
    remoteConfig: localRemoteConfig,
} as const

describe('KV dependency lifetime', () => {
    it.each([false, true])('keeps reads through async extension cleanup, including timeout=%s', async (timeout) => {
        let view!: Client
        let release!: () => void
        let entered!: () => void
        const started = new Promise<void>((resolve) => {
            entered = resolve
        })
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const reads: unknown[] = []
        const extension: Extension = {
            name: 'dependent',
            setup(client) {
                view = client
                client.kv.set('retained', { value: 1 })
            },
            async dispose() {
                reads.push(view.kv.get('retained'))
                view.kv.set('retained', 'overwrite')
                view.kv.remove('retained')
                entered()
                await gate
                reads.push(view.kv.get('retained'))
                view.kv.set('late', true)
            },
        }
        const client = await createPostHog({ ...options, extensions: [extension] })
        client.kv.set('core', 'retained')
        const events = vi.fn()
        client.onEvent(events)
        const id = client.distinctId
        const shutdown = client.shutdown(timeout ? 0 : 1000)
        await started
        if (timeout) await shutdown
        expect(view.kv.get('retained')).toEqual({ value: 1 })
        expect(client.kv.get('core')).toBe('retained')
        client.capture('closed')
        await client.identify('closed')
        client.reset()
        expect(client.distinctId).toBe(id)
        expect(events).not.toHaveBeenCalled()
        release()
        await shutdown
        await vi.waitFor(() => expect(view.kv.get('retained')).toBeUndefined())
        expect(reads).toEqual([{ value: 1 }, { value: 1 }])
        expect(client.kv.get('core')).toBeUndefined()
        expect(view.kv.get('late')).toBeUndefined()
    })

    it('retains consent-independent read access and does not persist cleanup writes', async () => {
        const storage = new MemoryStorage()
        let view!: Client
        const client = await createPostHog({
            ...options,
            storage,
            optOutByDefault: true,
            extensions: [
                {
                    name: 'dependent',
                    setup(value) {
                        view = value
                        view.kv.set('config', { enabled: true })
                    },
                    dispose() {
                        expect(view.kv.get('config')).toEqual({ enabled: true })
                        view.kv.set('config', { enabled: false })
                        view.kv.remove('config')
                    },
                },
            ],
        })
        await client.shutdown()
        const stored = JSON.parse(storage.values.get('ph_ph_kv_posthog_browser_v2')!)
        expect(stored.extensionData.dependent.config).toEqual({ enabled: true })
    })

    it('does not initialize persistence when a pending read becomes available during cleanup', async () => {
        let readable = false
        const write = vi.fn()
        const client = await createPostHog({
            ...options,
            storage: {
                getItem() {
                    if (!readable) throw new Error('unavailable')
                    return null
                },
                setItem: write,
                removeItem() {},
            },
            extensions: [
                {
                    name: 'dependent',
                    setup() {},
                    dispose() {
                        readable = true
                        expect(client.kv.get('missing')).toBeUndefined()
                    },
                },
            ],
        })
        await client.shutdown()
        expect(write).not.toHaveBeenCalled()
    })

    it('rechecks write authority after an application getter starts shutdown', async () => {
        let view!: Client
        let readInCleanup: unknown
        const client = await createPostHog({
            ...options,
            extensions: [
                {
                    name: 'dependent',
                    setup(value) {
                        view = value
                        view.kv.set('retained', 'before')
                    },
                    dispose() {
                        readInCleanup = view.kv.get('retained')
                    },
                },
            ],
        })
        let shutdown: Promise<void> | undefined
        view.kv.set({
            get retained() {
                shutdown = client.shutdown()
                return 'after'
            },
        })
        await shutdown
        expect(readInCleanup).toBe('before')
    })
})
