import type { Client } from '@posthog/browser-common'

import { createPostHog, type Extension } from '../src'
import { createFetch, type SentRequest } from './helpers'

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
        const posthog = await createPostHog('ph_test', {
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
            async setup(client) {
                await client.kv.set('polluted', 'safe')
                storedValue = await client.kv.get('polluted')
            },
            dispose() {},
        }

        const posthog = await createPostHog('ph_test', {
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
            async setup(client) {
                await client.kv.set('shared-key', value)
                values.push(await client.kv.get('shared-key'))
            },
            dispose() {},
        })
        const posthog = await createPostHog('ph_test', {
            storage: false,
            navigator: false,
            fetch: false,
            extensions: [createExtension('one', 'first'), createExtension('two', 'second')],
        })

        expect(values).toEqual(['first', 'second'])
        await posthog.dispose()
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

        const posthog = await createPostHog('ph_test', {
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
        const posthog = await createPostHog('ph_test', { storage: false, navigator: false, fetch: false })
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
        const posthog = await createPostHog('ph_test', { storage: false, navigator: false, fetch: false })

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
        const posthog = await createPostHog('ph_test', { storage: false, navigator: false, fetch: false })

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

        const posthog = await createPostHog('ph_test', {
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
        const posthog = await createPostHog('ph_test', {
            storage: false,
            navigator: false,
            fetch: false,
            extensions: [createExtension('one'), createExtension('two')],
        })

        await posthog.dispose()
        expect(events).toEqual(['one:setup', 'two:setup', 'two:dispose', 'one:dispose'])
    })
})
