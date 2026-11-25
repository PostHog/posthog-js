/// <reference lib="dom" />
import { createMockPostHog, createMockConfig } from '../../helpers/posthog-instance'
import { PostHog } from '../../../posthog-core'
import { Property, RemoteConfig, RemoteConfigResult } from '../../../types'
import { EventType, IncrementalSource, type eventWithTime } from '../../../extensions/replay/types/rrweb-types'
import { ConsentManager } from '../../../consent'
import { SimpleEventEmitter } from '@posthog/browser-common/utils/simple-event-emitter'

vi.mock('../../../remote-config', () => ({
    RemoteConfigLoader: vi.fn().mockImplementation(() => ({ load: vi.fn() })),
}))

const MINUTE = 60 * 1000
const FULL_SNAPSHOT_INTERVAL = 5 * MINUTE
const RECORDING_BUFFER_TIMEOUT = 2000

type HarnessOptions = { compress?: boolean; strayRecorder?: boolean }

// rrweb reads Date.now once at import, so every module loads after the fake clock is installed
async function createHarness({ compress = false, strayRecorder = false }: HarnessOptions = {}) {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    vi.resetModules()

    // gzip that only finishes when the test says so, so a stop can land with compression in flight
    const pendingGzip: (() => void)[] = []
    vi.doMock('@posthog/core', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@posthog/core')>()
        return {
            ...actual,
            isGzipSupported: () => compress,
            gzipCompress: vi.fn(
                (input: string) => new Promise<Blob>((resolve) => pendingGzip.push(() => resolve(new Blob([input]))))
            ),
        }
    })

    const { record: realRecord } = await import('@posthog/rrweb-record')
    const { PostHogPersistence } = await import('../../../posthog-persistence')
    const constants = await import('../../../constants')
    const { SessionIdManager } = await import('../../../sessionid')
    const { assignableWindow } = await import('../../../utils/globals')
    const { RequestRouter } = await import('../../../utils/request-router')
    const { SessionRecording } = await import('../../../extensions/replay/session-recording')
    const { LazyLoadedSessionRecording } =
        await import('../../../extensions/replay/external/lazy-loaded-session-recorder')

    document.body.innerHTML = '<div id="app"><button id="b">go</button><span id="t">0</span></div>'

    let sessionCounter = 0
    const config = createMockConfig({
        api_host: 'https://test.com',
        token: 'test-token',
        autocapture: false,
        session_idle_timeout_seconds: 30 * 60,
        session_recording: { maskAllInputs: false, compress_events: compress },
        persistence: 'memory',
    })
    const persistence = new PostHogPersistence(config)
    persistence.clear()
    const sessionManager = new SessionIdManager(
        createMockPostHog({ config, persistence, register: vi.fn() }),
        vi.fn(() => `session-${++sessionCounter}`),
        vi.fn(() => `window-${sessionCounter}`)
    )
    const emitter = new SimpleEventEmitter()
    const capture = vi.fn()
    const posthog = {
        get_property: (key: string): Property | undefined => persistence.props[key],
        config,
        capture,
        persistence,
        onFeatureFlags: () => () => {},
        sessionManager,
        requestRouter: new RequestRouter({ config } as any),
        consent: { isOptedOut: () => false } as unknown as ConsentManager,
        has_opted_out_capturing(): boolean {
            return this.consent.isOptedOut()
        },
        register_for_session() {},
        _internalEventEmitter: emitter,
        on: vi.fn().mockImplementation((event, cb) => emitter.on(event, cb)),
    } as Partial<PostHog> as PostHog

    // counts the replay recorder's rrweb recorders, so a second live one or a stop of a superseded one shows up
    const recorders = { starts: 0, lateStops: 0, maxLive: 0, live: new Set<number>() }
    let latest = 0
    let onEmit: ((e: eventWithTime) => void) | undefined
    let stray: (() => void) | undefined
    const record: any = (options: any) => {
        if (strayRecorder && !stray) {
            // another recorder on the page that starts before replay's and stops after it
            stray = realRecord({ emit: () => {} })
        }
        const id = ++recorders.starts
        latest = id
        recorders.live.add(id)
        recorders.maxLive = Math.max(recorders.maxLive, recorders.live.size)
        const stop = realRecord({
            ...options,
            emit: (e: eventWithTime, isCheckout?: boolean) => {
                options.emit(e, isCheckout)
                onEmit?.(e)
            },
        })
        return () => {
            if (recorders.live.delete(id) && id !== latest) {
                recorders.lateStops++
            }
            stop?.()
        }
    }
    record.takeFullSnapshot = (isCheckout?: boolean) => realRecord.takeFullSnapshot(isCheckout)
    record.addCustomEvent = (tag: string, payload: unknown) => realRecord.addCustomEvent(tag, payload)
    record.isRecording = () => realRecord.isRecording()
    record.withStyleRuleSourceHandoff = realRecord.withStyleRuleSourceHandoff

    assignableWindow.__PosthogExtensions__ = {
        rrweb: { record, version: 'real' },
        rrwebPlugins: {},
        loadExternalDependency: vi.fn((_ph, _path, callback) => callback()),
        initSessionRecording: (ph: PostHog, documentWasEverVisible?: boolean) =>
            new LazyLoadedSessionRecording(ph, documentWasEverVisible),
    } as any

    persistence.register({
        [constants.SESSION_RECORDING_ENABLED_SERVER_SIDE]: true,
        [constants.CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE]: false,
        [constants.SESSION_RECORDING_IS_SAMPLED]: undefined,
    })

    const sessionRecording = new SessionRecording(posthog)
    sessionRecording.onRemoteConfig({
        ok: true,
        config: { sessionRecording: { endpoint: '/s/' } } as unknown as RemoteConfig,
    } as RemoteConfigResult)
    const lazy = () => sessionRecording['_lazyLoadedSessionRecording'] as any

    // what posthog.startSessionRecording() and stopSessionRecording() do
    const startSessionRecording = (override?: { sampling?: boolean }) => {
        if (override?.sampling) {
            sessionManager.checkAndGetSessionAndWindowId()
            sessionRecording.overrideSampling()
        }
        config.disable_session_recording = false
        sessionRecording.startIfEnabledOrStop()
    }
    const stopSessionRecording = () => {
        config.disable_session_recording = true
        sessionRecording.startIfEnabledOrStop()
    }

    let counter = 0
    const settle = async () => {
        for (let i = 0; i < 5; i++) {
            await Promise.resolve()
        }
    }
    const finishGzip = async () => {
        while (pendingGzip.length) {
            pendingGzip.shift()!()
            await settle()
        }
    }
    const click = async () => {
        document.getElementById('b')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await settle()
    }
    const mutate = async () => {
        document.getElementById('t')!.textContent = String(++counter)
        await settle()
    }
    const shipped = (sessionId: string, since: number): eventWithTime[] =>
        capture.mock.calls
            .filter(([name, props]) => name === '$snapshot' && props.$session_id === sessionId)
            .flatMap(([, props]) => props.$snapshot_data as eventWithTime[])
            .filter((e) => e.timestamp >= since)

    return {
        sessionManager,
        lazy,
        click,
        mutate,
        settle,
        finishGzip,
        shipped,
        recorders,
        startSessionRecording,
        stopSessionRecording,
        stopStray: () => stray?.(),
        isRecording: () => realRecord.isRecording(),
        setOnEmit: (fn?: (e: eventWithTime) => void) => {
            onEmit = fn
        },
    }
}

