/// <reference lib="dom" />

import '../../helpers/native-gzip-polyfill'

const compressionControl = vi.hoisted(() => ({
    gate: undefined as Promise<void> | undefined,
    release: undefined as (() => void) | undefined,
    pending: new Set<Promise<unknown>>(),
}))
vi.mock('@posthog/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@posthog/core')>()
    return {
        ...actual,
        gzipCompress: (...args: Parameters<typeof actual.gzipCompress>) => {
            const gate = compressionControl.gate
            const pending = (async () => {
                if (gate) await gate
                return actual.gzipCompress(...args)
            })()
            compressionControl.pending.add(pending)
            void pending.then(
                () => compressionControl.pending.delete(pending),
                () => compressionControl.pending.delete(pending)
            )
            return pending
        },
    }
})

import { waitFor } from '@testing-library/dom'
import { createPosthogInstance } from '../../helpers/posthog-instance'
import { PostHog } from '../../../posthog-core'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { assignableWindow } from '../../../utils/globals'
import { EventType, IncrementalSource } from '../../../extensions/replay/types/rrweb-types'
import { LazyLoadedSessionRecording } from '../../../extensions/replay/external/lazy-loaded-session-recorder'
import { FULL_SNAPSHOT_EVENT_TYPE, META_EVENT_TYPE } from '../../../extensions/replay/external/sessionrecording-utils'

const mouse = () => ({
    type: EventType.IncrementalSnapshot,
    data: { source: IncrementalSource.MouseInteraction },
    timestamp: Date.now(),
})
const mutation = () => ({
    type: EventType.IncrementalSnapshot,
    data: { source: IncrementalSource.Mutation, texts: ['x'.repeat(64)], attributes: [], removes: [], adds: [] },
    timestamp: Date.now(),
})

