import type { Client } from '@posthog/browser-common'

import { createPostHog, type Extension, type RemoteConfig } from '../src'
import { createFetch, MemoryStorage, type SentRequest } from './helpers'

const createRemoteConfig = (overrides: Partial<RemoteConfig> = {}): RemoteConfig =>
    ({ supportedCompression: [], ...overrides }) as RemoteConfig

interface FlagCapability extends Extension {
    getFlag(key: string): string | undefined
}

const flagExtension = (events: string[]): FlagCapability => {
    let propertyRegistration: { dispose(): void } | undefined

    return {
        name: 'flags',
        setup(client: Client) {
            events.push('flags:setup')
            propertyRegistration = client.registerDynamicEventProperties(() => ({ feature_context: 'ready' }))
        },
        dispose() {
            events.push('flags:dispose')
            propertyRegistration?.dispose()
        },
        getFlag(key: string) {
            return key === 'beta' ? 'enabled' : undefined
        },
    }
}

describe('@posthog/browser extensions', () => {
    it('installs an extension and exposes its capability', async () => {
        const requests: SentRequest[] = []
        const events: string[] = []
        const extension = flagExtension(events)
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
            extensions: [extension],
        })

        expect(posthog.getExtension<FlagCapability>('flags')?.getFlag('beta')).toBe('enabled')
        await posthog.capture('event')
        expect(requests[0]?.body?.properties).toMatchObject({ feature_context: 'ready' })

        await posthog.dispose()
        expect(events).toEqual(['flags:setup', 'flags:dispose'])
    })

    it('keeps extension and key names from changing object prototypes', async () => {
        let storedValue: unknown
        const extension: Extension = {
            name: '__proto__',
            setup(client) {
                client.kv.set('polluted', 'safe')
                storedValue = client.kv.get('polluted')
            },
            dispose() {},
        }

        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            extensions: [extension],
        })

        expect(storedValue).toBe('safe')
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
        await posthog.dispose()
    })

    it('gives each extension an independent key-value namespace', async () => {
        const values: unknown[] = []
        const createExtension = (name: string, value: string): Extension => ({
            name,
            setup(client) {
                client.kv.set('shared-key', value)
                values.push(client.kv.get('shared-key'))
            },
            dispose() {},
        })
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            extensions: [createExtension('one', 'first'), createExtension('two', 'second')],
        })

        expect(values).toEqual(['first', 'second'])
        await posthog.dispose()
    })

    it('blocks extension key-value access after denial and disposal without changing persistence', async () => {
        const storage = new MemoryStorage()
        let client: Client | undefined
        const extension: Extension = {
            name: 'stateful',
            setup(extensionClient) {
                client = extensionClient
            },
            dispose() {},
        }
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
            extensions: [extension],
        })
        client?.kv.set('retained', true)

        posthog.optOut()
        client?.kv.set('denied', true)
        client?.kv.remove('retained')
        expect(client?.kv.get('retained')).toBeUndefined()
        posthog.optIn()
        expect(client?.kv.get('retained')).toBeUndefined()
        expect(client?.kv.get('denied')).toBeUndefined()
        client?.kv.set('after_grant', true)

        await posthog.dispose()
        client?.kv.set('disposed', true)
        client?.kv.remove('after_grant')
        const reloaded = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        const reloadedClient = await reloaded.installExtension({
            name: 'stateful',
            setup(nextClient) {
                expect(nextClient.kv.get('after_grant')).toBe(true)
                expect(nextClient.kv.get('disposed')).toBeUndefined()
            },
            dispose() {},
        })
        reloadedClient.dispose()
    })

    it('provides live client identity and stable SDK metadata', async () => {
        let client: Client | undefined
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            initialPersonProperties: { initial: { source: 'person-property' } },
            extensions: [
                {
                    name: 'identity',
                    setup(extensionClient) {
                        client = extensionClient
                    },
                    dispose() {},
                },
            ],
        })
        const initialAnonymousId = posthog.anonymousId

        expect(client?.anonymousId).toBe(initialAnonymousId)
        expect(client?.deviceId).toBe(initialAnonymousId)
        expect(client?.library).toEqual({ name: 'web', version: expect.any(String) })
        expect(client?.initialPersonProperties).toEqual({ initial: { source: 'person-property' } })
        expect(Object.isFrozen(client?.library)).toBe(true)
        expect(Object.isFrozen(client?.initialPersonProperties)).toBe(true)
        expect(Object.isFrozen(client?.initialPersonProperties.initial)).toBe(true)

        posthog.optOut()
        expect(client?.deviceId).toBeUndefined()
        posthog.optIn()
        const postConsentAnonymousId = posthog.anonymousId
        expect(client?.deviceId).toBe(postConsentAnonymousId)
        await posthog.identify('user-123')
        expect(client?.distinctId).toBe('user-123')
        expect(client?.anonymousId).toBe(postConsentAnonymousId)
        expect(client?.deviceId).toBe(postConsentAnonymousId)
    })

    it('gates extension transport and remote configuration with consent and bot filtering', async () => {
        const requests: SentRequest[] = []
        const denied = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
            optOutByDefault: true,
            remoteConfigLoader: async () => ({ supportedCompression: [] }) as never,
        })

        await expect(denied.sendRequest('/flags/')).resolves.toMatchObject({ statusCode: 0 })
        await expect(denied.getRemoteConfig()).resolves.toBeUndefined()
        await expect(denied.installExtension({ name: 'denied', setup() {}, dispose() {} })).rejects.toThrow('disabled')

        const blocked = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: { userAgent: 'Googlebot/2.1' },
            fetch: createFetch(requests),
            remoteConfigLoader: async () => ({ supportedCompression: [] }) as never,
        })
        await expect(blocked.sendRequest('/flags/')).resolves.toMatchObject({ statusCode: 0 })
        await expect(blocked.getRemoteConfig()).resolves.toBeUndefined()
        expect(requests).toHaveLength(0)
    })

    it('drops remote configuration and extension loading completed after denial', async () => {
        let finishConfig: ((value: RemoteConfig) => void) | undefined
        const remoteConfig = new Promise<RemoteConfig>((resolve) => {
            finishConfig = resolve
        })
        let finishExtension: ((value: Extension) => void) | undefined
        const extension = new Promise<Extension>((resolve) => {
            finishExtension = resolve
        })
        const dispose = jest.fn()
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            remoteConfigLoader: () => remoteConfig,
        })
        const configResult = posthog.getRemoteConfig()
        const extensionResult = posthog.loadExtension(() => extension)

        posthog.optOut()
        finishConfig?.(createRemoteConfig({ hasFeatureFlags: true }))
        finishExtension?.({ name: 'late', setup: jest.fn(), dispose })

        await expect(configResult).resolves.toBeUndefined()
        await expect(extensionResult).rejects.toThrow('disabled')
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(posthog.getExtension('late')).toBeUndefined()
    })

    it('provides the shared project token and request transport', async () => {
        const requests: SentRequest[] = []
        let observedProjectToken: string | undefined
        let responseStatus: number | undefined
        const extension: Extension = {
            name: 'transport',
            async setup(client) {
                observedProjectToken = client.projectToken
                responseStatus = (await client.sendRequest('/flags/')).statusCode
            },
        }

        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
            extensions: [extension],
        })

        expect(observedProjectToken).toBe('ph_test')
        expect(responseStatus).toBe(200)
        expect(requests[0]?.url.pathname).toBe('/flags/')
        await posthog.dispose()
    })

    it('rejects duplicate names', async () => {
        const posthog = await createPostHog({ projectToken: 'ph_test', storage: false, navigator: false, fetch: false })
        await posthog.installExtension(flagExtension([]))

        await expect(posthog.installExtension(flagExtension([]))).rejects.toThrow('already installed')
    })

    it('disposes a failed extension and rolls back its reservation', async () => {
        const dispose = jest.fn()
        const failed: Extension = {
            name: 'failed',
            setup() {
                throw new Error('setup failed')
            },
            dispose,
        }
        const posthog = await createPostHog({ projectToken: 'ph_test', storage: false, navigator: false, fetch: false })

        await expect(posthog.installExtension(failed)).rejects.toThrow('setup failed')
        expect(dispose).toHaveBeenCalledTimes(1)
        await expect(posthog.installExtension({ name: 'failed', setup() {}, dispose() {} })).resolves.toBeDefined()
    })

    it('disposes an extension that finishes setup after client disposal', async () => {
        let finishSetup: (() => void) | undefined
        const setupGate = new Promise<void>((resolve) => {
            finishSetup = resolve
        })
        const dispose = jest.fn()
        const extension: Extension = {
            name: 'pending',
            async setup() {
                await setupGate
            },
            dispose,
        }
        const posthog = await createPostHog({ projectToken: 'ph_test', storage: false, navigator: false, fetch: false })

        const installation = posthog.installExtension(extension)
        await posthog.dispose()
        expect(dispose).toHaveBeenCalledTimes(1)

        finishSetup?.()
        await expect(installation).rejects.toThrow('disposed during setup')
        expect(dispose).toHaveBeenCalledTimes(1)
    })

    it('keeps capture available when configured extension setup fails', async () => {
        const requests: SentRequest[] = []
        const firstDispose = jest.fn()
        const failedDispose = jest.fn()
        const first: Extension = { name: 'first', setup() {}, dispose: firstDispose }
        const failed: Extension = {
            name: 'failed',
            setup() {
                throw new Error('failed setup')
            },
            dispose: failedDispose,
        }

        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
            extensions: [first, failed],
        })
        await posthog.capture('still_available')

        expect(requests).toHaveLength(1)
        expect(firstDispose).not.toHaveBeenCalled()
        expect(failedDispose).toHaveBeenCalledTimes(1)
        await posthog.dispose()
        expect(firstDispose).toHaveBeenCalledTimes(1)
    })

    it('disposes extensions in reverse installation order', async () => {
        const events: string[] = []
        const createExtension = (name: string): Extension => ({
            name,
            setup() {
                events.push(`${name}:setup`)
            },
            dispose() {
                events.push(`${name}:dispose`)
            },
        })
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            extensions: [createExtension('one'), createExtension('two')],
        })

        await posthog.dispose()
        expect(events).toEqual(['one:setup', 'two:setup', 'two:dispose', 'one:dispose'])
    })
})
