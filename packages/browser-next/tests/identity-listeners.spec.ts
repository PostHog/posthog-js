import { createPostHog } from '../src/core'
import type { BrowserClient, GroupInfo, IdentifyInfo, PostHog } from '../src/core'
import { localRemoteConfig } from './helpers'

const clients: PostHog[] = []
const create = async (setup: (client: BrowserClient) => void) => {
    const client = await createPostHog({
        projectToken: 'ph_identity_listeners',
        storage: false,
        fetch: false,
        navigator: false,
        capturePageview: false,
        optOutByDefault: true,
        remoteConfig: localRemoteConfig,
        extensions: [{ name: 'observer', setup }],
    })
    clients.push(client)
    return client
}

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
})

describe('browser client identity listeners', () => {
    it('notifies extensions after state updates even when capture is denied', async () => {
        const identified = vi.fn()
        const grouped = vi.fn()
        const reset = vi.fn()
        let extensionClient!: BrowserClient
        const client = await create((value) => {
            extensionClient = value
            value.onIdentify((info) => identified(info, value.distinctId))
            value.onGroup((info) => grouped(info, value.groups))
            value.onReset(() => reset(value.distinctId, value.kv.get('local')))
        })
        const captured = vi.fn()
        client.onEvent(captured)
        const previousDistinctId = client.distinctId
        await client.identify('person', { plan: 'pro' }, { first: true })
        expect(identified).toHaveBeenCalledWith(
            {
                distinctId: 'person',
                previousDistinctId,
                wasIdentified: false,
                set: { plan: 'pro' },
                setOnce: { first: true },
            },
            'person'
        )
        await client.group('organization', 'team', { size: 5 })
        expect(grouped).toHaveBeenCalledWith(
            { type: 'organization', key: 'team', changed: true, properties: { size: 5 } },
            { organization: 'team' }
        )
        extensionClient.kv.set('local', true)
        client.reset()
        expect(client.distinctId).not.toBe('person')
        expect(reset).toHaveBeenCalledWith(client.distinctId, undefined)
        expect(captured).not.toHaveBeenCalled()
    })

    it('reports property-only updates but skips unchanged or invalid operations', async () => {
        const identify = vi.fn<[IdentifyInfo], void>()
        const group = vi.fn<[GroupInfo], void>()
        const client = await create((value) => {
            value.onIdentify(identify)
            value.onGroup(group)
        })
        await client.identify('person')
        await client.identify('person')
        await client.identify('')
        expect(identify).toHaveBeenCalledTimes(1)
        await client.identify('person', { plan: 'pro' })
        expect(identify).toHaveBeenLastCalledWith({
            distinctId: 'person',
            previousDistinctId: 'person',
            wasIdentified: true,
            set: { plan: 'pro' },
            setOnce: undefined,
        })
        await client.group('organization', 'team')
        await client.group('organization', 'team')
        await client.group('', 'team')
        expect(group).toHaveBeenCalledTimes(1)
        await client.group('organization', 'team', { size: 5 })
        expect(group).toHaveBeenLastCalledWith({
            type: 'organization',
            key: 'team',
            changed: false,
            properties: { size: 5 },
        })
    })

    it('isolates listener failures and supports subscription disposal', async () => {
        const identify = vi.fn()
        const group = vi.fn()
        const reset = vi.fn()
        const removed = vi.fn()
        const fail = () => {
            throw new Error('listener failed')
        }
        const client = await create((value) => {
            value.onIdentify(fail)
            value.onGroup(fail)
            value.onReset(fail)
            value.onIdentify(identify)
            value.onGroup(group)
            value.onReset(reset)
            value.onIdentify(removed).dispose()
            value.onGroup(removed).dispose()
            value.onReset(removed).dispose()
        })
        await expect(client.identify('person')).resolves.toBeUndefined()
        await expect(client.group('organization', 'team')).resolves.toBeUndefined()
        expect(() => client.reset()).not.toThrow()
        expect(identify).toHaveBeenCalledTimes(1)
        expect(group).toHaveBeenCalledTimes(1)
        expect(reset).toHaveBeenCalledTimes(1)
        expect(removed).not.toHaveBeenCalled()
    })

    it('does not replay events and stops publishing after disposal', async () => {
        const client = await create(() => {})
        await client.identify('person')
        await client.group('organization', 'team')
        client.reset()
        const identify = vi.fn()
        const group = vi.fn()
        const reset = vi.fn()
        client.onIdentify(identify)
        client.onGroup(group)
        client.onReset(reset)
        expect(identify).not.toHaveBeenCalled()
        expect(group).not.toHaveBeenCalled()
        expect(reset).not.toHaveBeenCalled()
        await client.dispose()
        await client.identify('later')
        await client.group('organization', 'later')
        client.reset()
        expect(identify).not.toHaveBeenCalled()
        expect(group).not.toHaveBeenCalled()
        expect(reset).not.toHaveBeenCalled()
    })
})
