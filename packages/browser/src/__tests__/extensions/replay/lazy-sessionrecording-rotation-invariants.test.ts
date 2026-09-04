/// <reference lib="dom" />

import { isUndefined } from '@posthog/core'

import { PostHogPersistence } from '../../../posthog-persistence'
import {
    CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_IS_SAMPLED,
} from '../../../constants'
import { SessionIdManager } from '../../../sessionid'
import { createMockPostHog, createMockConfig } from '../../helpers/posthog-instance'
import {
    FULL_SNAPSHOT_EVENT_TYPE,
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    META_EVENT_TYPE,
} from '../../../extensions/replay/external/sessionrecording-utils'
import { PostHog } from '../../../posthog-core'
import { Property, RemoteConfig, RemoteConfigResult } from '../../../types'
import { assignableWindow } from '../../../utils/globals'
import { RequestRouter } from '../../../utils/request-router'
import { EventType, type eventWithTime, IncrementalSource } from '../../../extensions/replay/types/rrweb-types'
import { ConsentManager } from '../../../consent'
import { SimpleEventEmitter } from '@posthog/browser-common/utils/simple-event-emitter'
import { SessionRecording } from '../../../extensions/replay/session-recording'
import {
    LazyLoadedSessionRecording,
    RECORDING_BUFFER_TIMEOUT,
    RECORDING_IDLE_THRESHOLD_MS,
} from '../../../extensions/replay/external/lazy-loaded-session-recorder'

vi.mock('../../../remote-config', () => ({
    RemoteConfigLoader: vi.fn().mockImplementation(() => ({ load: vi.fn() })),
}))

const SEEDS = Array.from({ length: 32 }, (_, i) => 1 + i * 7919)
const ACTION_COUNT = 60
const MIN_ADVANCE_MS = 100
const MAX_ADVANCE_MS = 3 * 60 * 60 * 1000
const MINT_TOLERANCE_MS = 1000
const INTERACTIVE_SOURCES = [IncrementalSource.MouseInteraction, IncrementalSource.MouseMove, IncrementalSource.Input]

type Action =
    | { kind: 'advance'; ms: number }
    | { kind: 'interactive'; source: IncrementalSource }
    | { kind: 'mutation' }
    | { kind: 'fullSnapshot' }
    | { kind: 'checkSession' }
    | { kind: 'resetSession' }
    | { kind: 'forcedIdleReset' }
    | { kind: 'customEvent' }
    | { kind: 'flush' }

// weights: time advances and rotations are the interesting transitions
const ACTION_KINDS: Action['kind'][] = [
    'advance',
    'advance',
    'advance',
    'interactive',
    'interactive',
    'mutation',
    'fullSnapshot',
    'checkSession',
    'resetSession',
    'forcedIdleReset',
    'customEvent',
    'flush',
]

type Failure = { index: number; message: string }
type Coverage = { rotations: number; shippedSessions: number; idleMarkers: number; snapshotCaptures: number }

const coverage: Coverage = { rotations: 0, shippedSessions: 0, idleMarkers: 0, snapshotCaptures: 0 }

function mulberry32(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function generateActions(seed: number): Action[] {
    const random = mulberry32(seed)
    const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]
    const logSpan = Math.log(MAX_ADVANCE_MS) - Math.log(MIN_ADVANCE_MS)
    return Array.from({ length: ACTION_COUNT }, (): Action => {
        const kind = pick(ACTION_KINDS)
        if (kind === 'advance') {
            return { kind, ms: Math.round(Math.exp(Math.log(MIN_ADVANCE_MS) + random() * logSpan)) }
        }
        if (kind === 'interactive') {
            return { kind, source: pick(INTERACTIVE_SOURCES) }
        }
        return { kind }
    })
}

function formatActions(actions: Action[]): string {
    return actions.map((action, i) => `  ${i}: ${JSON.stringify(action)}`).join('\n')
}

const metaEvent = (): eventWithTime =>
    ({
        type: META_EVENT_TYPE,
        data: { href: 'https://has-to-be-present-or-invalid.com' },
        timestamp: Date.now(),
    }) as eventWithTime

const fullSnapshotEvent = (): eventWithTime =>
    ({ type: FULL_SNAPSHOT_EVENT_TYPE, data: {}, timestamp: Date.now() }) as eventWithTime

const incrementalEvent = (data: Record<string, unknown>): eventWithTime =>
    ({ type: INCREMENTAL_SNAPSHOT_EVENT_TYPE, data, timestamp: Date.now() }) as eventWithTime

const customEvent = (tag: string, payload: unknown): eventWithTime =>
    ({ type: EventType.Custom, data: { tag, payload }, timestamp: Date.now() }) as eventWithTime

type LiveRecorder = { emit: (event: eventWithTime) => void; active: boolean }

