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
            apiHost: 'https://test.com',
            disableSessionRecording: false,
            enableRecordingConsoleLog: false,
            autocapture: false,
            capturePageview: false,
            sessionRecording: {
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
            getProperty: (propertyKey: string) => persistence.props[propertyKey],
            config,
            capture: jest.fn(),
            persistence,
            sessionManager,
            requestRouter: new RequestRouter({ config } as any),
            consent: { isOptedOut: () => false },
            registerForSession: jest.fn(),
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
})
