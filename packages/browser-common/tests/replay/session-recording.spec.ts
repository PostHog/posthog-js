// @vitest-environment jsdom
/* oxlint-disable compat/compat */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionRecording } from '../../src/replay/session-recording'
import type { ReplayHost, ReplayOptions } from '../../src/replay/host'
import type { LazyLoadedSessionRecordingInterface } from '../../src/replay/recorder'
import { ExtensionRuntime } from '../../src/extension-runtime'
import { createDisposable } from '../../src/disposable'
import { TestClient } from '../helpers/test-client'
import { SESSION_RECORDING_OVERRIDE_SAMPLING, SESSION_RECORDING_REMOTE_CONFIG } from '../../src/replay/constants'

const options: ReplayOptions = {
    recording: {},
    disabled: false,
    apiHost: 'https://example.test',
    capturePageview: true,
    stripUrlHash: false,
    maskPersonalData: false,
}

function fixture() {
    const recorder: LazyLoadedSessionRecordingInterface = {
        isStarted: false,
        sessionId: 'session',
        status: 'active',
        sdkDebugProperties: {},
        start: vi.fn(() => {
            recorder.isStarted = true
        }),
        stop: vi.fn(() => {
            recorder.isStarted = false
        }),
        discard: vi.fn(),
        onRRwebEmit: vi.fn(),
        log: vi.fn(),
        overrideLinkedFlag: vi.fn(),
        overrideSampling: vi.fn(),
        overrideTrigger: vi.fn(),
        tryAddCustomEvent: vi.fn(() => true),
        setDocumentWasEverVisible: vi.fn(),
    }
    const host: ReplayHost = {
        sessionActive: true,
        isAllowed: true,
        onSessionChange: vi.fn(() => createDisposable(() => {})),
        registerSessionProperties: vi.fn(),
        requestConfigRefresh: vi.fn(),
        loadRecorder: vi.fn((_script, callback) => callback()),
        createRecorder: vi.fn(() => recorder),
    }
    const client = Object.assign(new TestClient({ remoteConfig: { sessionRecording: { endpoint: '/replay/' } } }), {
        replay: host,
    })
    const extension = new SessionRecording(() => options)
    const runtime = new ExtensionRuntime(client.logger, client)
    return { recorder, host, client, extension, runtime }
}

const cleanups: (() => void)[] = []
afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup())
    vi.restoreAllMocks()
})
function managedFixture() {
    const result = fixture()
    cleanups.push(() => result.runtime.dispose())
    return result
}

