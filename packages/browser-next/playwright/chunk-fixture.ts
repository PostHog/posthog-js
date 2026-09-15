import { createPostHog } from '@posthog/browser'

let client: Awaited<ReturnType<typeof createPostHog>>
let originalAnalytics: ReturnType<typeof client.getExtension>

const harness = {
    async create() {
        client = await createPostHog({
            projectToken: 'ph_chunk_test',
            apiHost: window.location.origin,
            capturePageview: false,
            storage: false,
            navigator: false,
            debug: true,
            analytics: { flushAt: 100, flushInterval: 0 },
        })
        originalAnalytics = client.getExtension('analytics')
    },
    capture(event: string) {
        client.capture(event)
    },
    flush() {
        return client.flush()
    },
    async immediate() {
        const summary = await client.captureImmediate('immediate')
        return { submitted: summary.submitted, allPersisted: summary.allPersisted, error: summary.error?.message }
    },
    stableAnalytics() {
        return !!originalAnalytics && client.getExtension('analytics') === originalAnalytics
    },
    shutdown() {
        return client.shutdown()
    },
}

window.chunkHarness = harness

declare global {
    interface Window {
        chunkHarness: typeof harness
    }
}
