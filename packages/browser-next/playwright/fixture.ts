import { analytics } from '../src/analytics'
import { createPostHog, type CaptureSummary, type SessionContext } from '../src/core'

interface ConsentHarness {
    anonymousId(): Promise<string>
    capture(event: string): Promise<void>
    captureImmediate(event: string): Promise<CaptureSummary>
    compressionDelivery(value: string): Promise<{
        body: string
        compressedBytes: number
        elapsedMs: number
        encoding: string | null
    }>
    consentValue(): string | null
    denialEvents(): number
    dispose(): Promise<void>
    flush(): Promise<void>
    optIn(): Promise<void>
    optOut(): Promise<void>
    prepareTeardown(events: string[], projectToken: string): Promise<void>
    requests(): number
    reset(): Promise<void>
    session(): Promise<SessionContext>
    sessionChanges(): readonly string[]
}

declare global {
    interface Window {
        consentHarness: ConsentHarness
    }
}

let requests = 0
let denialEvents = 0
let lastDelivery: { body: string; compressedBytes: number; encoding: string | null } | undefined
const currentDelivery = () => lastDelivery
const sessionChanges: string[] = []

// eslint-disable-next-line posthog-js/no-add-event-listener
window.addEventListener('storage', (event) => {
    if (event.key === '__ph_opt_in_out_ph_browser_next_playwright' && event.newValue === '0') {
        denialEvents++
    }
})

const client = createPostHog({
    projectToken: 'ph_browser_next_playwright',
    capturePageview: false,
    navigator: false,
    fetch: async (_input, init = {}) => {
        requests++
        const headers = new Headers(init.headers)
        const encoding = headers.get('Content-Encoding')
        const requestBody = init.body
        const body =
            encoding === 'gzip' && requestBody instanceof Blob
                ? await new Response(requestBody.stream().pipeThrough(new DecompressionStream('gzip'))).text()
                : String(requestBody)
        lastDelivery = {
            body,
            compressedBytes: requestBody instanceof Blob ? requestBody.size : new TextEncoder().encode(body).length,
            encoding,
        }
        const envelope = JSON.parse(body) as { batch: Array<{ uuid: string }> }
        const results = Object.fromEntries(envelope.batch.map(({ uuid }) => [uuid, { result: 'ok' }]))
        return new Response(JSON.stringify({ results }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })
    },
    extensions: [analytics({ flushAt: 100, flushInterval: 0 })],
    remoteConfig: {
        supportedCompression: ['gzip-js'],
        toolbarParams: {},
        toolbarVersion: 'toolbar',
        isAuthenticated: false,
        siteApps: [],
    },
})
void client.then((posthog) => posthog.onNewSession(({ reason }) => sessionChanges.push(reason)))

window.consentHarness = {
    async anonymousId() {
        return (await client).anonymousId
    },
    async capture(event) {
        ;(await client).capture(event)
    },
    async captureImmediate(event) {
        return (await client).captureImmediate(event)
    },
    async compressionDelivery(value) {
        const posthog = await client
        lastDelivery = undefined
        const started = performance.now()
        await posthog.capture('compression_test', { value })
        await posthog.flush()
        const delivery = currentDelivery()
        if (!delivery) {
            throw new Error('Compression delivery was not observed')
        }
        return { ...delivery, elapsedMs: performance.now() - started }
    },
    consentValue() {
        return localStorage.getItem('__ph_opt_in_out_ph_browser_next_playwright')
    },
    denialEvents() {
        return denialEvents
    },
    async dispose() {
        await (await client).dispose()
    },
    async flush() {
        await (await client).flush()
    },
    async optIn() {
        ;(await client).optIn()
    },
    async optOut() {
        ;(await client).optOut()
    },
    async prepareTeardown(events, projectToken) {
        const posthog = await createPostHog({
            projectToken,
            apiHost: window.location.origin,
            capturePageview: false,
            storage: false,
            navigator: false,
            extensions: [analytics({ flushAt: 100, flushInterval: 0 })],
        })
        for (const event of events) {
            await posthog.capture(event)
        }
    },
    requests() {
        return requests
    },
    async reset() {
        ;(await client).reset()
    },
    async session() {
        return (await client).session
    },
    sessionChanges() {
        return sessionChanges.slice()
    },
}