function createHarness() {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const mint = new Map<string, number>()
    let sessionCounter = 0
    const sessionIdGenerator = vi.fn(() => {
        const id = `session-${++sessionCounter}`
        mint.set(id, Date.now())
        return id
    })

    const config = createMockConfig({
        api_host: 'https://test.com',
        disable_session_recording: false,
        enable_recording_console_log: false,
        autocapture: false,
        session_recording: { maskAllInputs: false, compress_events: false },
        persistence: 'memory',
    })
    const persistence = new PostHogPersistence(config)
    persistence.clear()
    const sessionManager = new SessionIdManager(
        createMockPostHog({ config, persistence, register: vi.fn() }),
        sessionIdGenerator,
        vi.fn(() => 'windowId')
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
        register_for_session() {},
        _internalEventEmitter: emitter,
        on: vi.fn().mockImplementation((event, cb) => emitter.on(event, cb)),
    } as Partial<PostHog> as PostHog

    let live: LiveRecorder | undefined
    const emitEvent = (event: eventWithTime): boolean => {
        if (!live?.active) {
            return false
        }
        live.emit(event)
        return true
    }
    // real rrweb takes Meta and FullSnapshot synchronously inside record() and delivers
    // addCustomEvent through the same emit, throwing once stopped
    const record: any = vi.fn(({ emit }) => {
        const handle: LiveRecorder = { emit, active: true }
        live = handle
        emit(metaEvent())
        emit(fullSnapshotEvent())
        return () => {
            handle.active = false
        }
    })
    record.takeFullSnapshot = vi.fn(() => emitEvent(fullSnapshotEvent()))
    record.addCustomEvent = vi.fn((tag: string, payload: unknown) => {
        if (!live?.active) {
            throw new Error('please add custom event after start recording')
        }
        live.emit(customEvent(tag, payload))
    })

    assignableWindow.__PosthogExtensions__ = {
        rrweb: {
            record,
            version: 'fake',
            wasMaxDepthReached: vi.fn(() => false),
            resetMaxDepthState: vi.fn(),
            getLastSnapshotCost: vi.fn(() => null),
            getMutationCost: vi.fn(() => ({ slowestBatchMs: 0 })),
            getDeferredStylesheetStats: vi.fn(() => ({
                deferredCount: 0,
                failedCount: 0,
                abandonedCount: 0,
                totalMs: 0,
                slowestSliceMs: 0,
            })),
            getDiscardedDurationSamples: vi.fn(() => 0),
            resetSnapshotCostState: vi.fn(),
        },
        rrwebPlugins: { getRecordConsolePlugin: vi.fn() },
        loadExternalDependency: vi.fn((_ph, _path, callback) => callback()),
        initSessionRecording: (ph, documentWasEverVisible) =>
            new LazyLoadedSessionRecording(ph, documentWasEverVisible),
    } as any

    persistence.register({
        [SESSION_RECORDING_ENABLED_SERVER_SIDE]: true,
        [CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE]: false,
        [SESSION_RECORDING_IS_SAMPLED]: undefined,
    })

    const sessionRecording = new SessionRecording(posthog)
    sessionRecording.onRemoteConfig({
        ok: true,
        config: { sessionRecording: { endpoint: '/s/' } } as unknown as RemoteConfig,
    } as RemoteConfigResult)
    const lazy = sessionRecording['_lazyLoadedSessionRecording'] as any

    return { mint, sessionManager, sessionRecording, lazy, capture, record, emitEvent }
}

type Harness = ReturnType<typeof createHarness>

function runAction(h: Harness, action: Action): boolean {
    switch (action.kind) {
        case 'advance':
            vi.advanceTimersByTime(action.ms)
            return false
        case 'interactive':
            return h.emitEvent(incrementalEvent({ source: action.source }))
        case 'mutation':
            h.emitEvent(incrementalEvent({ source: 0, adds: [], attributes: [], removes: [], texts: [] }))
            return false
        case 'fullSnapshot':
            h.emitEvent(fullSnapshotEvent())
            return false
        case 'checkSession':
            h.sessionManager.checkAndGetSessionAndWindowId(false, Date.now())
            return false
        case 'resetSession':
            h.sessionManager.resetSessionId()
            h.sessionManager.checkAndGetSessionAndWindowId(false, Date.now())
            return false
        case 'forcedIdleReset': {
            const idleSessionId = h.sessionManager['_sessionId']
            h.sessionManager.resetSessionId()
            h.sessionManager['_eventEmitter'].emit('forcedIdleReset', { idleSessionId })
            return false
        }
        case 'customEvent':
            h.sessionRecording.onRRwebEmit(customEvent('custom', {}))
            return false
        case 'flush':
            vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT)
            return false
    }
}

function shippedBySession(h: Harness): Map<string, eventWithTime[]> {
    const bySession = new Map<string, eventWithTime[]>()
    const add = (sessionId: string, events: eventWithTime[]) => {
        if (events.length === 0) {
            return
        }
        bySession.set(sessionId, [...(bySession.get(sessionId) ?? []), ...events])
    }
    h.capture.mock.calls
        .filter(([name]) => name === '$snapshot')
        .forEach(([, props]) => add(props.$session_id, props.$snapshot_data))
    add(h.lazy._buffer.sessionId, h.lazy._buffer.data)
    return bySession
}

