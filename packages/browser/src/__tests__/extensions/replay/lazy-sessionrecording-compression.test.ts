/* eslint-disable @typescript-eslint/no-require-imports */
import { gzipSync, strToU8 } from 'fflate'

type SetupOptions = {
    gzipSupported: boolean
    gzipCompress?: jest.Mock
}

const createFullSnapshot = (data: Record<string, unknown> = {}) => ({
    type: 2,
    data,
    timestamp: 123,
})

const createIncrementalSnapshot = (timestamp: number) => ({
    type: 3,
    data: { source: 0, adds: [], attributes: [], removes: [], texts: [] },
    timestamp,
})

const createCustomSnapshot = () => ({
    type: 5,
    data: {
        tag: 'custom',
        payload: { queued: true },
    },
    timestamp: 124,
})

async function setupLazyLoadedSessionRecording({ gzipSupported, gzipCompress }: SetupOptions) {
    jest.resetModules()

    const gzipCompressMock =
        gzipCompress ??
        jest.fn(async (input: string) => {
            return new Blob([gzipSync(strToU8(input))])
        })

    jest.doMock('@posthog/core', () => {
        const actual = jest.requireActual('@posthog/core')
        return {
            ...actual,
            gzipCompress: gzipCompressMock,
            isGzipSupported: () => gzipSupported,
        }
    })

    const context: Record<string, any> = {}

    jest.isolateModules(() => {
        const {
            LazyLoadedSessionRecording,
        } = require('../../../extensions/replay/external/lazy-loaded-session-recorder')
        const { assignableWindow } = require('../../../utils/globals')
        const { PostHogPersistence } = require('../../../posthog-persistence')
        const { SessionIdManager } = require('../../../sessionid')
        const { RequestRouter } = require('../../../utils/request-router')
        const { SimpleEventEmitter } = require('../../../utils/simple-event-emitter')
        const { createMockConfig, createMockPostHog } = require('../../helpers/posthog-instance')
        const { SESSION_RECORDING_REMOTE_CONFIG, SESSION_RECORDING_IS_SAMPLED } = require('../../../constants')

        const config = createMockConfig({
            api_host: 'https://test.com',
            disable_session_recording: false,
            enable_recording_console_log: false,
            autocapture: false,
            capture_pageview: false,
            session_recording: {
                maskAllInputs: false,
                compress_events: true,
            },
            persistence: 'memory',
        })

        const persistence = new PostHogPersistence(config)
        persistence.clear()
        persistence.register({
            [SESSION_RECORDING_REMOTE_CONFIG]: { endpoint: '/s/', enabled: true, sampleRate: 1 },
            [SESSION_RECORDING_IS_SAMPLED]: 'sessionId',
        })

        const sessionManager = new SessionIdManager(
            createMockPostHog({ config, persistence, register: jest.fn() }),
            jest.fn(() => 'sessionId'),
            jest.fn(() => 'windowId')
        )

        const simpleEventEmitter = new SimpleEventEmitter()
        const posthog = {
            get_property: (propertyKey: string) => persistence.props[propertyKey],
            config,
            capture: jest.fn(),
            persistence,
            sessionManager,
            requestRouter: new RequestRouter({ config } as any),
            consent: { isOptedOut: () => false },
            register_for_session: jest.fn(),
            _internalEventEmitter: simpleEventEmitter,
            on: jest.fn((event, cb) => simpleEventEmitter.on(event, cb)),
        }

        let emit: (event: any) => void = () => {}
        const stopRrweb = jest.fn()
        assignableWindow.__PosthogExtensions__ = {
            rrweb: {
                record: jest.fn(({ emit: rrwebEmit }) => {
                    emit = rrwebEmit
                    return stopRrweb
                }),
                version: 'fake',
                wasMaxDepthReached: jest.fn(() => false),
                resetMaxDepthState: jest.fn(),
            },
            rrwebPlugins: {
                getRecordConsolePlugin: undefined,
                getRecordNetworkPlugin: undefined,
            },
        }
        assignableWindow.__PosthogExtensions__.rrweb.record.takeFullSnapshot = jest.fn()
        assignableWindow.__PosthogExtensions__.rrweb.record.addCustomEvent = jest.fn()

        const lazyLoadedSessionRecording = new LazyLoadedSessionRecording(posthog)
        lazyLoadedSessionRecording.start()

        context.emit = emit
        context.posthog = posthog
        context.lazyLoadedSessionRecording = lazyLoadedSessionRecording
        context.stopRrweb = stopRrweb
    })

    return {
        gzipCompress: gzipCompressMock,
        emit: context.emit as (event: any) => void,
        posthog: context.posthog,
        lazyLoadedSessionRecording: context.lazyLoadedSessionRecording,
        stopRrweb: context.stopRrweb as jest.Mock,
    }
}

