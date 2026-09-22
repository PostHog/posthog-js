// @vitest-environment jsdom
import type { ReplayOptions as SharedOptions, ReplayRecorderClient } from '@posthog/browser-common/replay/host'
import {
    SESSION_RECORDING_REMOTE_CONFIG,
    SESSION_RECORDING_FLUSHED_SIZE,
} from '@posthog/browser-common/replay/constants'
import { gunzipSync, strFromU8 } from 'fflate'
import { Blob as NodeBlob } from 'node:buffer'
import { createPostHog } from '../src/core'
import { replay } from '../src/replay'
import { flags } from '../src/flags'
import type { PostHog, CorePostHogOptions, RemoteConfig } from '../src/core'
import { localRemoteConfig, MemoryStorage } from './helpers'
import type { ReplayExtension } from '../src/replay-internal'
import type { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'

const runtime = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../src/entrypoints/replay-runtime', () => ({ createRecorder: runtime.create }))
const clients: PostHog[] = []
let recorderClient: ReplayRecorderClient
let recorderOptions: () => SharedOptions
let tail: (() => void) | undefined
const stop = vi.fn()
const discard = vi.fn()
const start = vi.fn()
const config: RemoteConfig = {
    ...localRemoteConfig,
    supportedCompression: ['gzip-js'],
    sessionRecording: { sampleRate: '1' },
}
const base = {
    projectToken: 'ph_replay',
    storage: false,
    navigator: false,
    fetch: false,
    capturePageview: false,
    remoteConfig: config,
} as const
const create = async (options: Partial<CorePostHogOptions> = {}) => {
    const client = await createPostHog({ ...base, extensions: [replay()], ...options })
    clients.push(client)
    return client
}
const snapshot = (value = 'snapshot') =>
    recorderClient.replay.captureSnapshot('/s/', {
        $snapshot_data: [{ type: 2, timestamp: 1000, data: { value } }],
        $snapshot_bytes: 40,
        $session_id: 'recording-session',
        $window_id: 'recording-window',
    })

beforeEach(() => {
    vi.stubGlobal('Blob', NodeBlob)
    tail = undefined
    runtime.create.mockImplementation((client: ReplayRecorderClient, options: () => SharedOptions) => {
        recorderClient = client
        recorderOptions = options
        let isStarted = false
        client.replay.checkSession()
        return {
            get isStarted() {
                return isStarted
            },
            status: 'active',
            start: () => {
                isStarted = true
                start()
            },
            stop: () => {
                isStarted = false
                stop()
            },
            discard: () => {
                isStarted = false
                discard()
            },
            flushBeforeIdentityReset: () => tail?.(),
        }
    })
})
afterEach(async () => {
    tail = undefined
    await Promise.all(clients.splice(0).map((client) => client.shutdown(0)))
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    sessionStorage.clear()
})

describe('browser-next replay adapter', () => {
    it('loads runtime only after remote enablement and consent, and does not advance an opted-out session', async () => {
        const disabled = await create({ remoteConfig: { ...localRemoteConfig, sessionRecording: false } })
        expect(runtime.create).not.toHaveBeenCalled()
        expect(disabled.session.sessionId).toBe('')
        const denied = await create({ optOutByDefault: true })
        expect(runtime.create).not.toHaveBeenCalled()
        expect(denied.session.sessionId).toBe('')
        denied.optIn()
        await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
        expect(denied.canCapture).toBe(true)
        expect(denied.session.sessionId).not.toBe('')
    })

    it('snapshots nested configuration without losing masking callbacks and maps camelCase', async () => {
        const mask = vi.fn((value: string) => value)
        const options = {
            attributeFilter: ['id'],
            sampling: { mousemove: false as const },
            maskInputFn: mask,
            fullSnapshotIntervalMs: 1234,
            compressEvents: false,
        }
        const extension = replay(options)
        options.attributeFilter.push('secret')
        await create({ extensions: [extension] })
        await vi.waitFor(() => expect(runtime.create).toHaveBeenCalledOnce())
        expect(recorderOptions().recording).toMatchObject({
            attributeFilter: ['id'],
            maskInputFn: mask,
            full_snapshot_interval_millis: 1234,
            compress_events: false,
            sampling: { mousemove: false },
        })
    })

    it('uses replay wire and pinned admission identity, never the analytics V1 queue', async () => {
        const requests: Array<{ url: string; body: Blob }> = []
        const fetch = vi.fn(async (url, init) => {
            requests.push({ url: String(url), body: init.body })
            return new Response('{}')
        })
        const client = await create({ fetch })
        await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
        const anonymous = client.distinctId
        snapshot('old')
        await client.identify('person')
        snapshot('new')
        await client.flush()
        expect(requests).toHaveLength(2)
        const decode = async (index: number) =>
            JSON.parse(strFromU8(gunzipSync(new Uint8Array(await requests[index]!.body.arrayBuffer()))))[0]
        expect(await decode(0)).toMatchObject({
            event: '$snapshot',
            properties: {
                token: 'ph_replay',
                distinct_id: anonymous,
                $session_id: 'recording-session',
                $window_id: 'recording-window',
                $snapshot_bytes: 40,
            },
        })
        expect(await decode(1)).toMatchObject({ event: '$snapshot', properties: { distinct_id: 'person' } })
        expect(requests.every((request) => new URL(request.url).pathname === '/s/')).toBe(true)
        expect(await decode(0)).toHaveProperty('timestamp')
        expect(stop).not.toHaveBeenCalled()
        expect(discard).not.toHaveBeenCalled()
    })

    it('flushes old tails before reset and preserves only server recording configuration', async () => {
        const fetch = vi.fn(async () => new Response('{}'))
        const client = await create({ fetch })
        await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
        const oldId = client.distinctId
        const persisted = recorderClient.kv.get(SESSION_RECORDING_REMOTE_CONFIG)
        recorderClient.kv.set(SESSION_RECORDING_FLUSHED_SIZE, { sessionId: 'old', size: 100 })
        tail = () => {
            snapshot('tail')
            tail = undefined
        }
        client.reset()
        expect(client.distinctId).not.toBe(oldId)
        expect(recorderClient.kv.get(SESSION_RECORDING_REMOTE_CONFIG)).toEqual(persisted)
        expect(recorderClient.kv.get(SESSION_RECORDING_FLUSHED_SIZE)).toBeUndefined()
        await client.flush()
        const body = (fetch.mock.calls[0] as unknown as [URL, RequestInit])[1].body as Blob
        expect(
            JSON.parse(strFromU8(gunzipSync(new Uint8Array(await body.arrayBuffer()))))[0].properties.distinct_id
        ).toBe(oldId)
    })

    it('purges recording and delivery on denial, aborts pending requests, and restarts on grant', async () => {
        let signal: AbortSignal | undefined
        const fetch = vi.fn(async (_url, init) => {
            signal = init.signal
            return new Promise<Response>(() => {})
        })
        const client = await create({ fetch })
        await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
        snapshot()
        const flushing = client.flush()
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
        client.optOut()
        await flushing
        expect(signal?.aborted).toBe(true)
        expect(client.canCapture).toBe(false)
        expect(discard).toHaveBeenCalledOnce()
        client.optIn()
        await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2))
        await client.flush()
        expect(fetch).toHaveBeenCalledOnce()
        expect(client.canCapture).toBe(true)
    })

    it('uses selected persistence permission for tab buffers and purges them on denial', async () => {
        const memoryOnly = await create()
        await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
        const memoryStore = recorderClient.replay.createPendingBufferStore()
        expect(memoryStore.enabled).toBe(false)
        memoryStore.write({ secret: true })
        expect(sessionStorage.length).toBe(0)
        await memoryOnly.dispose()
        const client = await create({ storage: new MemoryStorage() })
        await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2))
        const store = recorderClient.replay.createPendingBufferStore()
        store.write({ data: 'pending' })
        expect(store.read()).toEqual({ data: 'pending' })
        client.optOut()
        expect(sessionStorage.length).toBe(0)
        store.write({ data: 'late' })
        expect(sessionStorage.length).toBe(0)
    })

    it.each(['persisted', 'default'])('purges parked data when initial consent is %s denied', async (mode) => {
        const storage = new MemoryStorage()
        if (mode === 'persisted') storage.setItem('__ph_opt_in_out_ph_replay', '0')
        const key = `ph_replay_pending_${JSON.stringify(['ph_ph_replay_posthog_browser_v2', 'ph_replay'])}`
        sessionStorage.setItem(key, JSON.stringify({ data: 'prior-session' }))
        sessionStorage.setItem('other-project', 'preserved')
        const client = await create({ storage, optOutByDefault: mode === 'default' })
        expect(runtime.create).not.toHaveBeenCalled()
        expect(sessionStorage.getItem(key)).toBeNull()
        expect(sessionStorage.getItem('other-project')).toBe('preserved')
        client.optIn()
        await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
        expect(recorderClient.replay.createPendingBufferStore().read()).toBeNull()
    })

    it('connects flag subscriptions created before a later configured flags extension', async () => {
        const listener = vi.fn()
        const removed = vi.fn()
        let publishFlags!: (variant: string) => void
        let subscription: { dispose(): void } | undefined
        const client = await create({
            extensions: [
                replay(),
                {
                    name: 'slow-setup',
                    async setup(peer) {
                        await vi.waitFor(() => expect(runtime.create).toHaveBeenCalledOnce())
                        subscription = recorderClient.replay.onFlags(listener)
                        recorderClient.replay.onFlags(removed).dispose()
                        publishFlags = (variant) =>
                            peer.getExtension<PostHogFeatureFlags>('featureFlags')!.receivedFeatureFlags({
                                featureFlags: { linked: variant },
                            })
                        expect(listener).not.toHaveBeenCalled()
                    },
                },
                flags({ bootstrap: { featureFlags: { linked: 'variant' } }, featureFlagEvaluation: false }),
            ],
        })
        expect(listener).toHaveBeenCalledWith({ linked: 'variant' })
        publishFlags('updated')
        await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith({ linked: 'updated' }))
        expect(removed).not.toHaveBeenCalled()
        subscription?.dispose()
        listener.mockClear()
        publishFlags('after-unsubscribe')
        await client.dispose()
        expect(listener).not.toHaveBeenCalled()
    })

    it('uses shared flag subscription values without exposure events', async () => {
        const client = await create({
            extensions: [
                flags({ bootstrap: { featureFlags: { linked: 'variant' } }, featureFlagEvaluation: false }),
                replay(),
            ],
        })
        await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
        const events = vi.fn()
        client.onEvent(events)
        const listener = vi.fn()
        const subscription = recorderClient.replay.onFlags(listener)
        expect(listener).toHaveBeenCalledWith({ linked: 'variant' })
        expect(events).not.toHaveBeenCalled()
        subscription.dispose()
    })

    it('refreshes through the core config owner, sharing in-flight requests and publication', async () => {
        let refresh!: () => void
        let respond!: (response: Response) => void
        const published = vi.fn()
        const fetch = vi.fn(
            () =>
                new Promise<Response>((resolve) => {
                    respond = resolve
                })
        )
        const extension: ReplayExtension = {
            name: 'sessionRecording',
            initialize(_session, context) {
                refresh = context.refreshRemoteConfig
            },
            setup(client) {
                client.onRemoteConfig(published)
            },
        }
        const client = await create({ extensions: [extension], fetch })
        expect(published).toHaveBeenCalledOnce()
        refresh()
        refresh()
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
        respond(new Response(JSON.stringify({ ...config, sessionRecording: false })))
        await vi.waitFor(() => expect(published).toHaveBeenCalledTimes(2))
        expect(await client.getRemoteConfig()).toMatchObject({ sessionRecording: false })
    })

    it('reserves shutdown identity before invoking reentrant producer hooks and keeps admission closed', async () => {
        let nested: Promise<void> | undefined
        let host!: Parameters<ReplayExtension['initialize']>[0]
        let checks: unknown
        const calls = vi.fn()
        const extension: ReplayExtension = {
            name: 'sessionRecording',
            initialize(value) {
                host = value
            },
            setup() {},
            async flush(shutdown) {
                if (!shutdown) return
                calls()
                nested = client.shutdown()
                client.capture('closed')
                await client.identify('closed')
                client.reset()
                checks = host.checkSession()
            },
        }
        const client = await create({ extensions: [extension] })
        const id = client.distinctId
        const events = vi.fn()
        client.onEvent(events)
        const outer = client.shutdown()
        expect(nested).toBe(outer)
        await outer
        expect(calls).toHaveBeenCalledOnce()
        expect(client.distinctId).toBe(id)
        expect(events).not.toHaveBeenCalled()
        expect(checks).toEqual({ sessionId: '', windowId: '', sessionStartTimestamp: 0 })
    })

    it('bounds shutdown and prevents stopped producers from restarting', async () => {
        const client = await create({ fetch: async () => new Promise<Response>(() => {}) })
        await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
        snapshot()
        await client.shutdown(1)
        expect(stop).toHaveBeenCalled()
        expect(recorderClient.replay.sessionActive).toBe(false)
        client.optIn()
        await Promise.resolve()
        expect(start).toHaveBeenCalledOnce()
    })
})