type Harness = Awaited<ReturnType<typeof createHarness>>

type Scenario = {
    compress?: boolean
    // how the tab sits idle past the 30 minute session timeout
    idle: 'idle timer fires' | 'frozen tab'
    // runs while the recorder is stopped after the forced idle reset, before the next session is minted
    beforeMint?: (h: Harness) => void
    afterMint?: (h: Harness) => void
    // runs on each of the person's clicks after they return
    onReturnClick?: (h: Harness, i: number) => void
    // runs inside the rrweb emit of the person's first click after they return
    insideFirstReturnEmit?: (h: Harness) => void
}

// a callback run inside the first Meta emit of the next rrweb record(), before replay holds its stop handle
const insideNextRecordMetaEmit = (h: Harness, fn: () => void) => {
    let fired = false
    h.setOnEmit((e) => {
        if (!fired && e.type === EventType.Meta) {
            fired = true
            fn()
        }
    })
}

const SCENARIOS: Record<string, Scenario> = {
    'the idle timer resets the session and a capture mints the next': { idle: 'idle timer fires' },
    'the idle timer resets the session while gzip is pending': { idle: 'idle timer fires', compress: true },
    'a frozen tab rotates on the first click after return': { idle: 'frozen tab' },
    'startSessionRecording({sampling}) while stopped after the idle reset': {
        idle: 'idle timer fires',
        beforeMint: (h) => h.startSessionRecording({ sampling: true }),
    },
    'startSessionRecording() on every screen change after return': {
        idle: 'idle timer fires',
        onReturnClick: (h) => h.startSessionRecording(),
    },
    'stop and start inside the first emit after return': {
        idle: 'idle timer fires',
        insideFirstReturnEmit: (h) => {
            h.stopSessionRecording()
            h.startSessionRecording()
        },
    },
    'a new session is minted inside the restart record() Meta emit': {
        idle: 'idle timer fires',
        beforeMint: (h) =>
            insideNextRecordMetaEmit(h, () => {
                h.sessionManager.resetSessionId()
                h.sessionManager.checkAndGetSessionAndWindowId(false, Date.now())
            }),
        afterMint: (h) => h.setOnEmit(undefined),
    },
    'stop and start inside the restart record() Meta emit': {
        idle: 'idle timer fires',
        beforeMint: (h) =>
            insideNextRecordMetaEmit(h, () => {
                h.stopSessionRecording()
                h.startSessionRecording()
            }),
        afterMint: (h) => h.setOnEmit(undefined),
    },
}

