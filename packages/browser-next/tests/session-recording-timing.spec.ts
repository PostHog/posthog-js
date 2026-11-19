// @vitest-environment jsdom
import { createPostHog } from '../src/composition/npm/core'
import type { IPostHog } from '../src/core/types'
import { sessionRecording } from '../src/products/session-recording/session-recording'
import type { SessionRecordingExtension } from '../src/products/session-recording/session-recording-internal'
import type { RemoteConfig } from '../src/composition/npm/core'
import {
    clients,
    interact,
    MemoryStorage,
    remoteConfig,
    transport,
    type Transport,
    recordedEvents,
    recordingStatus,
    resetDocument,
    setup,
    shutdownClients,
    snapshotEvents,
    started,
} from './session-recording-helpers'

// rrweb keeps the Date.now it saw when it loaded, so fake the clock before the recorder loads
beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
})

afterAll(() => {
    vi.useRealTimers()
})

beforeEach(() => {
    resetDocument()
    localStorage.clear()
    sessionStorage.clear()
})

/** A client on the browser's own storage, so tab storage survives a simulated navigation. */
const pageLoad = async (
    network: Transport,
    config: Parameters<typeof remoteConfig>[0] | undefined
): Promise<{ posthog: IPostHog; replay: SessionRecordingExtension }> => {
    const replay = sessionRecording()
    const posthog = await createPostHog({
        projectToken: 'ph_test',
        capturePageview: false,
        navigator: false,
        fetch: network.fetch,
        ...(config === undefined ? {} : { remoteConfig: remoteConfig(config) }),
        extensions: [replay],
    })
    clients.push(posthog)
    return { posthog, replay }
}

/** Unloads the page: its lifecycle events fire and its recorder stops, as the next page loads in the same tab. */
const navigateAway = (replay: SessionRecordingExtension): void => {
    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('beforeunload'))
    replay.dispose?.()
}

afterEach(async () => {
    await shutdownClients()
})

const advance = (milliseconds: number): void => {
    vi.setSystemTime(Date.now() + milliseconds)
}

