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

const createCustomSnapshot = () => ({
    type: 5,
    data: {
        tag: 'custom',
        payload: { queued: true },
    },
    timestamp: 124,
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

describe('LazyLoadedSessionRecording compression paths', () => {
    afterEach(() => {
        vi.doUnmock('@posthog/core')
        vi.resetModules()
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
        const gzipCompress = vi.fn(async (input: string) => {
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
        const gzipCompress = vi.fn(async (input: string) => {
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

    it('discards in-flight async compression without a deferred flush', async () => {
        let releaseCompression: () => void = () => {}
        const compressionGate = new Promise<void>((resolve) => {
            releaseCompression = resolve
        })
        const gzipCompress = vi.fn(async (input: string) => {
            await compressionGate
            return new Blob([gzipSync(strToU8(input))])
        })

        const { emit, posthog, lazyLoadedSessionRecording, stopRrweb } = await setupLazyLoadedSessionRecording({
            gzipSupported: true,
            gzipCompress,
        })

        emit(createFullSnapshot({ content: 'discard pending compression' }))
        const compressionQueue = lazyLoadedSessionRecording['_compressionQueue']
        lazyLoadedSessionRecording.discard({ discardProducerEvents: true })

        expect(stopRrweb).toHaveBeenCalled()
        expect(posthog.capture).not.toHaveBeenCalled()

        releaseCompression()
        await compressionQueue
        await Promise.resolve()

        expect(posthog.capture).not.toHaveBeenCalled()
    })

    it('discards events emitted synchronously while rrweb stops', async () => {
        const { emit, posthog, lazyLoadedSessionRecording, stopRrweb } = await setupLazyLoadedSessionRecording({
            gzipSupported: false,
        })
        stopRrweb.mockImplementation(() => {
            emit(createFullSnapshot({ content: 'rrweb teardown emission' }))
        })
        emit(createFullSnapshot({ content: 'existing buffered snapshot' }))
        lazyLoadedSessionRecording['_buffer'].sessionId = 'stale-session-id'
        expect(lazyLoadedSessionRecording['_buffer'].data.length).toBeGreaterThan(0)

        lazyLoadedSessionRecording.discard({ discardProducerEvents: true })

        expect(lazyLoadedSessionRecording['_buffer'].data).toEqual([])
        expect(lazyLoadedSessionRecording['_flushBufferTimer']).toBeUndefined()

        lazyLoadedSessionRecording['_flushBuffer']()
        expect(posthog.capture).not.toHaveBeenCalled()
    })

    it('synchronously drains pending async compression on beforeunload', async () => {
        let releaseCompression: () => void = () => {}
        const compressionGate = new Promise<void>((resolve) => {
            releaseCompression = resolve
        })
        const gzipCompress = vi.fn(async (input: string) => {
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

    it('drops only the event that is too large to stringify, so the rest of the queue still ships on unload', async () => {
        const gzipCompress = vi.fn(async (input: string) => {
            // hold the async path open so both events are still queued at unload
            await new Promise(() => {})
            return new Blob([gzipSync(strToU8(input))])
        })

        const { emit, posthog, lazyLoadedSessionRecording } = await setupLazyLoadedSessionRecording({
            gzipSupported: true,
            gzipCompress,
        })

        const originalStringify = JSON.stringify
        const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementation((value: any, ...rest: any[]) => {
            const serialized = originalStringify(value, ...rest)
            if (serialized && serialized.indexOf('oversized') !== -1) {
                throw new RangeError('Invalid string length')
            }
            return serialized
        })

        try {
            emit(createFullSnapshot({ content: 'oversized' }))
            emit(createIncrementalSnapshot(456))

            expect(() => lazyLoadedSessionRecording['_onBeforeUnload']()).not.toThrow()

            // the request queue merges every recording chunk into one request and the encoder
            // stringifies it whole, so whatever reached capture must survive that same stringify
            const captured = posthog.capture.mock.calls.map(([, properties]: any[]) => properties.$snapshot_data)
            expect(() => JSON.stringify(captured)).not.toThrow()
        } finally {
            stringifySpy.mockRestore()
        }

        // the oversized event is dropped, and it does not cost the event after it or the final flush
        expect(posthog.capture).toHaveBeenCalledWith(
            '$snapshot',
            expect.objectContaining({
                $snapshot_data: [expect.objectContaining({ type: 3 })],
            }),
            expect.any(Object)
        )
    })

    it('counts an event dropped for being too large to stringify on the replay debug properties', async () => {
        const gzipCompress = vi.fn(async (input: string) => {
            // hold the async path open so the event is still queued at unload
            await new Promise(() => {})
            return new Blob([gzipSync(strToU8(input))])
        })

        const { emit, lazyLoadedSessionRecording } = await setupLazyLoadedSessionRecording({
            gzipSupported: true,
            gzipCompress,
        })

        const originalStringify = JSON.stringify
        const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementation((value: any, ...rest: any[]) => {
            const serialized = originalStringify(value, ...rest)
            if (serialized && serialized.indexOf('oversized') !== -1) {
                throw new RangeError('Invalid string length')
            }
            return serialized
        })

        try {
            emit(createFullSnapshot({ content: 'oversized' }))
            lazyLoadedSessionRecording['_onBeforeUnload']()
        } finally {
            stringifySpy.mockRestore()
        }

        // the drop only writes a debug-gated console line, so without this counter the recording
        // loses data with nothing in our own data to show for it
        expect(lazyLoadedSessionRecording.sdkDebugProperties['$sdk_debug_replay_unstringifiable_events_dropped']).toBe(
            1
        )
    })

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

    it('does not retry serializing an event that is too large to stringify', async () => {
        const gzipCompress = vi.fn(async (input: string) => {
            // hold the async path open so the event is still queued at unload
            await new Promise(() => {})
            return new Blob([gzipSync(strToU8(input))])
        })

        const { emit, lazyLoadedSessionRecording } = await setupLazyLoadedSessionRecording({
            gzipSupported: true,
            gzipCompress,
        })

        // JSON.stringify only raises `Invalid string length` once it has built the string up to
        // the engine's limit, so every extra attempt is another half-gigabyte stall on unload
        let attempts = 0
        const originalStringify = JSON.stringify
        const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementation((value: any, ...rest: any[]) => {
            const serialized = originalStringify(value, ...rest)
            if (serialized && serialized.indexOf('oversized') !== -1) {
                attempts += 1
                throw new RangeError('Invalid string length')
            }
            return serialized
        })

        try {
            emit(createFullSnapshot({ content: 'oversized' }))

            // only count the synchronous drain, the one path that cannot yield to the browser
            attempts = 0
            lazyLoadedSessionRecording['_onBeforeUnload']()
        } finally {
            stringifySpy.mockRestore()
        }

        // one failed compression, then the size estimate that decides the event has to be dropped
        expect(attempts).toBe(2)
    })

    it('does not stringify an event twice when the synchronous drain compresses it', async () => {
        const gzipCompress = vi.fn(async () => {
            // hold the async path open so the event is still queued at unload
            await new Promise(() => {})
            return new Blob([])
        })

        const { emit, lazyLoadedSessionRecording } = await setupLazyLoadedSessionRecording({
            gzipSupported: true,
            gzipCompress,
        })

        emit(createFullSnapshot({ content: 'sized once' }))

        let attempts = 0
        const originalStringify = JSON.stringify
        const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementation((value: any, ...rest: any[]) => {
            const serialized = originalStringify(value, ...rest)
            if (serialized && serialized.indexOf('sized once') !== -1) {
                attempts += 1
            }
            return serialized
        })

        try {
            lazyLoadedSessionRecording['_onBeforeUnload']()
        } finally {
            stringifySpy.mockRestore()
        }

        // the compressed event carries its own size, so the raw event is never sized as well
        expect(attempts).toBe(1)
    })

    it('ships a full snapshot under the new session id when the recorder restarts while idle', async () => {
        const { emit, posthog, lazyLoadedSessionRecording } = await setupLazyLoadedSessionRecording({
            gzipSupported: true,
        })

        // an idle rotation adopts the new session id before any user interaction clears the idle state
        // (the session manager must agree, or the recorder re-syncs the stale id from it on the next event)
        posthog.sessionManager['_setSessionId']('rotated-session-id', 123, 123)
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

        posthog.sessionManager['_setSessionId']('rotated-session-id', 123, 123)
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
        const { emit, posthog, lazyLoadedSessionRecording, assignableWindow } = await setupLazyLoadedSessionRecording({
            gzipSupported: true,
        })
        const takeFullSnapshot = assignableWindow.__PosthogExtensions__.rrweb.record.takeFullSnapshot

        // the initial session ships its full snapshot as usual
        emit(createFullSnapshot({ content: 'initial' }))
        await lazyLoadedSessionRecording['_compressionQueue']
        expect(takeFullSnapshot).not.toHaveBeenCalled()

        // an idle rotation adopts the new session id whose full snapshot never ships (the rotation bug), so the next incremental must trigger a healing snapshot
        posthog.sessionManager['_setSessionId']('rotated-session-id', 123, 123)
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
