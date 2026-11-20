import { createBufferedPostHog as createPostHog, localRemoteConfig } from './helpers'
import type { GroupInfo, IdentifyInfo, IPostHog } from '../src/composition/npm/core'

const clients: IPostHog[] = []
const create = async (setup: (client: IPostHog) => void) => {
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
        let extensionClient!: IPostHog
        const client = await create((value) => {
            extensionClient = value
            value.onIdentify((info) => identified(info, value.distinctId))
            value.onGroup((info) => grouped(info, value.groups))
            value.onReset(() => reset(value.distinctId, value.kv.get('local')))
        })
        const captured = vi.fn()
        client.onEvent(captured)
        const previousDistinctId = client.distinctId
        client.identify('person', { plan: 'pro' }, { first: true })
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
        client.group('organization', 'team', { size: 5 })
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

    it('publishes group-only cleanup after state changes without clearing extension state under denial', async () => {
        const groupsReset = vi.fn()
        const reset = vi.fn()
        const client = await create((value) => {
            value.kv.set('retained', true)
            value.onGroupsReset(() => groupsReset(value.groups, value.distinctId, value.kv.get('retained')))
            value.onReset(reset)
        })
        client.identify('member')
        client.group('organization', 'acme')
        client.resetGroups()
        expect(groupsReset).toHaveBeenCalledTimes(1)
        expect(groupsReset).toHaveBeenCalledWith({}, 'member', true)
        expect(reset).not.toHaveBeenCalled()
        client.reset()
        expect(groupsReset).toHaveBeenCalledTimes(1)
        expect(reset).toHaveBeenCalledTimes(1)
    })

    it('reports property-only updates but skips unchanged or invalid operations', async () => {
        const identify = vi.fn<[IdentifyInfo], void>()
        const grouped = vi.fn<[GroupInfo], void>()
        const client = await create((value) => {
            value.onIdentify(identify)
            value.onGroup(grouped)
        })
        client.identify('person')
        client.identify('person')
        client.identify('')
        expect(identify).toHaveBeenCalledTimes(1)
        client.identify('person', { plan: 'pro' })
        expect(identify).toHaveBeenLastCalledWith({
            distinctId: 'person',
            previousDistinctId: 'person',
            wasIdentified: true,
            set: { plan: 'pro' },
            setOnce: undefined,
        })
        client.group('organization', 'team')
        client.group('organization', 'team')
        client.group('', 'team')
        expect(grouped).toHaveBeenCalledTimes(1)
        client.group('organization', 'team', { size: 5 })
        expect(grouped).toHaveBeenLastCalledWith({
            type: 'organization',
            key: 'team',
            changed: false,
            properties: { size: 5 },
        })
    })

    it('isolates listener failures and supports subscription disposal', async () => {
        const identify = vi.fn()
        const grouped = vi.fn()
        const reset = vi.fn()
        const groupsReset = vi.fn()
        const removed = vi.fn()
        const fail = () => {
            throw new Error('listener failed')
        }
        const client = await create((value) => {
            value.onIdentify(fail)
            value.onGroup(fail)
            value.onReset(fail)
            value.onGroupsReset(fail)
            value.onIdentify(identify)
            value.onGroup(grouped)
            value.onReset(reset)
            value.onGroupsReset(groupsReset)
            value.onIdentify(removed).dispose()
            value.onGroup(removed).dispose()
            value.onReset(removed).dispose()
            value.onGroupsReset(removed).dispose()
        })
        expect(() => client.identify('person')).not.toThrow()
        expect(() => client.group('organization', 'team')).not.toThrow()
        expect(() => client.resetGroups()).not.toThrow()
        expect(() => client.reset()).not.toThrow()
        expect(identify).toHaveBeenCalledTimes(1)
        expect(grouped).toHaveBeenCalledTimes(1)
        expect(reset).toHaveBeenCalledTimes(1)
        expect(groupsReset).toHaveBeenCalledTimes(1)
        expect(removed).not.toHaveBeenCalled()
    })

    it('does not replay events and stops publishing after disposal', async () => {
        const client = await create(() => {})
        client.identify('person')
        client.group('organization', 'team')
        client.resetGroups()
        client.reset()
        const identify = vi.fn()
        const grouped = vi.fn()
        const reset = vi.fn()
        client.onIdentify(identify)
        client.onGroup(grouped)
        client.onReset(reset)
        const groupsReset = vi.fn()
        client.onGroupsReset(groupsReset)
        expect(groupsReset).not.toHaveBeenCalled()
        expect(identify).not.toHaveBeenCalled()
        expect(grouped).not.toHaveBeenCalled()
        expect(reset).not.toHaveBeenCalled()
        await client.dispose()
        client.identify('later')
        client.group('organization', 'later')
        client.resetGroups()
        client.reset()
        expect(groupsReset).not.toHaveBeenCalled()
        expect(identify).not.toHaveBeenCalled()
        expect(grouped).not.toHaveBeenCalled()
        expect(reset).not.toHaveBeenCalled()
    })
})
