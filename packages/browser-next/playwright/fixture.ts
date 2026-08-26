import { analytics } from '../src/analytics'
import { createPostHog, type SessionContext } from '../src'

interface ConsentHarness {
    anonymousId(): Promise<string>
    capture(event: string): Promise<void>
    consentValue(): string | null
    denialEvents(): number
    dispose(): Promise<void>
    installAnalyticsAndFlush(): Promise<void>
    optIn(): Promise<void>
    optOut(): Promise<void>
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
    fetch: async () => {
        requests++
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
})
void client.then((posthog) => posthog.onNewSession(({ reason }) => sessionChanges.push(reason)))

window.consentHarness = {
    async anonymousId() {
        return (await client).anonymousId
    },
    async capture(event) {
        await (await client).capture(event)
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
    async installAnalyticsAndFlush() {
        const posthog = await client
        await posthog.installExtension(analytics())
        await posthog.flush()
    },
    async optIn() {
        ;(await client).optIn()
    },
    async optOut() {
        ;(await client).optOut()
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
