import { createBufferedPostHog as createPostHog } from './helpers'
import { requireInstalledExtension } from './helpers'
import type { IPostHogInternal, GroupInfo, IdentifyInfo, IPostHog } from '../src/core'
import { localRemoteConfig } from './helpers'

const clients: IPostHog[] = []
const create = async (setup: (client: IPostHogInternal) => void) => {
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
        let extensionClient!: IPostHogInternal
        const client = await create((value) => {
            extensionClient = value
            value.onIdentify((info) => identified(info, value.distinctId))
            value.onGroup((info) => grouped(info, value.groups))
            value.onReset(() => reset(value.distinctId, value.kv.get('local')))
        })
        const captured = vi.fn()
        requireInstalledExtension(client.analytics).onEvent(captured)
        const previousDistinctId = client.distinctId
        await requireInstalledExtension(client.analytics).identify('person', { plan: 'pro' }, { first: true })
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
        await requireInstalledExtension(client.analytics).group('organization', 'team', { size: 5 })
        expect(grouped).toHaveBeenCalledWith(
            { type: 'organization', key: 'team', changed: true, properties: { size: 5 } },
            { organization: 'team' }
        )
        extensionClient.kv.set('local', true)
        requireInstalledExtension(client.analytics).reset()
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
        const product = requireInstalledExtension(client.analytics)
        await product.identify('member')
        await product.group('organization', 'acme')
        product.resetGroups()
        expect(groupsReset).toHaveBeenCalledTimes(1)
        expect(groupsReset).toHaveBeenCalledWith({}, 'member', true)
        expect(reset).not.toHaveBeenCalled()
        product.reset()
        expect(groupsReset).toHaveBeenCalledTimes(1)
        expect(reset).toHaveBeenCalledTimes(1)
    })

    it('reports property-only updates but skips unchanged or invalid operations', async () => {
        const identify = vi.fn<[IdentifyInfo], void>()
        const group = vi.fn<[GroupInfo], void>()
        const client = await create((value) => {
            value.onIdentify(identify)
            value.onGroup(group)
        })
        await requireInstalledExtension(client.analytics).identify('person')
        await requireInstalledExtension(client.analytics).identify('person')
        await requireInstalledExtension(client.analytics).identify('')
        expect(identify).toHaveBeenCalledTimes(1)
        await requireInstalledExtension(client.analytics).identify('person', { plan: 'pro' })
        expect(identify).toHaveBeenLastCalledWith({
            distinctId: 'person',
            previousDistinctId: 'person',
            wasIdentified: true,
            set: { plan: 'pro' },
            setOnce: undefined,
        })
        await requireInstalledExtension(client.analytics).group('organization', 'team')
        await requireInstalledExtension(client.analytics).group('organization', 'team')
        await requireInstalledExtension(client.analytics).group('', 'team')
        expect(group).toHaveBeenCalledTimes(1)
        await requireInstalledExtension(client.analytics).group('organization', 'team', { size: 5 })
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
            value.onGroup(group)
            value.onReset(reset)
            value.onGroupsReset(groupsReset)
            value.onIdentify(removed).dispose()
            value.onGroup(removed).dispose()
            value.onReset(removed).dispose()
            value.onGroupsReset(removed).dispose()
        })
        await expect(requireInstalledExtension(client.analytics).identify('person')).resolves.toBeUndefined()
        await expect(requireInstalledExtension(client.analytics).group('organization', 'team')).resolves.toBeUndefined()
        expect(() => requireInstalledExtension(client.analytics).resetGroups()).not.toThrow()
        expect(() => requireInstalledExtension(client.analytics).reset()).not.toThrow()
        expect(identify).toHaveBeenCalledTimes(1)
        expect(group).toHaveBeenCalledTimes(1)
        expect(reset).toHaveBeenCalledTimes(1)
        expect(groupsReset).toHaveBeenCalledTimes(1)
        expect(removed).not.toHaveBeenCalled()
    })

    it('does not replay events and stops publishing after disposal', async () => {
        const client = await create(() => {})
        const installedAnalytics = requireInstalledExtension(client.analytics)
        await installedAnalytics.identify('person')
        await installedAnalytics.group('organization', 'team')
        installedAnalytics.resetGroups()
        installedAnalytics.reset()
        const identify = vi.fn()
        const group = vi.fn()
        const reset = vi.fn()
        client.onIdentify(identify)
        client.onGroup(group)
        client.onReset(reset)
        const groupsReset = vi.fn()
        client.onGroupsReset(groupsReset)
        expect(groupsReset).not.toHaveBeenCalled()
        expect(identify).not.toHaveBeenCalled()
        expect(group).not.toHaveBeenCalled()
        expect(reset).not.toHaveBeenCalled()
        await client.dispose()
        await installedAnalytics.identify('later')
        await installedAnalytics.group('organization', 'later')
        installedAnalytics.resetGroups()
        installedAnalytics.reset()
        expect(groupsReset).not.toHaveBeenCalled()
        expect(identify).not.toHaveBeenCalled()
        expect(group).not.toHaveBeenCalled()
        expect(reset).not.toHaveBeenCalled()
    })
})
