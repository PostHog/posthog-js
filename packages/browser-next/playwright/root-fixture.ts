import { createPostHog } from '../src/composition/npm'
import { createPostHog as createCore } from '../src/composition/npm/core'
import type { IPostHog, PostHogOptions } from '../src/core/types'

const options = {
    projectToken: 'ph_native_root',
    storage: false,
    navigator: false,
    capturePageview: false,
    flags: false,
    logs: false,
    surveys: false,
    autocapture: false,
    remoteConfig: {
        supportedCompression: [],
        toolbarParams: {},
        toolbarVersion: 'toolbar' as const,
        isAuthenticated: false,
        siteApps: [],
    },
} satisfies PostHogOptions

export const rootHarness = {
    async snapshot() {
        const batches: Array<Array<{ event: string; distinct_id: string; properties: Record<string, unknown> }>> = []
        const client = await createPostHog({
            ...options,
            analytics: { flushInterval: 0 },
            fetch: async (_input, init) => {
                batches.push(JSON.parse(String(init?.body)).batch)
                return new Response('{}')
            },
        })
        try {
            const originalId = client.distinctId
            const properties = { phase: 'admitted' }
            const observed: string[] = []
            client.onEvent(({ event }) => observed.push(event))
            const admitted = client.capture('before_identity_change', properties)
            properties.phase = 'mutated'
            client.identify('later_identity')
            await client.flush()
            return { admitted, observed, originalId, batches }
        } finally {
            await client.dispose()
        }
    },
    async pageview() {
        const observed: string[] = []
        const client = await createPostHog({
            ...options,
            capturePageview: true,
            fetch: false,
            extensions: [{ name: 'observer', setup: (host) => void host.onEvent(({ event }) => observed.push(event)) }],
        })
        try {
            return { observed, session: client.session?.sessionId }
        } finally {
            await client.dispose()
        }
    },
    async idle() {
        const clients: IPostHog[] = []
        try {
            clients.push(await createCore({ ...options, fetch: false }))
            clients.push(await createPostHog({ ...options, fetch: false }))
            return clients.map((client) => ({
                products: ['featureFlags', 'logs', 'surveys', 'autocapture'].filter(
                    (name) => client.getExtension(name) !== undefined
                ),
                session: client.session?.sessionId,
            }))
        } finally {
            await Promise.all(clients.map((client) => client.dispose()))
        }
    },
}

declare global {
    interface Window {
        rootHarness: typeof rootHarness
    }
}
