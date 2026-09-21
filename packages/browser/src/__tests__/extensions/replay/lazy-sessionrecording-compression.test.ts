import { gzipSync, strToU8 } from 'fflate'

type SetupOptions = {
    gzipSupported: boolean
    gzipCompress?: vi.Mock
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

async function setupLazyLoadedSessionRecording({ gzipSupported, gzipCompress }: SetupOptions) {
    vi.resetModules()

    const gzipCompressMock =
        gzipCompress ??
        vi.fn(async (input: string) => {
            return new Blob([gzipSync(strToU8(input))])
        })

    vi.doMock('@posthog/core', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@posthog/core')>()
        return {
            ...actual,
            gzipCompress: gzipCompressMock,
            isGzipSupported: () => gzipSupported,
        }
    })

    const context: Record<string, any> = {}

    const [
        { LazyLoadedSessionRecording },
        { assignableWindow },
        { PostHogPersistence },
        { SessionIdManager },
        { RequestRouter },
        { SimpleEventEmitter },
        { createMockConfig, createMockPostHog },
        { SESSION_RECORDING_REMOTE_CONFIG, SESSION_RECORDING_IS_SAMPLED },
    ] = await Promise.all([
        import('../../../extensions/replay/external/lazy-loaded-session-recorder'),
        import('../../../utils/globals'),
        import('../../../posthog-persistence'),
        import('../../../sessionid'),
        import('../../../utils/request-router'),
        import('@posthog/browser-common/utils/simple-event-emitter'),
        import('../../helpers/posthog-instance'),
        import('../../../constants'),
    ])

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
        createMockPostHog({ config, persistence, register: vi.fn() }),
        vi.fn(() => 'sessionId'),
        vi.fn(() => 'windowId')
    )

    const simpleEventEmitter = new SimpleEventEmitter()
    const posthog = {
        get_property: (propertyKey: string) => persistence.props[propertyKey],
        config,
        capture: vi.fn(),
        persistence,
        sessionManager,
        requestRouter: new RequestRouter({ config } as any),
        consent: { isOptedOut: () => false },
        register_for_session: vi.fn(),
        _internalEventEmitter: simpleEventEmitter,
        on: vi.fn((event, cb) => simpleEventEmitter.on(event, cb)),
    }

    let emit: (event: any) => void = () => {}
    const stopRrweb = vi.fn()
    assignableWindow.__PosthogExtensions__ = {
        rrweb: {
            record: vi.fn(({ emit: rrwebEmit }) => {
                emit = rrwebEmit
                return stopRrweb
            }),
            version: 'fake',
            wasMaxDepthReached: vi.fn(() => false),
            resetMaxDepthState: vi.fn(),
        },
        rrwebPlugins: {
            getRecordConsolePlugin: undefined,
            getRecordNetworkPlugin: undefined,
        },
    }
    assignableWindow.__PosthogExtensions__.rrweb.record.takeFullSnapshot = vi.fn()
    assignableWindow.__PosthogExtensions__.rrweb.record.addCustomEvent = vi.fn()

    const lazyLoadedSessionRecording = new LazyLoadedSessionRecording(posthog)
    lazyLoadedSessionRecording.start()
    // these tests exercise compression, not hold semantics — drop the fresh-start interaction hold
    lazyLoadedSessionRecording['_holdFlushUntilInteraction'] = false

    context.emit = emit
    context.posthog = posthog
    context.lazyLoadedSessionRecording = lazyLoadedSessionRecording
    context.stopRrweb = stopRrweb
    context.assignableWindow = assignableWindow

    return {
        gzipCompress: gzipCompressMock,
        emit: context.emit as (event: any) => void,
        posthog: context.posthog,
        lazyLoadedSessionRecording: context.lazyLoadedSessionRecording,
        stopRrweb: context.stopRrweb as vi.Mock,
        assignableWindow: context.assignableWindow,
    }
}

