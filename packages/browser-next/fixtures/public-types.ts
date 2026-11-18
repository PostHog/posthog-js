import type {
    AnalyticsOptions,
    CaptureSummary,
    Extension,
    IPostHog,
    NewSessionInfo,
    NewSessionReason,
    PersonProfileMode,
    PostHogOptions,
} from '@posthog/browser'
import type {
    CorePostHogOptions,
    IPostHog as CorePostHog,
    PersonProfileMode as CorePersonProfileMode,
} from '@posthog/browser/core'
import type { IPostHog as LitePostHog, PersonProfileMode as LitePersonProfileMode } from '@posthog/browser/lite'
import { group, groupIdentify, resetGroups } from '@posthog/browser/groups'
import {
    alias,
    createPersonProfile,
    setInternalOrTestUser,
    setPersonProperties,
    unsetPersonProperties,
} from '@posthog/browser/person'
import type { Client, Extension as SharedExtension, ExtensionToken } from '@posthog/browser-common'

const personProfiles: PersonProfileMode = 'identified_only'
const corePersonProfiles: CorePersonProfileMode = personProfiles
const litePersonProfiles: LitePersonProfileMode = corePersonProfiles
export const analyticsOptions: AnalyticsOptions = { personProfiles: litePersonProfiles, flushAt: 10, flushInterval: 0 }
export const rootOptions: PostHogOptions = { projectToken: 'ph_test', analytics: analyticsOptions, flags: false }
export const coreOptions: CorePostHogOptions = { projectToken: 'ph_test', analytics: analyticsOptions }
// @ts-expect-error Analytics is part of the client and cannot be disabled.
export const disabledAnalytics: PostHogOptions = { projectToken: 'ph_test', analytics: false }
// @ts-expect-error Optional products are configured through the root entry or explicit extensions.
export const coreFlags: CorePostHogOptions = { projectToken: 'ph_test', flags: {} }

export const sessionReason = (session: NewSessionInfo): NewSessionReason => session.reason

export const clientExtension: Extension = {
    name: 'client-extension',
    setup(client) {
        const host: IPostHog = client
        host.capture('extension setup')
        host.identify('person')
    },
}

export const sharedClientExtension: SharedExtension = {
    name: 'shared-client-extension',
    setup(client) {
        const host: Client = client
        host.capture('extension setup')
    },
}

export const sharedExtensionOptions: CorePostHogOptions = {
    projectToken: 'ph_test',
    extensions: [clientExtension, sharedClientExtension],
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

export const entrypointClients = (core: CorePostHog, lite: LitePostHog): IPostHog[] => [core, lite]

export const publicClient = async (posthog: IPostHog): Promise<void> => {
    const admitted: boolean = posthog.capture('event', { plan: 'paid' }, { uuid: 'event-uuid', timestamp: new Date() })
    const summary: CaptureSummary = await posthog.captureImmediate('immediate')
    void [admitted, summary.allPersisted]
    posthog.identify('person', { name: 'Person' }, { initial: true })
    posthog.reset()
    posthog.register({ plan: 'paid', nested: { count: 1 } })
    posthog.registerOnce({ acquisitionSource: 'website' })
    posthog.registerOnce({ region: 'eu' }, null)
    posthog.unregister('plan')
    posthog.registerForSession({ step: 1 })
    posthog.unregisterForSession('step')
    // @ts-expect-error Session property keys are strings.
    posthog.unregisterForSession(42)
    const registered: unknown = posthog.getProperty('nested')
    void registered
    // @ts-expect-error Registered values require narrowing before assigning a concrete type.
    const plan: string = posthog.getProperty('plan')
    void plan
    posthog.registerDynamicEventProperties(() => ({ page: 'home' })).dispose()

    group(posthog, 'company', 'company-123', { name: 'Company' })
    groupIdentify(posthog, 'organization', 0, { plan: 'paid' }, { uuid: 'group-uuid', timestamp: new Date() })
    groupIdentify(posthog, 'organization', 'external')
    // @ts-expect-error Group keys are strings or numbers.
    groupIdentify(posthog, 'organization', true)
    resetGroups(posthog)
    alias(posthog, 'account-123')
    // @ts-expect-error Alias targets are strings.
    alias(posthog, 42)
    createPersonProfile(posthog)
    setPersonProperties(posthog, { plan: 'paid' }, { initial: true })
    setPersonProperties(posthog, undefined, { initial: true })
    unsetPersonProperties(posthog, 'plan')
    unsetPersonProperties(posthog, ['plan', 'initial'] as const)
    setInternalOrTestUser(posthog)

    const subscriptions = [
        posthog.onEvent(({ event, properties }) => void [event, properties]),
        posthog.onIdentify(({ distinctId, previousDistinctId }) => void [distinctId, previousDistinctId]),
        posthog.onChangeProperties(({ set, setOnce, unset }) => {
            const name: unknown = set?.name ?? setOnce?.name
            const removed: readonly string[] | undefined = unset
            void [name, removed]
        }),
        posthog.onGroup(({ type, key, changed }) => void [type, key, changed]),
        posthog.onGroupsReset(() => {}),
        posthog.onReset(() => {}),
        posthog.onNewSession(({ sessionId, reason }) => void [sessionId, reason]),
        posthog.onConsentChange(({ current, previous }) => void [current, previous]),
    ]
    for (const subscription of subscriptions) subscription.dispose()

    const custom = posthog.getExtension(CustomExtension)
    const resolved = await posthog.resolveExtension(CustomExtension)
    const value: string | undefined = custom?.read() ?? resolved?.read()
    void value
    posthog.featureFlags?.getFeatureFlag('flag')
    // @ts-expect-error Analytics is part of the client, not a product namespace.
    void posthog.analytics
    // @ts-expect-error Less common analytics operations are function imports.
    posthog.group('company', 'company-123')
    // @ts-expect-error Less common analytics operations are function imports.
    posthog.alias('account-123')
}
