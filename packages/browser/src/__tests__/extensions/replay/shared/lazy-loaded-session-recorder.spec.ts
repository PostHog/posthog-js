// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LazyLoadedSessionRecording } from '../../../../extensions/replay/external/lazy-loaded-session-recorder'
import { buildNetworkRequestOptions } from '../../../../extensions/replay/external/config'
import type { ReplayOptions, ReplayRecorderClient, ReplayRecorderHost } from '@posthog/browser-common/replay/host'
import type { rrwebRecord } from '../../../../extensions/replay/rrweb'
import { replayWindow } from '../../../../extensions/replay/globals'
import { EventType, IncrementalSource } from '@posthog/browser-common/replay/rrweb-types'
import { SESSION_RECORDING_REMOTE_CONFIG } from '../../../../extensions/replay/constants'
import { createDisposable } from '@posthog/browser-common'
import { TestClient } from '../../../../../../browser-common/tests/helpers/test-client'

const options = (): ReplayOptions => ({
    recording: { compress_events: false },
    disabled: false,
    apiHost: 'https://example.test',
    capturePageview: true,
    stripUrlHash: false,
    maskPersonalData: false,
})

afterEach(() => {
    delete replayWindow!.__PosthogExtensions__
    vi.useRealTimers()
})

describe('shared lazy recorder with a neutral Client', () => {
    it('starts rrweb, delivers a playable tail with original attribution, and releases producers', () => {
        vi.useFakeTimers()
        const base = new TestClient()
        base.kv.set(SESSION_RECORDING_REMOTE_CONFIG, {
            enabled: true,
            endpoint: '/replay/',
            sampleRate: 1,
            minimumDurationMilliseconds: 0,
        })
        const stop = vi.fn()
        const record = Object.assign(
            vi.fn(() => stop),
            {
                addCustomEvent: vi.fn(),
                takeFullSnapshot: vi.fn(),
                freezePage: vi.fn(),
                mirror: { getNode: vi.fn() },
            }
        )
        replayWindow!.__PosthogExtensions__ = { rrweb: { record: record as unknown as rrwebRecord, version: 'test' } }
        const diagnosticConfig = { hostSetting: 'preserved-by-host' }
        const host: ReplayRecorderHost = {
            sessionActive: true,
            sessionTimeoutMs: 30 * 60 * 1000,
            checkSession: vi.fn(() => ({
                sessionId: 'original-session',
                windowId: 'original-tab',
                sessionStartTimestamp: Date.now(),
            })),
            onSessionChange: () => createDisposable(() => {}),
            onForcedIdle: () => createDisposable(() => {}),
            onFlags: () => createDisposable(() => {}),
            targetingUrl: 'https://example.test',
            isIngestionEndpoint: () => false,
            registerSessionProperties: vi.fn(),
            captureSnapshot: vi.fn(),
            createPendingBufferStore: () => ({
                enabled: false,
                read: () => undefined,
                write: vi.fn(),
                remove: vi.fn(),
            }),
            createFlushedSizeWriter: () => vi.fn(),
            recordFirstSnapshot: vi.fn(),
            emitConfigEvent: vi.fn((emit) => {
                emit('$posthog_config', { config: diagnosticConfig })
            }),
        }
        const client: ReplayRecorderClient = {
            kv: base.kv,
            onEvent: base.onEvent,
            library: base.library,
            logger: base.logger,
            replay: host,
        }
        const recorder = new LazyLoadedSessionRecording(client, options)
        try {
            recorder.start()
            expect(record).toHaveBeenCalledOnce()
            expect(host.emitConfigEvent).toHaveBeenCalledOnce()
            expect(record.addCustomEvent).toHaveBeenCalledWith('$posthog_config', { config: diagnosticConfig })
            const timestamp = Date.now()
            recorder.onRRwebEmit({
                type: EventType.Meta,
                timestamp,
                data: { href: 'https://example.test', width: 100, height: 100 },
            })
            recorder.onRRwebEmit({
                type: EventType.FullSnapshot,
                timestamp: timestamp + 1,
                data: { node: { type: 0, id: 1, childNodes: [] }, initialOffset: { left: 0, top: 0 } },
            })
            recorder.onRRwebEmit({
                type: EventType.IncrementalSnapshot,
                timestamp: timestamp + 2,
                data: { source: IncrementalSource.MouseMove, positions: [{ x: 1, y: 1, id: 1, timeOffset: 0 }] },
            })
            recorder.flushBeforeIdentityReset()
            expect(host.captureSnapshot).toHaveBeenCalledWith(
                '/replay/',
                expect.objectContaining({
                    $session_id: 'original-session',
                    $window_id: 'original-tab',
                    $snapshot_data: expect.arrayContaining([
                        expect.objectContaining({ type: EventType.Meta }),
                        expect.objectContaining({ type: EventType.FullSnapshot }),
                    ]),
                })
            )
            expect(host.recordFirstSnapshot).toHaveBeenCalledWith(timestamp + 1)
        } finally {
            recorder.stop()
        }
        expect(stop).toHaveBeenCalledOnce()
    })

    it('reads replaced recording options from an already installed network mask callback', () => {
        const local = options()
        const first = vi.fn((request) => request)
        local.recording = { maskCapturedNetworkRequestFn: first }
        const network = buildNetworkRequestOptions(
            () => local,
            { recordBody: true },
            () => false
        )
        const second = vi.fn((request) => ({ ...request, name: 'https://masked.test' }))
        local.recording = { maskCapturedNetworkRequestFn: second }
        const result = network.maskRequestFn?.({
            name: 'https://example.test/request',
            entryType: 'resource',
            startTime: 0,
            duration: 1,
        })
        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledOnce()
        expect(result?.name).toBe('https://masked.test')
    })
})