describe('shared SessionRecording lifecycle with a neutral Client', () => {
    it('observes setup immediately but preserves the deferred startup phase and synchronous config replay', () => {
        const { client, runtime, extension, host, recorder } = managedFixture()
        const initialize = vi.spyOn(client.kv, 'initialize')
        void runtime.add(extension)
        expect(initialize).toHaveBeenCalledOnce()
        expect(host.loadRecorder).not.toHaveBeenCalled()
        extension.initialize()
        expect(host.loadRecorder).toHaveBeenCalledOnce()
        expect(recorder.start).toHaveBeenCalledOnce()
        expect(extension.started).toBe(true)
    })

    it('does not initialize a deferred extension after shutdown', () => {
        const { runtime, extension, host } = managedFixture()
        void runtime.add(extension)
        runtime.dispose()
        extension.initialize()
        expect(host.loadRecorder).not.toHaveBeenCalled()
    })

    it('does not consume pending KV or hydrate after disposal', async () => {
        const { client, runtime, extension, host } = managedFixture()
        let resolve!: () => void
        vi.spyOn(client.kv, 'initialize').mockReturnValue(
            new Promise<void>((done) => {
                resolve = done
            })
        )
        const read = vi.spyOn(client.kv, 'get')
        const write = vi.spyOn(client.kv, 'set')
        extension.overrideSampling()
        const setup = runtime.add(extension)
        extension.initialize()
        expect(read).not.toHaveBeenCalled()
        runtime.dispose()
        resolve()
        await setup
        expect(write).not.toHaveBeenCalled()
        expect(host.loadRecorder).not.toHaveBeenCalled()
    })

    it('hydrates public overrides before subscribing to immediate config', async () => {
        const { client, runtime, extension, recorder } = managedFixture()
        let resolve!: () => void
        vi.spyOn(client.kv, 'initialize').mockReturnValue(
            new Promise<void>((done) => {
                resolve = done
            })
        )
        const setup = runtime.add(extension)
        extension.initialize()
        extension.overrideSampling()
        resolve()
        await setup
        expect(client.kv.get(SESSION_RECORDING_OVERRIDE_SAMPLING)).toBe(true)
        expect(recorder.start).toHaveBeenCalledOnce()
    })

    it.each(['stop', 'consent', 'dispose'] as const)('ignores late chunk completion after %s', (action) => {
        const { runtime, extension, host } = managedFixture()
        let loaded!: () => void
        vi.mocked(host.loadRecorder).mockImplementation((_script, callback) => {
            loaded = callback
        })
        void runtime.add(extension)
        extension.initialize()
        if (action === 'stop') extension.stopRecording()
        if (action === 'consent') Object.defineProperty(host, 'isAllowed', { value: false })
        if (action === 'dispose') runtime.dispose()
        loaded()
        expect(host.createRecorder).not.toHaveBeenCalled()
    })

    it('keeps loading single-flight while receiving config and public controls', () => {
        const { client, runtime, extension, host, recorder } = managedFixture()
        let loaded!: () => void
        vi.mocked(host.loadRecorder).mockImplementation((_script, callback) => {
            loaded = callback
        })
        void runtime.add(extension)
        extension.initialize()
        extension.overrideSampling()
        client.setRemoteConfig({ sessionRecording: { endpoint: '/new/' } })
        extension.startIfEnabledOrStop()
        expect(host.loadRecorder).toHaveBeenCalledOnce()
        loaded()
        expect(recorder.start).toHaveBeenCalledOnce()
        expect(client.kv.get(SESSION_RECORDING_OVERRIDE_SAMPLING)).toBe(true)
        expect(client.kv.get<{ endpoint: string }>(SESSION_RECORDING_REMOTE_CONFIG)?.endpoint).toBe('/new/')
    })

    it('continues synchronously when stale configuration is refreshed inside the loading callback', () => {
        const { client, runtime, extension, host, recorder } = managedFixture()
        client.setRemoteConfig({})
        client.kv.set(SESSION_RECORDING_REMOTE_CONFIG, { enabled: true, cache_timestamp: 0 })
        vi.mocked(host.requestConfigRefresh).mockImplementation(() => {
            client.setRemoteConfig({ sessionRecording: { endpoint: '/fresh/' } })
        })
        void runtime.add(extension)
        extension.initialize()
        expect(host.requestConfigRefresh).toHaveBeenCalledOnce()
        expect(recorder.start).toHaveBeenCalledOnce()
        expect(extension.started).toBe(true)
    })

    it('observes visibility between setup and deferred initialization', () => {
        const { runtime, extension, host } = managedFixture()
        void runtime.add(extension)
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
        document.dispatchEvent(new Event('visibilitychange'))
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
        extension.initialize()
        expect(host.createRecorder).toHaveBeenCalledWith(true, false)
    })

    it('disposes a synchronously replaying subscription if its callback removes the extension', () => {
        const { client, runtime, extension, host } = managedFixture()
        const unsubscribe = vi.fn()
        vi.spyOn(client, 'onRemoteConfig').mockImplementation((callback) => {
            callback({ ok: true, config: { sessionRecording: {} } })
            runtime.remove(extension)
            return createDisposable(unsubscribe)
        })
        void runtime.add(extension)
        extension.initialize()
        expect(unsubscribe).toHaveBeenCalledOnce()
        expect(host.createRecorder).toHaveBeenCalledOnce()
        expect(extension.started).toBe(false)
    })
})
