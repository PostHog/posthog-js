import type {
    Extension,
    IPostHog,
    IPostHogInternal,
    NewSessionInfo,
    NewSessionReason,
    PersonProfileMode,
} from '@posthog/browser'
import type { PersonProfileMode as CorePersonProfileMode, IPostHog as CoreIPostHog } from '@posthog/browser/core'
import type { ApiResponse, SendRequestInit } from '@posthog/browser-common'
// @ts-expect-error Raw transport response types belong to SDK plumbing.
import type { ApiResponse as PublicApiResponse } from '@posthog/browser'
// @ts-expect-error Raw transport options belong to SDK plumbing.
import type { SendRequestInit as PublicSendRequestInit } from '@posthog/browser'
// @ts-expect-error Raw transport response types belong to SDK plumbing.
import type { ApiResponse as CoreApiResponse } from '@posthog/browser/core'
// @ts-expect-error Raw transport options belong to SDK plumbing.
import type { SendRequestInit as CoreSendRequestInit } from '@posthog/browser/core'
import { analytics, type PersonProfileMode as AnalyticsPersonProfileMode } from '@posthog/browser/analytics'
import type { Extension as SharedExtension, ExtensionToken } from '@posthog/browser-common'

export type TransportExportBoundary = [PublicApiResponse, PublicSendRequestInit, CoreApiResponse, CoreSendRequestInit]
export const internalTransport = async (
    publicClient: IPostHog,
    coreClient: CoreIPostHog,
    host: IPostHogInternal
): Promise<ApiResponse> => {
    // @ts-expect-error Requests are not application controls.
    publicClient.sendRequest('/internal/')
    // @ts-expect-error Requests are not application controls.
    coreClient.sendRequest('/internal/')
    const init: SendRequestInit = { allowWhileOptedOut: true }
    await host.sharedClient.sendRequest('/internal/', init)
    return host.sendRequest('/internal/', init)
}

const personProfiles: PersonProfileMode = 'identified_only'
const corePersonProfiles: CorePersonProfileMode = personProfiles
const analyticsPersonProfiles: AnalyticsPersonProfileMode = corePersonProfiles
export const personAnalytics = analytics({ personProfiles: analyticsPersonProfiles })

export const sessionReason = (session: NewSessionInfo): NewSessionReason => session.reason

export const clientExtension: Extension = {
    name: 'client-extension',
    async setup(client) {
        await client.resolveExtension('analytics')
        client.analytics?.capture('extension setup')
    },
}

export const sharedClientExtension: SharedExtension = {
    name: 'shared-client-extension',
    setup(client) {
        client.capture('extension setup')
    },
}

interface CustomExtensionHost {
    track(event: string): void
}

export const customHostExtension: SharedExtension<CustomExtensionHost> = {
    name: 'custom-host-extension',
    bindings: { shared: sharedClientExtension },
    setup(host) {
        host.track('extension setup')
    },
}

interface CustomExtension extends Extension {
    read(): string
}
const CustomExtension = 'custom' as ExtensionToken<CustomExtension>

export const publicProductViews = async (posthog: IPostHog, internal: IPostHogInternal): Promise<void> => {
    const acquired = await posthog.resolveExtension('analytics')
    acquired?.capture('acquired')
    posthog.analytics?.capture('event')
    posthog.analytics?.captureImmediate('immediate')
    posthog.analytics?.identify('person')
    posthog.analytics?.group('company', 'company-123')
    posthog.analytics?.alias('account-123')
    posthog.analytics?.groupIdentify('organization', 0, { plan: 'paid' }, { uuid: 'group-uuid', timestamp: new Date() })
    posthog.analytics?.resetGroups()
    acquired?.alias('account-456')
    acquired?.groupIdentify('organization', 'external')
    acquired?.resetGroups()
    internal.analytics?.alias('internal-account')
    internal.analytics?.groupIdentify('organization', 42)
    internal.analytics?.resetGroups()
    const groupsReset = posthog.onGroupsReset(() => {})
    const internalGroupsReset = internal.onGroupsReset(() => {})
    groupsReset.dispose()
    internalGroupsReset.dispose()
    const propertiesChanged = internal.onChangeProperties(({ set, setOnce, unset }) => {
        const name: unknown = set?.name ?? setOnce?.name
        const removed: readonly string[] | undefined = unset
        void [name, removed]
    })
    propertiesChanged.dispose()
    // @ts-expect-error Property notifications belong to the scoped product host.
    posthog.onChangeProperties(() => {})
    // @ts-expect-error Alias targets are strings.
    posthog.analytics?.alias(42)
    // @ts-expect-error Group keys are strings or numbers.
    posthog.analytics?.groupIdentify('organization', true)
    posthog.analytics?.createPersonProfile()
    posthog.analytics?.setPersonProperties({ plan: 'paid' }, { initial: true })
    posthog.analytics?.setPersonProperties(undefined, { initial: true })
    posthog.analytics?.unsetPersonProperties('plan')
    posthog.analytics?.unsetPersonProperties(['plan', 'initial'] as const)
    posthog.analytics?.setInternalOrTestUser()
    posthog.analytics?.register({ plan: 'paid', nested: { count: 1 } })
    posthog.analytics?.registerOnce({ acquisitionSource: 'website' })
    posthog.analytics?.registerOnce({ region: 'eu' }, null)
    posthog.analytics?.unregister('plan')
    const registered: unknown = posthog.analytics?.getProperty('nested')
    const acquiredProperty: unknown = acquired?.getProperty('region')
    acquired?.register({ source: 'acquired' })
    acquired?.registerOnce({ initial: true }, false)
    acquired?.unregister('source')
    internal.analytics?.register({ source: 'internal' })
    internal.analytics?.registerOnce({ initial: true })
    internal.analytics?.unregister('source')
    const internalProperty: unknown = internal.analytics?.getProperty('initial')
    acquired?.registerForSession({ flow: 'checkout' })
    acquired?.unregisterForSession('flow')
    posthog.analytics?.registerForSession({ step: 1 })
    posthog.analytics?.unregisterForSession('step')
    internal.analytics?.registerForSession({ source: 'internal' })
    internal.analytics?.unregisterForSession('source')
    // @ts-expect-error Session property keys are strings.
    acquired?.unregisterForSession(42)
    void registered
    void acquiredProperty
    void internalProperty
    // @ts-expect-error Registered values require narrowing before assigning a concrete type.
    const plan: string = acquired?.getProperty('plan')
    void plan
    posthog.analytics?.reset()
    const custom = await posthog.resolveExtension(CustomExtension)
    const value: string | undefined = custom?.read()
    void value
    // @ts-expect-error Analytics capture belongs to its product namespace.
    posthog.capture('event')
    // @ts-expect-error Shared implementation lookup is not an application capability.
    posthog.getExtension('custom')
    // @ts-expect-error Internal delivery coordination is not an application control.
    posthog.analytics?.purge()
    internal.analytics?.purge()
    internal.sharedClient.capture('shared event')
}
