import { vi } from 'vitest'
import type { ReplayHost, ReplayRecorderClient, ReplayRecorderHost } from '../../../src/replay/host'
import { createDisposable } from '../../../src/disposable'
import { SessionRecording } from '../../../src/replay/session-recording'
import { LazyLoadedSessionRecording } from '../../../src/replay/external/lazy-loaded-session-recorder'
import { SESSION_RECORDING_FLUSHED_SIZE } from '../../../src/replay/constants'
import { TestClient } from '../../helpers/test-client'
import { createReplayOptions } from './replay-options'

export function createReplayClient() {
    const base = new TestClient({
        session: {
            sessionId: 'sessionId',
            windowId: 'windowId',
            sessionStartTimestamp: Date.now(),
        },
    })
    const options = createReplayOptions()
    options.recording = { maskAllInputs: false, compress_events: false }
    options.consoleLogRecordingEnabled = false
    const recorderHost: ReplayRecorderHost = {
        sessionActive: true,
        sessionTimeoutMs: 30 * 60 * 1000,
        checkSession: () => base.session,
        onSessionChange: () => createDisposable(() => {}),
        onForcedIdle: () => createDisposable(() => {}),
        onFlags: () => createDisposable(() => {}),
        targetingUrl: 'http://localhost/',
        isIngestionEndpoint: () => false,
        registerSessionProperties: vi.fn(),
        captureSnapshot: vi.fn(),
        createPendingBufferStore: () => ({
            enabled: false,
            read: () => undefined,
            write: vi.fn(),
            remove: vi.fn(),
        }),
        createFlushedSizeWriter: () => (value) => base.kv.set(SESSION_RECORDING_FLUSHED_SIZE, value),
        recordFirstSnapshot: vi.fn(),
        emitConfigEvent: vi.fn(),
    }
    const recorderClient: ReplayRecorderClient = {
        kv: base.kv,
        onEvent: base.onEvent,
        library: base.library,
        logger: base.logger,
        replay: recorderHost,
    }
    const host: ReplayHost = {
        sessionActive: true,
        isAllowed: true,
        onSessionChange: recorderHost.onSessionChange,
        registerSessionProperties: recorderHost.registerSessionProperties,
        requestConfigRefresh: vi.fn(),
        loadRecorder: vi.fn((_script, callback) => callback()),
        createRecorder: (visible) => new LazyLoadedSessionRecording(recorderClient, () => options, visible),
    }
    const client = Object.assign(base, { replay: host })
    const controller = new SessionRecording(() => options)
    controller.setup(client)
    return { client, host, recorderHost, recorderClient, options, controller }
}
