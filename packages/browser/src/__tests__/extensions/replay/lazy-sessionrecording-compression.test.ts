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
        assignableWindow.__PosthogExtensions__ = {
            rrweb: {
                record: jest.fn(({ emit: rrwebEmit }) => {
                    emit = rrwebEmit
                    return () => {}
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
    })

    return {
        gzipCompress: gzipCompressMock,
        emit: context.emit as (event: any) => void,
        posthog: context.posthog,
        lazyLoadedSessionRecording: context.lazyLoadedSessionRecording,
    }
}

describe('LazyLoadedSessionRecording compression paths', () => {
    afterEach(() => {
        jest.dontMock('@posthog/core')
        jest.resetModules()
    })

    it('uses async native gzip when supported and preserves queued event order', async () => {
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

        emit(createFullSnapshot({ content: 'async snapshot' }))
        emit(createCustomSnapshot())

        expect(gzipCompress).toHaveBeenCalledWith(JSON.stringify({ content: 'async snapshot' }), expect.any(Boolean), {
            rethrow: true,
        })
        expect(posthog.capture).not.toHaveBeenCalled()

        releaseCompression()
        await lazyLoadedSessionRecording['_compressionQueue']
        lazyLoadedSessionRecording['_flushBuffer']()

        const snapshotData = posthog.capture.mock.calls[0][1].$snapshot_data
        expect(snapshotData).toEqual([
            expect.objectContaining({ type: 2, cv: '2024-10', data: expect.any(String) }),
            createCustomSnapshot(),
        ])
    })

    it('keeps the synchronous fflate path when native gzip is unsupported', async () => {
        const { emit, posthog, lazyLoadedSessionRecording, gzipCompress } = await setupLazyLoadedSessionRecording({
            gzipSupported: false,
        })

        emit(createFullSnapshot({ content: 'sync snapshot' }))
        lazyLoadedSessionRecording['_flushBuffer']()

        expect(gzipCompress).not.toHaveBeenCalled()
        expect(posthog.capture).toHaveBeenCalledWith(
            '$snapshot',
            expect.objectContaining({
                $snapshot_data: [expect.objectContaining({ type: 2, cv: '2024-10', data: expect.any(String) })],
            }),
            expect.any(Object)
        )
    })
})