describe('replay recorder with the real rrweb recorder', () => {
    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
        vi.doUnmock('@posthog/core')
    })

    it.each(Object.keys(SCENARIOS))(
        'keeps one rrweb recorder and full snapshots after an idle rotation when %s',
        async (name) => {
            const s = SCENARIOS[name]
            const h = await createHarness({ compress: s.compress })
            await h.click()
            await h.mutate()
            vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
            await h.finishGzip()
            const firstSession = h.lazy()._sessionId as string

            if (s.idle === 'frozen tab') {
                vi.setSystemTime(Date.now() + 54 * MINUTE)
            } else {
                for (let i = 0; i < 33; i++) {
                    vi.advanceTimersByTime(MINUTE)
                    await h.mutate()
                }
                s.beforeMint?.(h)
                await h.finishGzip()
                h.sessionManager.checkAndGetSessionAndWindowId(true, Date.now())
                s.afterMint?.(h)
                await h.finishGzip()
                for (let i = 0; i < 21; i++) {
                    vi.advanceTimersByTime(MINUTE)
                    await h.mutate()
                }
            }

            const returnedAt = Date.now()
            if (s.insideFirstReturnEmit) {
                let fired = false
                h.setOnEmit((e) => {
                    if (
                        !fired &&
                        e.type === EventType.IncrementalSnapshot &&
                        (e.data as any).source === IncrementalSource.MouseInteraction
                    ) {
                        fired = true
                        s.insideFirstReturnEmit!(h)
                    }
                })
            }
            for (let i = 0; i < 12; i++) {
                await h.click()
                s.onReturnClick?.(h, i)
                await h.mutate()
                vi.advanceTimersByTime(MINUTE)
                await h.finishGzip()
            }
            vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
            await h.finishGzip()

            const secondSession = h.lazy()._sessionId as string
            const fullSnapshots = h
                .shipped(secondSession, returnedAt)
                .filter((e) => e.type === EventType.FullSnapshot).length
            expect({
                changedSession: secondSession !== firstSession,
                atLeastTwoFullSnapshots: fullSnapshots >= 2,
                isRecording: h.isRecording(),
                liveRecorders: h.recorders.live.size,
                maxLiveRecorders: h.recorders.maxLive,
                lateStops: h.recorders.lateStops,
            }).toEqual({
                changedSession: true,
                atLeastTwoFullSnapshots: true,
                isRecording: true,
                liveRecorders: 1,
                maxLiveRecorders: 1,
                lateStops: 0,
            })
        }
    )

    it('restarts rrweb and ships a full snapshot within one interval after another recorder stops it', async () => {
        const h = await createHarness({ strayRecorder: true })
        await h.click()
        await h.mutate()
        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)

        // the other recorder's stop clears rrweb's shared recording flag under replay's live recorder
        h.stopStray()
        const brokenAt = Date.now()
        expect(h.isRecording()).toBe(false)

        for (let i = 0; i < 6; i++) {
            await h.click()
            await h.mutate()
            vi.advanceTimersByTime(MINUTE)
        }
        vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
        await h.settle()

        const session = h.lazy()._sessionId as string
        const events = h.shipped(session, brokenAt)
        const fullSnapshotAt = events.find((e) => e.type === EventType.FullSnapshot)?.timestamp
        const restartMarker = events.find(
            (e) => e.type === EventType.Custom && (e.data as any).tag === '$replay_recorder_restarted'
        )
        const debug = h.lazy().sdkDebugProperties
        expect({
            isRecording: h.isRecording(),
            fullSnapshotWithinOneInterval: !!fullSnapshotAt && fullSnapshotAt - brokenAt <= FULL_SNAPSHOT_INTERVAL,
            restartMarker: !!restartMarker,
            maxLiveRecorders: h.recorders.maxLive,
            lateStops: h.recorders.lateStops,
            debug: {
                restarts: debug.$sdk_debug_replay_rrweb_restarts,
                lastError: debug.$sdk_debug_replay_rrweb_last_method_error,
                recordingAtFailure: debug.$sdk_debug_replay_rrweb_recording_at_failure,
                liveRecorders: debug.$sdk_debug_replay_rrweb_live_recorders,
            },
        }).toEqual({
            isRecording: true,
            fullSnapshotWithinOneInterval: true,
            restartMarker: true,
            maxLiveRecorders: 1,
            lateStops: 0,
            debug: {
                restarts: 1,
                lastError: 'please take full snapshot after start recording',
                recordingAtFailure: false,
                liveRecorders: 1,
            },
        })
    })
})
