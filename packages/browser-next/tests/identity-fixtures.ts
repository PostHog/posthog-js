import { createPostHog } from '../src/composition/npm/core'
import type { BrowserFetch, CorePostHogOptions, IPostHog, StorageLike } from '../src/core/types'

export class MemoryStorage implements StorageLike {
    readonly values = new Map<string, string>()
    getItem(key: string): string | null {
        return this.values.get(key) ?? null
    }
    setItem(key: string, value: string): void {
        this.values.set(key, value)
    }
    removeItem(key: string): void {
        this.values.delete(key)
    }
}

export interface SentEvent {
    event: string
    distinct_id: string
    session_id?: string
    properties: Record<string, unknown>
}

/** Records Capture V1 batches and accepts every event. */
export const recordingFetch = (sent: SentEvent[]): BrowserFetch => {
    return async (input, init = {}) => {
        if (String(input).includes('/i/v1/analytics/events')) {
            const { batch } = JSON.parse(String(init.body)) as { batch: Array<SentEvent & { uuid: string }> }
            sent.push(...batch)
            const results = Object.fromEntries(batch.map((event) => [event.uuid, { result: 'ok' }]))
            return new Response(JSON.stringify({ results }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        }
        return new Response('{}', { status: 404 })
    }
}

export const STATE_KEY = 'ph_ph_test_posthog_browser_v2'
export const CONSENT_KEY = '__ph_opt_in_out_ph_test'

export const clientOptions = (
    storage: StorageLike | false,
    sent: SentEvent[],
    overrides: Partial<CorePostHogOptions> = {}
): CorePostHogOptions => ({
    projectToken: 'ph_test',
    capturePageview: false,
    storage,
    navigator: false,
    fetch: recordingFetch(sent),
    remoteConfig: {
        supportedCompression: [],
        toolbarParams: {},
        toolbarVersion: 'toolbar',
        isAuthenticated: false,
        siteApps: [],
    },
    analytics: { flushAt: 100, flushInterval: 0 },
    ...overrides,
})

export const createClient = (
    storage: StorageLike | false,
    sent: SentEvent[] = [],
    overrides: Partial<CorePostHogOptions> = {}
): Promise<IPostHog> => createPostHog(clientOptions(storage, sent, overrides))

/** Reads the persisted state record. */
export const storedState = (storage: MemoryStorage): Record<string, any> =>
    JSON.parse(storage.getItem(STATE_KEY) ?? '{}') as Record<string, any>

/** A UUIDv7 whose timestamp is `timestamp`. */
export const uuidv7 = (timestamp: number, suffix = '8000-000000000001'): string => {
    const hex = timestamp.toString(16).padStart(12, '0')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-${suffix}`
}
