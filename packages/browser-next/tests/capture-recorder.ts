import type { BrowserFetch, CorePostHogOptions } from '../src/core/types'
import { localRemoteConfig, MemoryStorage } from './helpers'

export interface RecordedEvent {
    event: string
    uuid: string
    distinct_id: string
    options: { process_person_profile?: boolean }
    properties: Record<string, unknown>
}

export interface RecordedRequest {
    url: string
    keepalive: boolean | undefined
    batch: RecordedEvent[]
}

/** A Capture V1 endpoint that accepts every event and records each request. */
export const recordCapture = (requests: RecordedRequest[]): BrowserFetch => {
    return async (input, init = {}) => {
        const url = String(input)
        if (!url.includes('/i/v1/analytics/events')) return new Response('{}', { status: 404 })
        const body = JSON.parse(String(init.body)) as { batch: RecordedEvent[] }
        requests.push({ url, keepalive: init.keepalive, batch: body.batch })
        const results = Object.fromEntries(body.batch.map((event) => [event.uuid, { result: 'ok' }]))
        return new Response(JSON.stringify({ results }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })
    }
}

export const recordedEvents = (requests: readonly RecordedRequest[]): RecordedEvent[] =>
    requests.flatMap((request) => request.batch)

export const recordingOptions = (fetch: BrowserFetch): CorePostHogOptions => ({
    projectToken: 'ph_test',
    capturePageview: false,
    storage: new MemoryStorage(),
    navigator: false,
    fetch,
    remoteConfig: localRemoteConfig,
    analytics: { flushAt: 100, flushInterval: 0 },
})
