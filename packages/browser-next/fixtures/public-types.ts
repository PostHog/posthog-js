import type { Extension, NewSessionInfo, NewSessionReason } from '@posthog/browser'

export const sessionReason = (session: NewSessionInfo): NewSessionReason => session.reason

export const clientExtension: Extension = {
    name: 'client-extension',
    setup(client) {
        client.capture('extension setup')
    },
}

interface CustomExtensionHost {
    track(event: string): void
}

export const customHostExtension: Extension<CustomExtensionHost> = {
    name: 'custom-host-extension',
    bindings: { shared: clientExtension },
    setup(host) {
        host.track('extension setup')
    },
}