describe('real-core reset rotation', () => {
    let _emit: any
    let recordCalls = 0
    let captured: { event: string; properties: any }[] = []
    const instances = new Set<PostHog>()
    const recorders = new Set<LazyLoadedSessionRecording>()
    let previousExtensions: typeof assignableWindow.__PosthogExtensions__
    const holdCompression = () => {
        compressionControl.gate = new Promise<void>((resolve) => {
            compressionControl.release = resolve
        })
    }
    beforeEach(() => {
        previousExtensions = assignableWindow.__PosthogExtensions__
        instances.clear()
        recorders.clear()
        _emit = undefined
    })
    afterEach(async () => {
        try {
            await drain()
        } finally {
            for (const instance of instances) {
                instance.sessionRecording?.dispose({ discardBufferedEvents: true })
                instance.sessionManager?.destroy()
                await instance.shutdown()
            }
            assignableWindow.__PosthogExtensions__ = previousExtensions
            vi.restoreAllMocks()
            _emit = undefined
        }
    })

    const installFakeRRweb = (): void => {
        recordCalls = 0
        holdCompression()
        assignableWindow.__PosthogExtensions__ = {}
        assignableWindow.__PosthogExtensions__.rrwebPlugins = { getRecordConsolePlugin: vi.fn() } as any
        assignableWindow.__PosthogExtensions__.loadExternalDependency = vi.fn((_ph: any, _path: any, cb: any) => {
            assignableWindow.__PosthogExtensions__!.rrweb = {
                record: vi.fn(({ emit }: any) => {
                    recordCalls++
                    _emit = emit
                    emit({
                        type: EventType.Meta,
                        data: { href: `https://x.com/gen-${recordCalls}` },
                        timestamp: Date.now(),
                    })
                    emit({ type: EventType.FullSnapshot, data: {}, timestamp: Date.now() })
                    return () => {}
                }),
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
            } as any
            const record = assignableWindow.__PosthogExtensions__!.rrweb!.record as any
            record.takeFullSnapshot = vi.fn(() => {
                _emit({ type: EventType.FullSnapshot, data: {}, timestamp: Date.now() })
            })
            record.addCustomEvent = vi.fn((tag: string, payload: any) => {
                _emit({ type: EventType.Custom, data: { tag, payload }, timestamp: Date.now() })
            })
            assignableWindow.__PosthogExtensions__!.initSessionRecording = (ph: any, visible: any) => {
                instances.add(ph)
                const recorder = new LazyLoadedSessionRecording(ph, visible)
                recorders.add(recorder)
                return recorder
            }
            cb()
        })
    }

    const drain = async (): Promise<void> => {
        compressionControl.release?.()
        compressionControl.release = undefined
        compressionControl.gate = undefined
        for (let pass = 0; pass < 20; pass++) {
            await Promise.all([
                ...compressionControl.pending,
                ...[...recorders].map((recorder) => recorder['_compressionQueue']),
            ])
            if (
                compressionControl.pending.size === 0 &&
                [...recorders].every((recorder) => recorder['_queuedCompressionEvents'] === 0)
            )
                return
        }
        throw new Error('compression queue did not settle')
    }

    it('attributes post-rotation snapshots to the new session across a real reset() + identify()', async () => {
        captured = []
        installFakeRRweb()

        const posthog: PostHog = await createPosthogInstance(
            uuidv7(),
            {
                disable_session_recording: false,
                advanced_disable_flags: true,
                session_recording: { compress_events: true },
                before_send: (cr: any) => {
                    if (cr) {
                        captured.push({ event: cr.event, properties: cr.properties })
                    }
                    return null
                },
            },
            { sessionRecording: { endpoint: '/s/' } } as any
        )

        await waitFor(() => expect(_emit).toBeDefined())
        const firstSessionId = posthog.get_session_id()

        _emit(mouse())
        _emit(mutation())
        await drain()
        holdCompression()
        const rotatedAt = Date.now() + 1
        vi.spyOn(Date, 'now').mockReturnValue(rotatedAt)
        posthog.reset()
        posthog.identify('user-after-logout')

        _emit(mouse())
        _emit(mutation())

        await drain()
        ;(posthog.sessionRecording as any)['_lazyLoadedSessionRecording']['_flushBuffer']()
        await drain()

        const secondSessionId = posthog.get_session_id()
        expect(secondSessionId).not.toBe(firstSessionId)

        const rows = captured
            .filter((c) => c.event === '$snapshot')
            .flatMap((c) =>
                c.properties.$snapshot_data.map((e: any) => ({
                    type: e.type,
                    tag: e.data?.tag,
                    sessionId: c.properties.$session_id,
                    post: e.timestamp >= rotatedAt,
                }))
            )
        expect(rows.length).toBeGreaterThan(0)

        expect(rows.filter((r) => r.post && r.sessionId === firstSessionId)).toEqual([])
        expect(rows.filter((r) => r.tag === '$session_id_change').map((r) => r.sessionId)).toEqual([secondSessionId])
        expect(rows.some((r) => r.type === FULL_SNAPSHOT_EVENT_TYPE && r.post && r.sessionId === secondSessionId)).toBe(
            true
        )
        expect(rows.some((r) => r.type === META_EVENT_TYPE && r.post && r.sessionId === secondSessionId)).toBe(true)
        expect(recordCalls).toBe(2)
    })

    it.each([
        ['recording is running', false],
        ['a deferred stop is in flight', true],
    ])('ships the pre-reset tail under the pre-reset distinct_id when %s', async (_, stopBeforeReset) => {
        captured = []
        installFakeRRweb()

        const posthog: PostHog = await createPosthogInstance(
            uuidv7(),
            {
                disable_session_recording: false,
                advanced_disable_flags: true,
                session_recording: { compress_events: true },
                before_send: (cr: any) => {
                    if (cr) {
                        captured.push({ event: cr.event, properties: cr.properties })
                    }
                    return null
                },
            },
            { sessionRecording: { endpoint: '/s/' } } as any
        )

        await waitFor(() => expect(_emit).toBeDefined())
        const firstSessionId = posthog.get_session_id()
        const firstDistinctId = posthog.get_distinct_id()

        _emit(mouse())
        _emit(mutation())

        if (stopBeforeReset) {
            posthog.stopSessionRecording()
            expect(
                (posthog.sessionRecording as any)['_lazyLoadedSessionRecording']['_isStoppingAfterCompression']
            ).toBe(true)
        }
        posthog.reset()
        posthog.identify('user-after-logout')

        _emit(mouse())
        _emit(mutation())

        await drain()
        ;(posthog.sessionRecording as any)['_lazyLoadedSessionRecording']['_flushBuffer']()
        await drain()

        const snapshots = captured.filter((c) => c.event === '$snapshot')
        const oldSession = snapshots.filter((c) => c.properties.$session_id === firstSessionId)
        expect(oldSession.length).toBeGreaterThan(0)
        expect(oldSession.map((c) => c.properties.distinct_id)).toEqual(oldSession.map(() => firstDistinctId))
        expect(snapshots.filter((c) => c.properties.$session_id === posthog.get_session_id()).length).toBeGreaterThan(0)
        expect(
            snapshots
                .filter((c) => c.properties.$session_id === posthog.get_session_id())
                .map((c) => c.properties.distinct_id)
        ).toEqual(
            snapshots
                .filter((c) => c.properties.$session_id === posthog.get_session_id())
                .map(() => 'user-after-logout')
        )
    })

    it('uploads nothing at reset after an opt-out', async () => {
        captured = []
        installFakeRRweb()

        const posthog: PostHog = await createPosthogInstance(
            uuidv7(),
            {
                disable_session_recording: false,
                advanced_disable_flags: true,
                opt_out_capturing_persistence_type: 'localStorage',
                session_recording: { compress_events: true },
                before_send: (cr: any) => {
                    if (cr) {
                        captured.push({ event: cr.event, properties: cr.properties })
                    }
                    return null
                },
            },
            { sessionRecording: { endpoint: '/s/' } } as any
        )

        await waitFor(() => expect(_emit).toBeDefined())

        _emit(mouse())
        _emit(mutation())

        posthog.opt_out_capturing()
        const uploadsAtOptOut = captured.filter((c) => c.event === '$snapshot').length

        posthog.reset()
        posthog.identify('user-after-logout')

        await drain()

        expect(captured.filter((c) => c.event === '$snapshot').length).toBe(uploadsAtOptOut)
    })

    it('ships zero recordings across a rotation with a busy queue when there is no interaction', async () => {
        captured = []
        installFakeRRweb()

        const posthog: PostHog = await createPosthogInstance(
            uuidv7(),
            {
                disable_session_recording: false,
                advanced_disable_flags: true,
                session_recording: { compress_events: true },
                before_send: (cr: any) => {
                    if (cr) {
                        captured.push({ event: cr.event, properties: cr.properties })
                    }
                    return null
                },
            },
            { sessionRecording: { endpoint: '/s/' } } as any
        )

        await waitFor(() => expect(_emit).toBeDefined())

        _emit(mutation())
        _emit(mutation())

        posthog.reset()

        _emit(mutation())
        _emit(mutation())

        await drain()
        ;(posthog.sessionRecording as any)['_lazyLoadedSessionRecording']['_flushBuffer']()
        await drain()

        expect(captured.filter((c) => c.event === '$snapshot')).toEqual([])
    })

    it('attributes the restart snapshot to the new session when reset follows an idle wake with compression in flight', async () => {
        captured = []
        installFakeRRweb()

        const posthog: PostHog = await createPosthogInstance(
            uuidv7(),
            {
                disable_session_recording: false,
                advanced_disable_flags: true,
                session_recording: { compress_events: true },
                before_send: (cr: any) => {
                    if (cr) {
                        captured.push({ event: cr.event, properties: cr.properties })
                    }
                    return null
                },
            },
            { sessionRecording: { endpoint: '/s/' } } as any
        )

        await waitFor(() => expect(_emit).toBeDefined())
        const firstSessionId = posthog.get_session_id()

        _emit(mouse())
        _emit(mutation())
        await drain()
        holdCompression()

        // idle: a non-interactive event dated past the idle threshold, then a wake
        const idleAt = Date.now() + 6 * 60 * 1000
        _emit({ ...mutation(), timestamp: idleAt })
        _emit({ ...mouse(), timestamp: idleAt + 1000 })

        // compression in flight at the rotation instant
        _emit({ ...mutation(), timestamp: idleAt + 1100 })

        posthog.reset()
        posthog.identify('user-after-logout')

        _emit({ ...mouse(), timestamp: idleAt + 1200 })
        _emit({ ...mutation(), timestamp: idleAt + 1300 })

        await drain()
        ;(posthog.sessionRecording as any)['_lazyLoadedSessionRecording']['_flushBuffer']()
        await drain()

        const secondSessionId = posthog.get_session_id()
        expect(secondSessionId).not.toBe(firstSessionId)

        const rows = captured
            .filter((c) => c.event === '$snapshot')
            .flatMap((c) =>
                c.properties.$snapshot_data.map((e: any) => ({
                    type: e.type,
                    tag: e.data?.tag,
                    href: e.data?.href,
                    sessionId: c.properties.$session_id,
                }))
            )
        expect(rows.length).toBeGreaterThan(0)

        expect(recordCalls).toBe(2)
        // the restart pair belongs to the new session
        expect(rows.filter((r) => r.href === 'https://x.com/gen-2').map((r) => r.sessionId)).toEqual([secondSessionId])
        expect(rows.filter((r) => r.tag === '$session_id_change').map((r) => r.sessionId)).toEqual([secondSessionId])
        expect(rows.some((r) => r.type === FULL_SNAPSHOT_EVENT_TYPE && r.sessionId === secondSessionId)).toBe(true)
        // the idle machinery really engaged
        expect(rows.some((r) => r.tag === 'sessionIdle')).toBe(true)
        expect(rows.some((r) => r.tag === 'sessionNoLongerIdle')).toBe(true)
    })

    it('attributes correctly when the compression queue never empties across the rotation', async () => {
        captured = []
        installFakeRRweb()

        const posthog: PostHog = await createPosthogInstance(
            uuidv7(),
            {
                disable_session_recording: false,
                advanced_disable_flags: true,
                session_recording: { compress_events: true },
                before_send: (cr: any) => {
                    if (cr) {
                        captured.push({ event: cr.event, properties: cr.properties })
                    }
                    return null
                },
            },
            { sessionRecording: { endpoint: '/s/' } } as any
        )

        await waitFor(() => expect(_emit).toBeDefined())
        const firstSessionId = posthog.get_session_id()
        const lazyRecorder = (posthog.sessionRecording as any)['_lazyLoadedSessionRecording']

        const base = Date.now()
        const boundary = base + 60
        let queueEmptied = false
        for (let i = 0; i < 16; i++) {
            _emit({ ...mutation(), timestamp: base + i * 10 })
            if (i % 3 === 0) {
                _emit({ ...mouse(), timestamp: base + i * 10 + 1 })
            }
            if (i === 5) {
                posthog.reset()
                posthog.identify('user-after-logout')
            }
            if (i > 0 && lazyRecorder['_queuedCompressionEvents'] === 0) {
                queueEmptied = true
            }
            await Promise.resolve()
        }
        expect(queueEmptied).toBe(false)

        await drain()
        ;(posthog.sessionRecording as any)['_lazyLoadedSessionRecording']['_flushBuffer']()
        await drain()

        const secondSessionId = posthog.get_session_id()
        expect(secondSessionId).not.toBe(firstSessionId)

        const rows = captured
            .filter((c) => c.event === '$snapshot')
            .flatMap((c) =>
                c.properties.$snapshot_data.map((e: any) => ({
                    type: e.type,
                    tag: e.data?.tag,
                    href: e.data?.href,
                    timestamp: e.timestamp,
                    sessionId: c.properties.$session_id,
                }))
            )
        expect(rows.length).toBeGreaterThan(0)

        const misattributed = rows.filter(
            (r) => r.timestamp >= boundary && r.tag !== '$session_id_change' && r.sessionId === firstSessionId
        )
        expect(misattributed).toEqual([])
        expect(rows.filter((r) => r.tag === '$session_id_change').map((r) => r.sessionId)).toEqual([secondSessionId])
        expect(rows.filter((r) => r.href === 'https://x.com/gen-2').map((r) => r.sessionId)).toEqual([secondSessionId])
    })
})
