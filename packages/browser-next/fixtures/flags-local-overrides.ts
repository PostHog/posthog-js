import assert from 'node:assert/strict'
import type { IFeatureFlags as RootFeatureFlags } from '@posthog/browser'
import { createPostHog, type IFeatureFlags as CoreFeatureFlags } from '@posthog/browser/core'
import { featureFlags, type IFeatureFlags } from '@posthog/browser/flags'

/** Exercise installed-package declarations and runtime controls without analytics. */
export const verifyLocalOverrides = async (create = createPostHog, factory = featureFlags): Promise<void> => {
    const requests: Record<string, unknown>[] = []
    const flags: IFeatureFlags = factory({ refreshIntervalMs: 0 })
    const rootContract: RootFeatureFlags = flags
    const coreContract: CoreFeatureFlags = rootContract
    const posthog = await create({
        projectToken: 'ph_local_overrides_consumer',
        capturePageview: false,
        storage: false,
        navigator: false,
        remoteConfig: {
            supportedCompression: [],
            toolbarParams: {},
            toolbarVersion: 'toolbar',
            isAuthenticated: false,
            siteApps: [],
        },
        extensions: [coreContract],
        fetch: async (_input, init) => {
            requests.push(JSON.parse(String(init?.body)))
            return new Response(JSON.stringify({ featureFlags: {} }))
        },
    })
    try {
        assert.equal(posthog.featureFlags, flags)
        assert.equal(posthog.analytics, undefined)
        const distinctId = posthog.distinctId
        const setPerson: void = flags.setPersonPropertiesForFlags({ plan: 'free' }, false)
        flags.setPersonPropertiesForFlags({ plan: 'pro' }, false)
        const setGroup: void = flags.setGroupPropertiesForFlags(
            { company: { size: 5 }, project: { stage: 'beta' } },
            false
        )
        assert.deepEqual(await flags.reloadFeatureFlags(), { status: 'loaded' })
        assert.deepEqual(requests.at(-1)?.group_properties, { company: { size: 5 }, project: { stage: 'beta' } })
        assert.equal((requests.at(-1)?.person_properties as Record<string, unknown>).plan, 'pro')
        const resetPerson: void = flags.resetPersonPropertiesForFlags(false)
        const resetGroup: void = flags.resetGroupPropertiesForFlags('company')
        void [setPerson, setGroup, resetPerson, resetGroup]
        assert.deepEqual(await flags.reloadFeatureFlags(), { status: 'loaded' })
        assert.equal((requests.at(-1)?.person_properties as Record<string, unknown>).plan, undefined)
        assert.deepEqual(requests.at(-1)?.group_properties, { company: {}, project: { stage: 'beta' } })
        flags.resetGroupPropertiesForFlags()
        assert.deepEqual(await flags.reloadFeatureFlags(), { status: 'loaded' })
        assert.equal(requests.at(-1)?.group_properties, undefined)
        assert.equal(posthog.distinctId, distinctId)
        assert.deepEqual(posthog.groups, {})
        assert.equal(posthog.session, undefined)
    } finally {
        await posthog.dispose()
    }
    flags.setPersonPropertiesForFlags({ disposed: true })
    flags.resetPersonPropertiesForFlags()
    flags.setGroupPropertiesForFlags({ company: { disposed: true } })
    flags.resetGroupPropertiesForFlags()
}
