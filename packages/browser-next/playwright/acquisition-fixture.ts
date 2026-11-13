import { createPostHog } from '../src'
import { createPostHog as createCore } from '../src/core'
import type { IPostHog, PostHogOptions } from '../src/types'

const options = {
    projectToken: 'ph_native_acquisition',
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

export const acquisitionHarness = {
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
            const before = client.analytics !== undefined
            const [product, concurrent] = await Promise.all([
                client.resolveExtension('analytics'),
                client.resolveExtension('analytics'),
            ])
            if (!product) throw new Error('Expected acquired analytics')
            const originalId = client.distinctId
            const properties = { phase: 'admitted' }
            const observed: string[] = []
            product.onEvent(({ event }) => observed.push(event))
            const admitted = product.capture('before_identity_change', properties)
            properties.phase = 'mutated'
            await product.identify('later_identity')
            await client.flush()
            return {
                before,
                same: product === concurrent && product === client.analytics,
                admitted,
                observed,
                originalId,
                batches,
            }
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
            return { observed, installed: client.analytics !== undefined, session: client.session?.sessionId }
        } finally {
            await client.dispose()
        }
    },
    async disabled() {
        const clients: IPostHog[] = []
        try {
            clients.push(await createCore({ ...options, fetch: false }))
            clients.push(await createPostHog({ ...options, fetch: false, analytics: false }))
            return await Promise.all(
                clients.map(async (client) => ({
                    installed: client.analytics !== undefined,
                    resolved: (await client.resolveExtension('analytics')) !== undefined,
                    session: client.session?.sessionId,
                }))
            )
        } finally {
            await Promise.all(clients.map((client) => client.dispose()))
        }
    },
}

declare global {
    interface Window {
        acquisitionHarness: typeof acquisitionHarness
    }
}