/** A DOM change after the idle threshold marks the recording idle without user interaction. */
const goIdle = async (): Promise<void> => {
    advance(6 * 60_000)
    document.body.appendChild(document.createElement('span'))
    await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('session recording timing', () => {
    it('sends a session once it reaches the minimum duration', async () => {
        const { replay, transport: network } = await setup({ minimumDurationMilliseconds: 60_000 })
        await started(replay)
        interact()
        await replay.flush?.()
        expect(network.snapshots).toHaveLength(0)

        advance(61_000)
        interact()
        await replay.flush?.()

        expect(network.snapshots.length).toBeGreaterThan(0)
    })

    it('stops sending while idle and resumes on interaction', async () => {
        const { replay, transport: network } = await setup()
        await started(replay)
        interact()
        await replay.flush?.()

        await goIdle()
        await replay.flush?.()
        const tags = recordedEvents(network)
            .filter((event) => event.type === 5)
            .map((event) => (event.data as { tag: string }).tag)
        expect(tags).toContain('sessionIdle')
        const sentWhileIdle = recordedEvents(network).length
        document.body.appendChild(document.createElement('p'))
        await new Promise((resolve) => setTimeout(resolve, 0))
        await replay.flush?.()
        expect(recordedEvents(network)).toHaveLength(sentWhileIdle)

        interact()
        await replay.flush?.()

        const resumed = recordedEvents(network).slice(sentWhileIdle)
        expect(resumed.map((event) => event.type)).toContain(2)
    })

    it('drops a held recording on unload once its session passed the maximum length', async () => {
        const { replay, transport: network } = await setup()
        await started(replay)

        advance(25 * 60 * 60_000)
        document.body.appendChild(document.createElement('span'))
        await new Promise((resolve) => setTimeout(resolve, 0))
        window.dispatchEvent(new Event('pagehide'))
        await replay.flush?.()

        expect(network.snapshots).toHaveLength(0)
    })

    it('holds a recording born from an idle rotation, even when the page unloads', async () => {
        const { replay, posthog, transport: network } = await setup()
        await started(replay)
        interact()
        await replay.flush?.()
        const firstSession = posthog.session!.sessionId

        await goIdle()
        advance(31 * 60_000)
        posthog.capture('background event')
        expect(posthog.session!.sessionId).not.toBe(firstSession)
        await started(replay)
        window.dispatchEvent(new Event('pagehide'))
        await replay.flush?.()

        const rotated = snapshotEvents(network).filter((event) => event.properties.$session_id !== firstSession)
        expect(rotated).toHaveLength(0)
    })

    it('records the rotated session once the user interacts', async () => {
        const { replay, posthog, transport: network } = await setup()
        await started(replay)
        interact()
        await replay.flush?.()
        const firstSession = posthog.session!.sessionId
        await goIdle()
        advance(31 * 60_000)
        posthog.capture('background event')

        interact()
        await replay.flush?.()

        const rotated = snapshotEvents(network).filter(
            (event) => event.properties.$session_id === posthog.session!.sessionId
        )
        expect(posthog.session!.sessionId).not.toBe(firstSession)
        expect(rotated.flatMap((event) => event.properties.$snapshot_data).map((event) => event.type)).toContain(2)
    })

    it('rotates the session on interaction after the session expired', async () => {
        const { replay, posthog, transport: network } = await setup()
        await started(replay)
        interact()
        await replay.flush?.()
        const firstSession = posthog.session!.sessionId

        advance(31 * 60_000)
        interact()
        await replay.flush?.()

        expect(posthog.session!.sessionId).not.toBe(firstSession)
        const sessions = new Set(snapshotEvents(network).map((event) => event.properties.$session_id))
        expect(sessions).toEqual(new Set([firstSession, posthog.session!.sessionId]))
    })

    it('keeps recording the next session after reset', async () => {
        const { replay, posthog, transport: network } = await setup()
        await started(replay)
        interact()
        await replay.flush?.()
        const firstSession = posthog.session!.sessionId
        const firstDistinctId = posthog.distinctId

        posthog.reset()
        interact()
        await replay.flush?.()

        expect(replay.sessionRecordingStarted()).toBe(true)
        const next = snapshotEvents(network).filter((event) => event.properties.$session_id !== firstSession)
        expect(next.length).toBeGreaterThan(0)
        expect(next.every((event) => event.properties.distinct_id !== firstDistinctId)).toBe(true)
        expect(
            snapshotEvents(network)
                .filter((event) => event.properties.$session_id === firstSession)
                .every((event) => event.properties.distinct_id === firstDistinctId)
        ).toBe(true)
    })

    it('continues a recording held by the minimum duration on the next page', async () => {
        const network = transport()
        const first = await pageLoad(network, { minimumDurationMilliseconds: 60_000 })
        await started(first.replay)
        interact()
        navigateAway(first.replay)
        expect(network.snapshots).toHaveLength(0)

        const second = await pageLoad(network, { minimumDurationMilliseconds: 60_000 })
        await started(second.replay)
        expect(second.posthog.session!.sessionId).toBe(first.posthog.session!.sessionId)
        advance(61_000)
        interact()
        await second.replay.flush?.()

        const metas = recordedEvents(network).filter((event) => event.type === 4)
        expect(metas.length).toBeGreaterThanOrEqual(2)
    })

    it('keeps starting from the configuration this page received after an hour', async () => {
        const { replay } = await setup()
        await started(replay)

        replay.stopSessionRecording()
        advance(2 * 60 * 60_000)
        replay.startSessionRecording()

        await started(replay)
    })

    it('refreshes the saved configuration on each new session', async () => {
        const { replay, posthog } = await setup()
        await started(replay)
        const saved = () => posthog.kv.get('$session_recording_remote_config') as { cache_timestamp: number }
        const before = saved().cache_timestamp

        advance(31 * 60_000)
        posthog.capture('next session')

        expect(saved().cache_timestamp).toBeGreaterThan(before)
    })

    it('reports a stale saved configuration only on SDK events that carry optional replay diagnostics', async () => {
        const network = transport()
        const first = await pageLoad(network, {})
        await started(first.replay)
        navigateAway(first.replay)
        advance(2 * 60 * 60_000)
        const second = await pageLoad(network, undefined)
        await vi.waitFor(() => expect(recordingStatus(second.posthog)).toBe('missing_config'))
        const staleConfig = (event: string): unknown => {
            let value: unknown
            const subscription = second.posthog.onEvent(({ properties }) => {
                value = properties.$sdk_debug_replay_stale_config
            })
            second.posthog.capture(event)
            subscription.dispose()
            return value
        }

        expect(staleConfig('ordinary_custom')).toBeUndefined()
        expect(staleConfig('$pageview')).toBe(true)
    })

    it('keeps recording after reset when remote configuration failed on this page', async () => {
        const network = transport()
        const storage = new MemoryStorage()
        const load = async (config: RemoteConfig | undefined) => {
            const replay = sessionRecording()
            const posthog = await createPostHog({
                projectToken: 'ph_test',
                capturePageview: false,
                storage,
                navigator: false,
                fetch: network.fetch,
                ...(config ? { remoteConfig: config } : {}),
                extensions: [replay],
            })
            clients.push(posthog)
            return { posthog, replay }
        }
        const first = await load(remoteConfig({}))
        await started(first.replay)
        await first.posthog.shutdown(0)
        const second = await load(undefined)
        await started(second.replay)

        second.posthog.reset()
        second.replay.stopSessionRecording()
        second.replay.startSessionRecording()
        await started(second.replay)
        interact()
        await second.replay.flush?.()

        const sessions = new Set(snapshotEvents(network).map((event) => event.properties.$session_id))
        expect(sessions.has(second.posthog.session!.sessionId)).toBe(true)
    })

    it.each(['1', '0'])(
        'applies a fresh sample rate of %s to a recording started from the saved configuration',
        async (sampleRate) => {
            const network = transport()
            const first = await pageLoad(network, { sampleRate: '1' })
            await started(first.replay)
            navigateAway(first.replay)

            let respond!: (response: Response) => void
            const fresh = new Promise<Response>((resolve) => {
                respond = resolve
            })
            const second = await pageLoad(
                {
                    ...network,
                    fetch: (input, init) => (String(input).includes('/array/') ? fresh : network.fetch(input, init)),
                },
                undefined
            )
            await started(second.replay)
            respond(new Response(JSON.stringify(remoteConfig({ sampleRate })), { status: 200 }))
            await vi.waitFor(() =>
                expect(second.posthog.kv.get('$session_recording_remote_config')).toMatchObject({
                    sampleRate: Number(sampleRate),
                })
            )
            await started(second.replay)
            await second.replay.flush?.()
            network.snapshots.length = 0

            interact()
            await second.replay.flush?.()

            expect(network.snapshots.length > 0).toBe(sampleRate === '1')
        }
    )

    it('extends the session with replay interactions', async () => {
        const { replay, posthog } = await setup()
        await started(replay)
        const firstSession = posthog.session!.sessionId

        for (let minute = 0; minute < 4; minute++) {
            advance(20 * 60_000)
            interact()
        }

        expect(posthog.session!.sessionId).toBe(firstSession)
    })
})