function checkInvariants(
    h: Harness,
    state: { rotated: boolean; lastInteractionAt: number; rotations: number }
): string[] {
    const violations: string[] = []
    for (const [sessionId, events] of shippedBySession(h)) {
        const minted = h.mint.get(sessionId)
        if (isUndefined(minted)) {
            violations.push(`events attributed to unminted session ${sessionId}`)
            continue
        }
        const floor = minted - MINT_TOLERANCE_MS
        events.forEach((event: any, i) => {
            if (!(event.timestamp >= floor)) {
                violations.push(
                    `(1) ${sessionId} event #${i} type ${event.type} tag ${event.data?.tag} timestamp ${event.timestamp} < mint ${minted}`
                )
            }
            if (event.type === EventType.Custom && event.data?.tag === 'sessionIdle') {
                const payload = event.data.payload ?? {}
                if (payload.sessionId !== sessionId) {
                    violations.push(`(2) sessionIdle pinned to ${payload.sessionId} shipped under ${sessionId}`)
                }
                if (!(payload.lastActivityTimestamp >= floor)) {
                    violations.push(
                        `(2) sessionIdle under ${sessionId} carries lastActivityTimestamp ${payload.lastActivityTimestamp} < mint ${minted}`
                    )
                }
            }
        })
        const nonCustomTypes = events.filter((e) => e.type !== EventType.Custom).map((e) => e.type)
        if (nonCustomTypes.length > 0 && nonCustomTypes[0] !== META_EVENT_TYPE) {
            violations.push(`(3) ${sessionId} opens with type ${nonCustomTypes[0]} not Meta`)
        }
        if (nonCustomTypes.length > 1 && nonCustomTypes[1] !== FULL_SNAPSHOT_EVENT_TYPE) {
            violations.push(`(3) ${sessionId} second non-custom event is type ${nonCustomTypes[1]} not FullSnapshot`)
        }
    }
    if (
        state.rotated &&
        Date.now() - state.lastInteractionAt < RECORDING_IDLE_THRESHOLD_MS &&
        h.lazy._isIdle === true
    ) {
        violations.push(`(4) idle right after rotation into ${h.lazy._sessionId} with a recent interaction`)
    }
    if (h.record.mock.calls.length !== 1 + state.rotations) {
        violations.push(`(5) record called ${h.record.mock.calls.length} times for ${state.rotations} rotations`)
    }
    return violations
}

function recordCoverage(h: Harness, rotations: number): void {
    const bySession = shippedBySession(h)
    coverage.rotations += rotations
    coverage.shippedSessions += bySession.size
    coverage.snapshotCaptures += h.capture.mock.calls.filter(([name]) => name === '$snapshot').length
    for (const events of bySession.values()) {
        coverage.idleMarkers += events.filter((e: any) => e.data?.tag === 'sessionIdle').length
    }
}

function replay(actions: Action[], track = false): Failure | null {
    const h = createHarness()
    const state = { rotated: false, lastInteractionAt: Date.now(), rotations: 0 }
    try {
        let sessionId = h.lazy._sessionId
        for (let i = 0; i < actions.length; i++) {
            const interacted = runAction(h, actions[i])
            if (interacted) {
                state.lastInteractionAt = Date.now()
            }
            state.rotated = h.lazy._sessionId !== sessionId
            if (state.rotated) {
                state.rotations++
                sessionId = h.lazy._sessionId
            }
            const violations = checkInvariants(h, state)
            if (violations.length > 0) {
                return { index: i, message: violations.join('\n') }
            }
        }
        return null
    } finally {
        if (track) {
            recordCoverage(h, state.rotations)
        }
        h.sessionRecording.stopRecording()
        vi.useRealTimers()
        vi.clearAllMocks()
    }
}

// greedy one-minimal shrink: drop any action whose removal keeps the sequence failing
function minimize(actions: Action[]): Action[] {
    let current = actions
    for (let i = current.length - 1; i >= 0; i--) {
        const candidate = current.filter((_, j) => j !== i)
        const failure = replay(candidate)
        if (failure) {
            current = candidate.slice(0, failure.index + 1)
            i = Math.min(i, current.length)
        }
    }
    return current
}

describe('lazy session recording rotation invariants', () => {
    // guards against the sequences passing vacuously
    afterAll(() => {
        expect(coverage.rotations).toBeGreaterThan(SEEDS.length)
        expect(coverage.shippedSessions).toBeGreaterThan(SEEDS.length)
        expect(coverage.idleMarkers).toBeGreaterThan(0)
        expect(coverage.snapshotCaptures).toBeGreaterThan(SEEDS.length)
    })

    it.each(SEEDS)('holds under a random action sequence for seed %i', (seed) => {
        const actions = generateActions(seed)
        const failure = replay(actions, true)
        if (!failure) {
            return
        }
        const minimal = minimize(actions.slice(0, failure.index + 1))
        const minimalFailure = replay(minimal)
        throw new Error(
            [
                `seed ${seed} violated invariants at action ${failure.index}:`,
                failure.message,
                `minimal failing sequence (${minimal.length} actions):`,
                formatActions(minimal),
                `minimal failure: ${minimalFailure?.message ?? 'did not reproduce'}`,
            ].join('\n')
        )
    })
})
