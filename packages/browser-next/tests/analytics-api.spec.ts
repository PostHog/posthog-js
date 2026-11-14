import { requireInstalledExtension } from './helpers'
import { createPostHog } from '../src/core'
import { BrowserState } from '../src/state'
import { EventBuffer } from '../src/event-buffer'
import { analytics } from '../src/analytics'
import { createFetch, localRemoteConfig, type SentRequest } from './helpers'

const options = {
    projectToken: 'ph_analytics_api',
    capturePageview: false,
    storage: false,
    navigator: false,
    remoteConfig: localRemoteConfig,
} as const

describe('analytics product API', () => {
    it('exposes analytics operations on the installed product, not the client facade', async () => {
        const extension = analytics({ flushInterval: 0 })
        const posthog = await createPostHog({ ...options, fetch: false, extensions: [extension] })
        expect(posthog.analytics).toBe(extension)
        for (const name of [
            'capture',
            'captureImmediate',
            'identify',
            'alias',
            'group',
            'groupIdentify',
            'resetGroups',
            'reset',
            'register',
            'registerOnce',
            'unregister',
            'getProperty',
            'registerDynamicEventProperties',
            'onEvent',
            'isRateLimited',
            'getExtension',
        ]) {
            expect(name in posthog, name).toBe(false)
        }
        expect(typeof posthog.analytics?.capture).toBe('function')
        await posthog.dispose()
    })

    it('admits capture synchronously and sends its snapshotted properties through the public product', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            ...options,
            fetch: createFetch(requests),
            extensions: [analytics({ flushInterval: 0 })],
        })
        const extension = requireInstalledExtension(posthog.analytics)
        const observed: unknown[] = []
        const subscription = extension.onEvent((event) => observed.push(event))
        const properties = { cart: { count: 1 } }
        expect(extension.capture('checkout', properties)).toBe(true)
        properties.cart.count = 2
        expect(observed).toMatchObject([{ event: 'checkout', properties: { cart: { count: 1 } } }])
        expect(posthog.session?.sessionId).toBeDefined()
        await posthog.flush()
        expect(requests[0]?.body?.batch).toMatchObject([{ event: 'checkout', properties: { cart: { count: 1 } } }])
        subscription.dispose()
        extension.capture('after_disposal')
        expect(observed).toHaveLength(1)
        await posthog.dispose()
    })

    it('updates shared identity and groups from product operations and preserves reset notifications', async () => {
        const changes: string[] = []
        const posthog = await createPostHog({ ...options, fetch: false, extensions: [analytics({ flushInterval: 0 })] })
        const extension = requireInstalledExtension(posthog.analytics)
        const originalDevice = posthog.deviceId
        posthog.onIdentify(() => changes.push('identify'))
        posthog.onGroup(() => changes.push('group'))
        posthog.onReset(() => changes.push('reset'))
        await extension.identify('user-123')
        await extension.group('company', 'company-123')
        expect(posthog.distinctId).toBe('user-123')
        expect(posthog.groups).toEqual({ company: 'company-123' })
        extension.reset()
        expect(posthog.distinctId).not.toBe('user-123')
        expect(posthog.deviceId).toBe(originalDevice)
        expect(posthog.groups).toEqual({})
        expect(changes).toEqual(['identify', 'group', 'reset'])
        await posthog.dispose()
    })
    it('keeps detached and copied operations bound to the installed analytics owner', async () => {
        const extension = analytics({ flushInterval: 0 })
        const posthog = await createPostHog({ ...options, fetch: false, extensions: [extension] })
        const { capture, captureImmediate, identify, group, reset, onEvent, registerDynamicEventProperties, flush } =
            extension
        const copied = { capture, captureImmediate, identify, group, reset }
        const events: Array<{ event: string; properties: Readonly<Record<string, unknown>> }> = []
        const subscription = onEvent((event) => events.push(event))
        const registration = registerDynamicEventProperties(() => ({ source: 'dynamic' }))
        expect(copied.capture('copied')).toBe(true)
        await copied.identify('person')
        await copied.group('company', 'company-123')
        expect(posthog.distinctId).toBe('person')
        expect(posthog.groups).toEqual({ company: 'company-123' })
        await copied.captureImmediate('immediate')
        copied.reset()
        expect(posthog.distinctId).not.toBe('person')
        expect(events.map(({ event }) => event)).toEqual(['copied', '$identify', '$groupidentify', 'immediate'])
        expect(events.every(({ properties }) => properties.source === 'dynamic')).toBe(true)
        registration.dispose()
        subscription.dispose()
        await flush()
        await posthog.dispose()
        expect(() => copied.capture('disposed')).not.toThrow()
        expect(await copied.captureImmediate('disposed')).toMatchObject({ submitted: 0 })
        await copied.identify('disposed')
        await copied.group('company', 'disposed')
        copied.reset()
        expect(posthog.distinctId).not.toBe('disposed')
    })

    it('keeps detached alias and group helpers bound to the same installed product', async () => {
        const extension = analytics({ flushInterval: 0 })
        const posthog = await createPostHog({ ...options, fetch: false, extensions: [extension] })
        const { alias, groupIdentify, resetGroups } = extension
        const copied = { alias, groupIdentify, resetGroups }
        const observed = vi.fn()
        extension.onEvent(observed)
        await extension.group('company', 'retained')
        copied.alias('account')
        copied.groupIdentify('company', 0, { plan: 'paid' })
        expect(posthog.groups).toEqual({ company: 'retained' })
        copied.resetGroups()
        expect(posthog.groups).toEqual({})
        expect(observed.mock.calls.map(([event]) => event.event)).toEqual([
            '$groupidentify',
            '$create_alias',
            '$groupidentify',
        ])
        await extension.group('company', 'after-reset')
        await posthog.dispose()
        expect(() => {
            copied.alias('late')
            copied.groupIdentify('company', 'late')
            copied.resetGroups()
        }).not.toThrow()
        expect(posthog.groups).toEqual({ company: 'after-reset' })
    })

    it.each(['enqueue', 'sessionAdmitted'] as const)(
        'does not publish or commit an event rejected by %s',
        async (seam) => {
            const extension = analytics({ flushInterval: 0 })
            const posthog = await createPostHog({ ...options, fetch: false, extensions: [extension] })
            const captured = vi.fn()
            extension.onEvent(captured)
            const reject =
                seam === 'enqueue'
                    ? vi.spyOn(EventBuffer.prototype, 'enqueue').mockReturnValue(false)
                    : vi.spyOn(BrowserState.prototype, 'sessionAdmitted').mockReturnValue(false)
            try {
                expect(extension.capture('rejected')).toBe(true)
                expect(captured).not.toHaveBeenCalled()
                expect(posthog.session).toBeUndefined()
            } finally {
                reject.mockRestore()
                await posthog.dispose()
            }
        }
    )
})