describe('LazyLoadedSessionRecording compression paths', () => {
    afterEach(() => {
        jest.dontMock('@posthog/core')
        jest.resetModules()
    })

    it.each([
        {
            name: 'async native gzip',
            gzipSupported: true,
            content: 'async snapshot',
            shouldCallGzipCompress: true,
            shouldQueueCustomEvent: true,
        },
        {
            name: 'synchronous fflate fallback',
            gzipSupported: false,
            content: 'sync snapshot',
            shouldCallGzipCompress: false,
            shouldQueueCustomEvent: false,
        },
    ])('compresses full snapshots with $name', async (testCase) => {
        let releaseCompression: () => void = () => {}
        const compressionGate = new Promise<void>((resolve) => {
            releaseCompression = resolve
        })
        const gzipCompress = jest.fn(async (input: string) => {
            await compressionGate
            return new Blob([gzipSync(strToU8(input))])
        })

        const { emit, posthog, lazyLoadedSessionRecording } = await setupLazyLoadedSessionRecording({
            gzipSupported: testCase.gzipSupported,
            gzipCompress,
        })

        emit(createFullSnapshot({ content: testCase.content }))
        if (testCase.shouldQueueCustomEvent) {
            emit(createCustomSnapshot())
            expect(posthog.capture).not.toHaveBeenCalled()
        }

        if (testCase.shouldCallGzipCompress) {
            expect(gzipCompress).toHaveBeenCalledWith(
                JSON.stringify({ content: testCase.content }),
                expect.any(Boolean),
                {
                    rethrow: true,
                }
            )
            releaseCompression()
            await lazyLoadedSessionRecording['_compressionQueue']
        } else {
            expect(gzipCompress).not.toHaveBeenCalled()
        }

        lazyLoadedSessionRecording['_flushBuffer']()

        const expectedSnapshotData = [expect.objectContaining({ type: 2, cv: '2024-10', data: expect.any(String) })]
        if (testCase.shouldQueueCustomEvent) {
            expectedSnapshotData.push(createCustomSnapshot() as any)
        }

        expect(posthog.capture).toHaveBeenCalledWith(
            '$snapshot',
            expect.objectContaining({
                $snapshot_data: expectedSnapshotData,
            }),
            expect.any(Object)
        )
    })

    it('flushes in-flight async compression before stop teardown', async () => {
        let releaseCompression: () => void = () => {}
        const compressionGate = new Promise<void>((resolve) => {
            releaseCompression = resolve
        })
        const gzipCompress = jest.fn(async (input: string) => {
            await compressionGate
            return new Blob([gzipSync(strToU8(input))])
        })

        const { emit, posthog, lazyLoadedSessionRecording, stopRrweb } = await setupLazyLoadedSessionRecording({
            gzipSupported: true,
            gzipCompress,
        })

        emit(createFullSnapshot({ content: 'stop waits for compression' }))
        lazyLoadedSessionRecording.stop()

        expect(stopRrweb).toHaveBeenCalled()
        expect(posthog.capture).not.toHaveBeenCalled()

        releaseCompression()
        await lazyLoadedSessionRecording['_compressionQueue']
        await Promise.resolve()

        expect(posthog.capture).toHaveBeenCalledWith(
            '$snapshot',
            expect.objectContaining({
                $snapshot_data: [expect.objectContaining({ type: 2, cv: '2024-10', data: expect.any(String) })],
            }),
            expect.any(Object)
        )
    })

    it('synchronously drains pending async compression on beforeunload', async () => {
        let releaseCompression: () => void = () => {}
        const compressionGate = new Promise<void>((resolve) => {
            releaseCompression = resolve
        })
        const gzipCompress = jest.fn(async (input: string) => {
            await compressionGate
            return new Blob([gzipSync(strToU8(input))])
        })

        const { emit, posthog, lazyLoadedSessionRecording } = await setupLazyLoadedSessionRecording({
            gzipSupported: true,
            gzipCompress,
        })

        emit(createFullSnapshot({ content: 'beforeunload sync drain' }))
        lazyLoadedSessionRecording['_onBeforeUnload']()

        expect(posthog.capture).toHaveBeenCalledWith(
            '$snapshot',
            expect.objectContaining({
                $snapshot_data: [expect.objectContaining({ type: 2, cv: '2024-10', data: expect.any(String) })],
            }),
            expect.any(Object)
        )

        releaseCompression()
        await lazyLoadedSessionRecording['_compressionQueue']
        expect(posthog.capture).toHaveBeenCalledTimes(1)
    })

    it('ships a full snapshot under the new session id when the recorder restarts while idle', async () => {
        const { emit, posthog, lazyLoadedSessionRecording } = await setupLazyLoadedSessionRecording({
            gzipSupported: true,
        })

        // an idle rotation adopts the new session id before any user interaction clears the idle state
        lazyLoadedSessionRecording['_isIdle'] = 'unknown'
        lazyLoadedSessionRecording['_sessionId'] = 'rotated-session-id'

        emit(createFullSnapshot({ content: 'post-rotation snapshot' }))
        await lazyLoadedSessionRecording['_compressionQueue']
        lazyLoadedSessionRecording['_flushBuffer']()

        // the full snapshot must be attributed to the rotated session, not the buffer's stale one
        expect(posthog.capture).toHaveBeenCalledWith(
            '$snapshot',
            expect.objectContaining({
                $session_id: 'rotated-session-id',
                $snapshot_data: expect.arrayContaining([expect.objectContaining({ type: 2 })]),
            }),
            expect.any(Object)
        )
    })

    it('discards the prior session buffer instead of relabeling it when the flush is suppressed at rotation', async () => {
        const { emit, posthog, lazyLoadedSessionRecording } = await setupLazyLoadedSessionRecording({
            gzipSupported: true,
        })

        // an old-session incremental sits in the buffer when a suppressed flush (e.g. buffering) meets a rotation
        emit(createIncrementalSnapshot(50))
        await lazyLoadedSessionRecording['_compressionQueue']
        const strategy = lazyLoadedSessionRecording['_strategy']
        const originalGetStatus = strategy.getStatus.bind(strategy)
        strategy.getStatus = () => 'buffering'

        lazyLoadedSessionRecording['_isIdle'] = 'unknown'
        lazyLoadedSessionRecording['_sessionId'] = 'rotated-session-id'
        emit(createFullSnapshot({ content: 'post-rotation snapshot' }))
        await lazyLoadedSessionRecording['_compressionQueue']

        strategy.getStatus = originalGetStatus
        lazyLoadedSessionRecording['_flushBuffer']()

        // only the new session's full snapshot ships; the undrained old-session event is discarded, not relabeled
        expect(posthog.capture).toHaveBeenCalledTimes(1)
        expect(posthog.capture).toHaveBeenCalledWith(
            '$snapshot',
            expect.objectContaining({
                $session_id: 'rotated-session-id',
                $snapshot_data: [expect.objectContaining({ type: 2 })],
            }),
            expect.any(Object)
        )
    })

    it('requests a full snapshot when an incremental ships for a rotated session without one', async () => {
        const { emit, lazyLoadedSessionRecording } = await setupLazyLoadedSessionRecording({
            gzipSupported: true,
        })
        const { assignableWindow } = require('../../../utils/globals')
        const takeFullSnapshot = assignableWindow.__PosthogExtensions__.rrweb.record.takeFullSnapshot

        // the initial session ships its full snapshot as usual
        emit(createFullSnapshot({ content: 'initial' }))
        await lazyLoadedSessionRecording['_compressionQueue']
        expect(takeFullSnapshot).not.toHaveBeenCalled()

        // an idle rotation adopts the new session id whose full snapshot never ships (the rotation bug), so the next incremental must trigger a healing snapshot
        lazyLoadedSessionRecording['_isIdle'] = 'unknown'
        lazyLoadedSessionRecording['_sessionId'] = 'rotated-session-id'
        emit(createIncrementalSnapshot(100))
        await lazyLoadedSessionRecording['_compressionQueue']
        expect(takeFullSnapshot).toHaveBeenCalledTimes(1)

        // only healed once per session id, even if the requested snapshot has not landed yet
        emit(createIncrementalSnapshot(200))
        await lazyLoadedSessionRecording['_compressionQueue']
        expect(takeFullSnapshot).toHaveBeenCalledTimes(1)

        // once the healed full snapshot ships, incrementals stop triggering healing
        emit(createFullSnapshot({ content: 'healed' }))
        emit(createIncrementalSnapshot(300))
        await lazyLoadedSessionRecording['_compressionQueue']
        expect(takeFullSnapshot).toHaveBeenCalledTimes(1)
    })
})
