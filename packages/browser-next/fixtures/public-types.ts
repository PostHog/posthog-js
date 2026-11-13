import type { Extension, IPostHog, IPostHogInternal, NewSessionInfo, NewSessionReason } from '@posthog/browser'
import type { Extension as SharedExtension, ExtensionToken } from '@posthog/browser-common'

export const sessionReason = (session: NewSessionInfo): NewSessionReason => session.reason

export const clientExtension: Extension = {
    name: 'client-extension',
    setup(client) {
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
    posthog.analytics?.capture('event')
    posthog.analytics?.captureImmediate('immediate')
    posthog.analytics?.identify('person')
    posthog.analytics?.group('company', 'company-123')
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
