import type { Client, ExtensionToken } from '@posthog/browser-common'

import { analytics as createAnalytics } from '../src/analytics'
import { createPostHog, type Extension, type RemoteConfig } from '../src/core'
import { createFetch, MemoryStorage, type SentRequest } from './helpers'

const analytics = () => createAnalytics({ flushAt: 1, flushInterval: 0 })

const createRemoteConfig = (overrides: Partial<RemoteConfig> = {}): RemoteConfig =>
    ({ supportedCompression: [], ...overrides }) as RemoteConfig

interface FlagCapability extends Extension {
    getFlag(key: string): string | undefined
}

const FlagsExtension = 'flags' as ExtensionToken<FlagCapability>

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
        let extensionCanCapture: boolean | undefined
        let flagFromExtension: string | undefined
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
            extensions: [
                analytics(),
                extension,
                {
                    name: 'consumer',
                    setup(client) {
                        extensionCanCapture = client.canCapture
                        flagFromExtension = client.getExtension(FlagsExtension)?.getFlag('beta')
                    },
                },
            ],
        })

        expect(posthog.canCapture).toBe(true)
        expect(extensionCanCapture).toBe(true)
        expect(flagFromExtension).toBe('enabled')
        expect(posthog.getExtension(FlagsExtension)?.getFlag('beta')).toBe('enabled')
        await posthog.capture('event')
        await posthog.flush()
        const batch = requests[0]?.body?.batch as Array<{ properties: Record<string, unknown> }> | undefined
        expect(batch?.[0]?.properties).toMatchObject({ feature_context: 'ready' })

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

    it('keeps extension key-value access independent of capture consent and blocks it after disposal', async () => {
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
        posthog.kv.set('core-denied', true)
        client?.kv.set('denied', true)
        client?.kv.remove('retained')
        expect(posthog.kv.get('core-denied')).toBe(true)
        expect(client?.kv.get('retained')).toBeUndefined()
        expect(client?.kv.get('denied')).toBe(true)
        posthog.optIn()
        expect(client?.kv.get('retained')).toBeUndefined()
        expect(client?.kv.get('denied')).toBe(true)
        client?.kv.set('after_grant', true)

        await posthog.dispose()
        client?.kv.set('disposed', true)
        client?.kv.remove('after_grant')
        const reloaded = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
            extensions: [
                {
                    name: 'stateful',
                    setup(nextClient) {
                        expect(nextClient.kv.get('denied')).toBe(true)
                        expect(nextClient.kv.get('after_grant')).toBe(true)
                        expect(nextClient.kv.get('disposed')).toBeUndefined()
                    },
                    dispose() {},
                },
            ],
        })
        expect(reloaded.kv.get('core-denied')).toBe(true)
        await reloaded.dispose()
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
        expect(client?.canCapture).toBe(true)

        posthog.optOut()
        expect(client?.deviceId).toBe(initialAnonymousId)
        expect(client?.canCapture).toBe(false)
        posthog.optIn()
        expect(client?.canCapture).toBe(true)
        const postConsentAnonymousId = posthog.anonymousId
        expect(client?.deviceId).toBe(postConsentAnonymousId)
        await posthog.identify('user-123')
        expect(client?.distinctId).toBe('user-123')
        expect(client?.anonymousId).toBe(postConsentAnonymousId)
        expect(client?.deviceId).toBe(postConsentAnonymousId)
    })

    it('runs extensions and remote config while gating analytics outputs', async () => {
        const deniedRequests: SentRequest[] = []
        let deniedClient: Client | undefined
        const deniedSetup = jest.fn(async (client: Client) => {
            deniedClient = client
            client.kv.set('private', true)
            await client.capture('denied-output')
            await client.sendRequest('/flags/')
        })
        const remoteConfigLoader = jest.fn(async () => createRemoteConfig())
        const denied = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(deniedRequests),
            optOutByDefault: true,
            remoteConfigLoader,
            extensions: [analytics(), { name: 'denied', setup: deniedSetup }],
        })

        await expect(denied.sendRequest('/flags/')).resolves.toMatchObject({ statusCode: 0 })
        expect(deniedSetup).toHaveBeenCalledTimes(1)
        expect(denied.getExtension('denied')).toBeDefined()
        expect(remoteConfigLoader).toHaveBeenCalledTimes(1)
        expect(deniedClient?.kv.get('private')).toBe(true)
        expect(deniedRequests).toHaveLength(0)

        expect(denied.hasOptedOut()).toBe(true)
        denied.optIn()
        expect(denied.hasOptedOut()).toBe(false)
        await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
        expect(remoteConfigLoader).toHaveBeenCalledTimes(1)
        await deniedClient?.capture('allowed-output')
        await denied.flush()
        expect(deniedRequests).toHaveLength(1)

        const blockedRequests: SentRequest[] = []
        const blockedSetup = jest.fn(async (client: Client) => {
            await client.capture('bot-output')
            await client.sendRequest('/flags/')
        })
        const blocked = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: { userAgent: 'Googlebot/2.1' },
            fetch: createFetch(blockedRequests),
            remoteConfigLoader: async () => ({ supportedCompression: [] }) as never,
            extensions: [{ name: 'blocked', setup: blockedSetup }],
        })
        await expect(blocked.sendRequest('/flags/')).resolves.toMatchObject({ statusCode: 0 })
        await expect(blocked.getRemoteConfig()).resolves.toEqual({ supportedCompression: [] })
        expect(blockedSetup).toHaveBeenCalledTimes(1)
        expect(blocked.getExtension('blocked')).toBeDefined()
        expect(blockedRequests).toHaveLength(0)
    })

    it('returns remote configuration completed after denial', async () => {
        let finishConfig: ((value: RemoteConfig) => void) | undefined
        const remoteConfig = new Promise<RemoteConfig>((resolve) => {
            finishConfig = resolve
        })
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            remoteConfigLoader: () => remoteConfig,
        })
        const configResult = posthog.getRemoteConfig()

        posthog.optOut()
        finishConfig?.(createRemoteConfig({ hasFeatureFlags: true }))

        await expect(configResult).resolves.toMatchObject({ hasFeatureFlags: true })
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

    it('keeps the first configured extension when names are duplicated', async () => {
        const first = flagExtension([])
        const duplicateSetup = jest.fn()
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            extensions: [first, { name: 'flags', setup: duplicateSetup }],
        })

        expect(posthog.getExtension('flags')).toBe(first)
        expect(duplicateSetup).not.toHaveBeenCalled()
        await posthog.dispose()
    })

    it('exposes a typed self-capability during setup and removes it after setup fails', async () => {
        interface FailingExtension extends Extension {
            marker: true
        }
        const FailingExtension = 'failed' as ExtensionToken<FailingExtension>
        const dispose = jest.fn()
        let resolvedDuringSetup: FailingExtension | undefined
        const failed: FailingExtension = {
            name: FailingExtension,
            marker: true,
            setup(client) {
                resolvedDuringSetup = client.getExtension(FailingExtension)
                throw new Error('setup failed')
            },
            dispose,
        }
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            extensions: [failed],
        })

        expect(resolvedDuringSetup).toBe(failed)
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(posthog.getExtension(FailingExtension)).toBeUndefined()
        await posthog.dispose()
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
            extensions: [analytics(), first, failed],
        })
        await posthog.capture('still_available')
        await posthog.flush()

        expect(requests).toHaveLength(1)
        expect(firstDispose).not.toHaveBeenCalled()
        expect(failedDispose).toHaveBeenCalledTimes(1)
        await posthog.dispose()
        expect(firstDispose).toHaveBeenCalledTimes(1)
    })

    it('disposes a configured extension once across repeated client disposal', async () => {
        const dispose = jest.fn(async () => {})
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            extensions: [{ name: 'once', setup() {}, dispose }],
        })

        await Promise.all([posthog.dispose(), posthog.dispose()])

        expect(dispose).toHaveBeenCalledTimes(1)
    })

    it('flushes analytics before waiting for unrelated extension disposal', async () => {
        let releaseFetch: ((response: Response) => void) | undefined
        let releaseExtension: (() => void) | undefined
        const response = new Promise<Response>((resolve) => {
            releaseFetch = resolve
        })
        const extensionDisposal = new Promise<void>((resolve) => {
            releaseExtension = resolve
        })
        const blocker: Extension = {
            name: 'blocking-disposal',
            setup() {},
            async dispose() {
                await extensionDisposal
            },
        }
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch: () => response,
            extensions: [analytics(), blocker],
        })
        await posthog.capture('active', { value: 'a'.repeat(1_000) })
        await Promise.resolve()
        const lane = posthog as unknown as {
            _analyticsLane: { _activeBytes: number; _queuedBytes: number }
        }
        expect(lane._analyticsLane._activeBytes).toBeGreaterThan(0)

        const disposal = posthog.dispose()

        expect(lane._analyticsLane._activeBytes).toBeGreaterThan(0)
        releaseFetch?.(new Response('{}', { status: 200 }))
        await Promise.resolve()
        releaseExtension?.()
        await disposal
        expect(lane._analyticsLane._activeBytes).toBe(0)
        expect(lane._analyticsLane._queuedBytes).toBe(0)
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