describe('LazyLoadedSessionRecording compression delivery integration', () => {
    afterEach(() => {
        vi.doUnmock('@posthog/core')
        vi.resetModules()
    })

    it.each(['_onBeforeUnload', '_onPageHide'] as const)(
        'includes the drop count in the encoded surviving snapshot on %s',
        async (handler) => {
            const originalSendBeacon = Object.getOwnPropertyDescriptor(navigator, 'sendBeacon')
            const sendBeacon = vi.fn((_url: string, _body: Blob) => true)
            Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: sendBeacon })

            try {
                const { emit, posthog, lazyLoadedSessionRecording } = await setupLazyLoadedSessionRecording({
                    gzipSupported: true,
                    gzipCompress: vi.fn(() => new Promise(() => {})),
                })
                const { RequestQueue } = await import('../../../request-queue')
                const { request } = await import('../../../request')
                const queue = new RequestQueue((req, transportOverride) => {
                    request({ ...req, transport: transportOverride ?? req.transport })
                })
                posthog.capture.mockImplementation((event: string, properties: any, options: any) => {
                    queue.enqueue({
                        url: options._url,
                        method: 'POST',
                        batchKey: options._batchKey,
                        data: { event, properties },
                    })
                })

                const originalStringify = JSON.stringify
                const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementation((value: any, ...rest: any[]) => {
                    const serialized = originalStringify(value, ...rest)
                    if (serialized && serialized.includes('oversized-test-event')) {
                        throw new RangeError('Invalid string length')
                    }
                    return serialized
                })

                try {
                    emit(createFullSnapshot({ content: 'oversized-test-event' }))
                    emit(createIncrementalSnapshot(456))
                    lazyLoadedSessionRecording[handler]()
                    queue.unload()

                    expect(sendBeacon).toHaveBeenCalledTimes(1)
                    const body = sendBeacon.mock.calls[0][1]
                    const encoded = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader()
                        reader.onload = () => resolve(reader.result as string)
                        reader.onerror = reject
                        reader.readAsText(body)
                    })
                    const payload = JSON.parse(
                        Buffer.from(new URLSearchParams(encoded).get('data')!, 'base64').toString('utf8')
                    )
                    expect(payload).toEqual([
                        expect.objectContaining({
                            event: '$snapshot',
                            properties: expect.objectContaining({
                                $sdk_debug_replay_unstringifiable_events_dropped: 1,
                                $snapshot_data: [expect.objectContaining({ type: 3, timestamp: 456 })],
                            }),
                        }),
                    ])
                } finally {
                    stringifySpy.mockRestore()
                    lazyLoadedSessionRecording.discard()
                    queue.unload()
                }
            } finally {
                if (originalSendBeacon) {
                    Object.defineProperty(navigator, 'sendBeacon', originalSendBeacon)
                } else {
                    Reflect.deleteProperty(navigator, 'sendBeacon')
                }
            }
        }
    )

    it.each(['direct', 'async', 'unload'])(
        'does not report a handled stringify failure to error tracking on the %s path',
        async (path) => {
            const { emit, lazyLoadedSessionRecording, assignableWindow } = await setupLazyLoadedSessionRecording({
                gzipSupported: path !== 'direct',
                ...(path === 'unload' ? { gzipCompress: vi.fn(() => new Promise(() => {})) } : {}),
            })
            const { default: Config } = await import('../../../config')
            await import('../../../entrypoints/exception-autocapture')

            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
            const captureException = vi.fn()
            const unwrap =
                assignableWindow.__PosthogExtensions__.errorWrappingFunctions.wrapConsoleError(captureException)
            const originalStringify = JSON.stringify
            const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementation((value: any, ...rest: any[]) => {
                const serialized = originalStringify(value, ...rest)
                if (serialized && serialized.includes('oversized-test-event')) {
                    throw new RangeError('Invalid string length')
                }
                return serialized
            })

            try {
                Config.DEBUG = true
                console.error('error tracking control')
                expect(captureException).toHaveBeenCalledTimes(1)
                captureException.mockClear()
                errorSpy.mockClear()

                emit(createFullSnapshot({ content: 'oversized-test-event' }))
                if (path === 'unload') {
                    lazyLoadedSessionRecording['_onBeforeUnload']()
                } else if (path === 'async') {
                    await lazyLoadedSessionRecording['_compressionQueue']
                }

                expect(captureException).not.toHaveBeenCalled()
                expect(errorSpy).not.toHaveBeenCalled()
                expect(warnSpy).toHaveBeenCalled()
                expect(
                    lazyLoadedSessionRecording.sdkDebugProperties['$sdk_debug_replay_unstringifiable_events_dropped']
                ).toBe(1)
            } finally {
                Config.DEBUG = false
                stringifySpy.mockRestore()
                unwrap()
                errorSpy.mockRestore()
                warnSpy.mockRestore()
                logSpy.mockRestore()
                lazyLoadedSessionRecording.discard()
            }
        }
    )
})
