import { autocaptureHarness } from './autocapture-fixture'
window.autocaptureHarness = autocaptureHarness

import { surveysHarness } from './surveys-fixture'
window.surveysHarness = surveysHarness
import { logs } from '../src/logs'
import type { PostHog } from '../src/types'
import { flags } from '../src/flags'
import { analytics } from '../src/analytics'
import { createPostHog, FeatureFlagsExtension, type CaptureSummary, type SessionContext } from '../src/core'

interface ConsentHarness {
    updateFlags(values: Record<string, boolean | string>): Promise<void>
    flagValue(key: string): Promise<boolean | string | undefined>
    flagChanges(): number

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
    remoteConfig(): Promise<{ config: unknown; canCapture: boolean }>
    reset(): Promise<void>
    session(): Promise<SessionContext>
    sessionChanges(): readonly string[]
}

declare global {
    interface Window {
        logsHarness: {
            initialize(remote: boolean): Promise<void>
            capture(body: string): void
            console(body: string): void
            flush(): Promise<void>
            optOut(): void
            optIn(): void
            shutdown(): Promise<void>
            restored(): boolean
            pagehideDuringShutdown(): Promise<{ beacon: string; fetches: number; aborted: boolean }>
        }
        consentHarness: ConsentHarness
    }
}

let flagChanges = 0
let requests = 0
let denialEvents = 0
let lastDelivery: { body: string; compressedBytes: number; encoding: string | null } | undefined
const currentDelivery = () => lastDelivery
const sessionChanges: string[] = []

// oxlint-disable-next-line posthog-js/no-add-event-listener
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
    extensions: [
        analytics({ flushAt: 100, flushInterval: 0 }),
        flags({ featureFlagEvaluation: false, refreshIntervalMs: 0 }),
    ],
    remoteConfig: {
        supportedCompression: ['gzip-js'],
        toolbarParams: {},
        toolbarVersion: 'toolbar',
        isAuthenticated: false,
        siteApps: [],
    },
})
void client.then((posthog) => posthog.onNewSession(({ reason }) => sessionChanges.push(reason)))

void client.then((posthog) =>
    posthog.getExtension(FeatureFlagsExtension)!.onFeatureFlags(() => {
        flagChanges++
    })
)

window.consentHarness = {
    async updateFlags(values) {
        ;(await client).getExtension(FeatureFlagsExtension)!.updateFlags(values)
    },
    async flagValue(key) {
        const value = (await client).getExtension(FeatureFlagsExtension)!.getFeatureFlag(key)
        return value?.variant ?? value?.enabled
    },
    flagChanges: () => flagChanges,
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
            extensions: [
                analytics({ flushAt: 100, flushInterval: 0 }),
                flags({ featureFlagEvaluation: false, refreshIntervalMs: 0 }),
            ],
        })
        for (const event of events) {
            await posthog.capture(event)
        }
    },
    requests() {
        return requests
    },
    async remoteConfig() {
        const posthog = await createPostHog({
            projectToken: 'ph_remote_config',
            apiHost: window.location.origin,
            storage: false,
            navigator: false,
            capturePageview: false,
            optOutByDefault: true,
        })
        const config = await posthog.getRemoteConfig()
        const canCapture = posthog.canCapture
        await posthog.dispose()
        return { config, canCapture }
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

/* oxlint-disable no-console -- Exercise native console instrumentation. */
let logsClient: PostHog | undefined
const originalLog = console.log
window.logsHarness = {
    async initialize(remote) {
        logsClient = await createPostHog({
            projectToken: 'ph_browser_logs',
            apiHost: window.location.origin,
            capturePageview: false,
            navigator: false,
            extensions: [logs({ captureConsoleLogs: !remote, flushIntervalMs: 60_000 })],
            remoteConfig: {
                supportedCompression: [],
                toolbarParams: {},
                toolbarVersion: 'toolbar',
                isAuthenticated: false,
                siteApps: [],
                logs: { captureConsoleLogs: remote },
            },
        })
    },
    capture(body) {
        logsClient?.captureLog({ body })
    },
    console(body) {
        console.log(body)
    },
    async flush() {
        await logsClient?.flush()
    },
    optOut() {
        logsClient?.optOut()
    },
    optIn() {
        logsClient?.optIn()
    },
    async shutdown() {
        await logsClient?.shutdown()
    },
    restored() {
        return console.log === originalLog
    },
    async pagehideDuringShutdown() {
        let beacon: Blob | undefined
        let signal: AbortSignal | undefined
        let fetches = 0
        const client = await createPostHog({
            projectToken: 'ph_browser_logs_shutdown',
            storage: false,
            capturePageview: false,
            disableBotDetection: true,
            navigator: {
                sendBeacon: (_url, body) => {
                    beacon = body as Blob
                    return true
                },
            },
            fetch: (_url, init) => {
                fetches++
                signal = init?.signal ?? undefined
                return new Promise<Response>(() => {})
            },
            extensions: [logs({ flushIntervalMs: 0 })],
            remoteConfig: {
                supportedCompression: [],
                toolbarParams: {},
                toolbarVersion: 'toolbar',
                isAuthenticated: false,
                siteApps: [],
            },
        })
        client.captureLog({ body: 'pending navigation' })
        const closing = client.shutdown(10)
        window.dispatchEvent(new Event('pagehide'))
        const body = await beacon?.text()
        await closing
        return { beacon: body ?? '', fetches, aborted: signal?.aborted ?? false }
    },
}
