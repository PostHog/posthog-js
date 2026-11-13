import type {
    Extension,
    IPostHog,
    IPostHogInternal,
    NewSessionInfo,
    NewSessionReason,
    PersonProfileMode,
} from '@posthog/browser'
import type { PersonProfileMode as CorePersonProfileMode } from '@posthog/browser/core'
import { analytics, type PersonProfileMode as AnalyticsPersonProfileMode } from '@posthog/browser/analytics'
import type { Extension as SharedExtension, ExtensionToken } from '@posthog/browser-common'

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
    const propertiesChanged = internal.onChangeProperties(({ set, setOnce, unset }) => {
        const name: unknown = set?.name ?? setOnce?.name
        const removed: readonly string[] | undefined = unset
        void [name, removed]
    })
    propertiesChanged.dispose()
    // @ts-expect-error Property notifications belong to the scoped product host.
    posthog.onChangeProperties(() => {})
    posthog.analytics?.createPersonProfile()
    posthog.analytics?.setPersonProperties({ plan: 'paid' }, { initial: true })
    posthog.analytics?.setPersonProperties(undefined, { initial: true })
    posthog.analytics?.unsetPersonProperties('plan')
    posthog.analytics?.unsetPersonProperties(['plan', 'initial'] as const)
    posthog.analytics?.setInternalOrTestUser()
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
