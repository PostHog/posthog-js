import { gunzipSync } from 'node:zlib'
import type { SessionRecordingRemoteConfig } from '@posthog/browser-common'
import { createPostHog as createCore, type RemoteConfig } from '../src/composition/npm/core'
import type { BrowserFetch, IPostHog, StorageLike } from '../src/core/types'
import { sessionRecording } from '../src/products/session-recording/session-recording'
import type { SessionRecordingExtension } from '../src/products/session-recording/session-recording-internal'
import type { SessionRecordingOptions } from '../src/products/session-recording/session-recording-options'
import type { BrowserExtension } from '../src/core/context/browser-client'

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

export interface SnapshotRequest {
    url: string
    keepalive: boolean | undefined
    events: Array<{ event: string; uuid: string; properties: Record<string, any> }>
}

export interface Transport {
    fetch: BrowserFetch
    snapshots: SnapshotRequest[]
    analytics: Array<{ event: string; properties: Record<string, any> }>
}

/** Records `/s/` snapshot requests and acknowledges Capture V1 analytics batches. */
export const transport = (): Transport => {
    const snapshots: SnapshotRequest[] = []
    const analytics: Transport['analytics'] = []
    const fetch: BrowserFetch = async (input, init = {}) => {
        const url = String(input)
        if (url.includes('/s/')) {
            const raw = init.body
            const body =
                typeof raw === 'string'
                    ? url.includes('compression=base64')
                        ? new TextDecoder().decode(Uint8Array.from(atob(raw), (char) => char.charCodeAt(0)))
                        : raw
                    : gunzipSync(
                          raw instanceof Uint8Array
                              ? raw
                              : new Uint8Array(await new Response(raw as BodyInit).arrayBuffer())
                      ).toString('utf8')
            snapshots.push({ url, keepalive: init.keepalive, events: JSON.parse(body) })
            return new Response('{}', { status: 200 })
        }
        if (url.includes('/i/v1/analytics/events')) {
            const body = JSON.parse(String(init.body)) as { batch: Array<{ uuid: string } & Transport['analytics'][0]> }
            analytics.push(...body.batch)
            const results = Object.fromEntries(body.batch.map((event) => [event.uuid, { result: 'ok' }]))
            return new Response(JSON.stringify({ results }), { status: 200 })
        }
        return new Response('{}', { status: 404 })
    }
    return { fetch, snapshots, analytics }
}

export const remoteConfig = (sessionRecording: SessionRecordingRemoteConfig | false = {}): RemoteConfig => ({
    supportedCompression: [],
    toolbarParams: {},
    toolbarVersion: 'toolbar',
    isAuthenticated: false,
    siteApps: [],
    sessionRecording,
})

export interface Setup {
    posthog: IPostHog
    replay: SessionRecordingExtension
    transport: Transport
    storage: MemoryStorage
}

export const clients: IPostHog[] = []

export const setup = async (
    config: SessionRecordingRemoteConfig | false = {},
    options: SessionRecordingOptions = {},
    overrides: { replay?: SessionRecordingExtension; extensions?: BrowserExtension[]; optOutByDefault?: boolean } = {}
): Promise<Setup> => {
    const network = transport()
    const storage = new MemoryStorage()
    const replay = overrides.replay ?? sessionRecording(options)
    const posthog = await createCore({
        projectToken: 'ph_test',
        apiHost: 'https://us.i.posthog.com',
        capturePageview: false,
        storage,
        navigator: false,
        fetch: network.fetch,
        remoteConfig: remoteConfig(config),
        analytics: { flushAt: 100, flushInterval: 0 },
        optOutByDefault: overrides.optOutByDefault ?? false,
        extensions: [...(overrides.extensions ?? []), replay],
    })
    clients.push(posthog)
    return { posthog, replay, transport: network, storage }
}

export const started = async (replay: SessionRecordingExtension): Promise<void> => {
    await vi.waitFor(() => expect(replay.sessionRecordingStarted()).toBe(true))
}

export const typeInto = (input: HTMLInputElement, value: string): void => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Types a longer value each time, so a masked input still emits a change. */
export const interact = (): void => {
    const input = document.getElementById('name') as HTMLInputElement
    typeInto(input, `${input.value}x`)
}

const gunzipField = (value: unknown): unknown =>
    typeof value === 'string' ? JSON.parse(gunzipSync(Buffer.from(value, 'latin1')).toString('utf8')) : value

/** Reverses replay event compression (`cv: '2024-10'`), so assertions see what the player sees. */
export const decompressEvent = (event: Record<string, any>): { type: number; [key: string]: unknown } => {
    if (event.cv !== '2024-10') return event as { type: number }
    const { cv: _cv, ...rest } = event
    if (rest.type === 2) return { ...rest, data: gunzipField(rest.data) } as unknown as { type: number }
    const data = { ...rest.data }
    for (const field of ['texts', 'attributes', 'removes', 'adds']) {
        if (field in data) data[field] = gunzipField(data[field])
    }
    return { ...rest, data } as unknown as { type: number }
}

export const recordedEvents = (network: Transport): Array<{ type: number; [key: string]: unknown }> =>
    network.snapshots.flatMap((request) =>
        request.events.flatMap((event) =>
            (event.properties.$snapshot_data as Array<Record<string, any>>).map(decompressEvent)
        )
    )

export const isCompressed = (network: Transport): boolean =>
    network.snapshots.some((request) =>
        request.events.some((event) =>
            (event.properties.$snapshot_data as Array<Record<string, any>>).some(
                (recorded) => recorded.cv === '2024-10'
            )
        )
    )

export const snapshotEvents = (network: Transport): SnapshotRequest['events'] =>
    network.snapshots.flatMap((request) => request.events)

/** The `$recording_status` debug property a captured event carries now. */
export const recordingStatus = (posthog: IPostHog): unknown => {
    let value: unknown
    const subscription = posthog.onEvent(({ properties }) => {
        value = properties.$recording_status
    })
    posthog.capture('probe')
    subscription.dispose()
    return value
}

export const resetDocument = (): void => {
    document.body.innerHTML =
        '<input id="name" /><input id="password" type="password" /><div class="ph-no-capture">hidden text</div>'
}

export const shutdownClients = async (): Promise<void> => {
    await Promise.all(clients.splice(0).map((client) => client.shutdown(0)))
}
