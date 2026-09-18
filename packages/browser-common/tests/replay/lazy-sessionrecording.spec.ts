// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}

import type { SessionRecordingOptions } from '@posthog/types'
import { isUndefined } from '@posthog/core'
import Mock = vi.Mock
import {
    SESSION_RECORDING_REMOTE_CONFIG,
    CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION,
    SDK_DEBUG_REPLAY_PENDING_TRIGGER_CONDITIONS,
    RECORDING_REMOTE_CONFIG_TTL_MS,
    RECORDING_BUFFER_TIMEOUT,
    RECORDING_MAX_EVENT_SIZE,
} from '../../src/replay/constants'
import { createDisposable } from '../../src/disposable'
import { SessionRecording } from '../../src/replay/session-recording'
import { LazyLoadedSessionRecording } from '../../src/replay/external/lazy-loaded-session-recorder'
import {
    FULL_SNAPSHOT_EVENT_TYPE,
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    META_EVENT_TYPE,
} from '../../src/replay/external/sessionrecording-utils'
import {
    EventType,
    type customEvent,
    type metaEvent,
    type fullSnapshotEvent,
    type incrementalSnapshotEvent,
    type incrementalData,
    type eventWithTime,
} from '../../src/replay/rrweb-types'
import type { RemoteConfigResult } from '../../src/types/remote-config'
import type { RemoteConfig } from '../../src/replay/types'
import { createReplayClient } from './helpers/replay-client'

const originalLocation = window.location
const assignableWindow = window as Window & {
    POSTHOG_DEBUG?: boolean
    __PosthogExtensions__: { rrweb?: any; rrwebPlugins?: any }
}
const createMetaSnapshot = (event = {}): metaEvent =>
    ({
        type: META_EVENT_TYPE,
        data: {
            href: 'https://has-to-be-present-or-invalid.com',
        },
        ...event,
    }) as metaEvent

const createCustomSnapshot = (event = {}, payload = {}, tag: string = 'custom'): customEvent => ({
    type: EventType.Custom,
    data: {
        tag: tag,
        payload: {
            ...payload,
        },
    },
    ...event,
})

const createFullSnapshot = (event = {}): fullSnapshotEvent =>
    ({
        type: FULL_SNAPSHOT_EVENT_TYPE,
        data: {},
        ...event,
    }) as fullSnapshotEvent
const createIncrementalSnapshot = (event = {}): incrementalSnapshotEvent => ({
    type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    data: { source: 1 } as incrementalData,
    ...event,
})
function makeFlagsResponse(config: Partial<RemoteConfig>): RemoteConfigResult {
    return { ok: true, config: config as RemoteConfig }
}

describe('Lazy SessionRecording', () => {
    let fixture: ReturnType<typeof createReplayClient>
    let sessionRecording: SessionRecording
    let sessionId: string
    let options: ReturnType<typeof createReplayClient>['options']
    let loadScriptMock: ReturnType<typeof vi.fn>
    let _addCustomEvent: ReturnType<typeof vi.fn>
    let _emit: any

    function releaseInteractionHold(): void {
        sessionRecording['_lazyLoadedSessionRecording']['_holdFlushUntilInteraction'] = false
    }
    let onFeatureFlagsCallback: ((variants: Record<string, string | boolean>) => void) | null

    const fakeNavigateTo = (url: string) => {
        delete (window as any).location
        // @ts-expect-error this is a test, it's safe to write to location like this
        window.location = { href: url } as Location
        Object.defineProperty(fixture.recorderHost, 'targetingUrl', {
            configurable: true,
            value: url,
        })
    }
    const addRRwebToWindow = () => {
        assignableWindow.__PosthogExtensions__.rrweb = {
            record: Object.assign(
                vi.fn(({ emit }) => {
                    _emit = emit
                    return () => {}
                }),
                {
                    takeFullSnapshot: vi.fn(() => _emit(createFullSnapshot())),
                    addCustomEvent: _addCustomEvent,
                    mirror: {
                        getId: (node) => (!node || !document.contains(node) ? -1 : node.nodeName === 'LINK' ? -2 : 1),
                        getNode: () => null,
                    },
                }
            ),
            version: 'fake',
            wasMaxDepthReached: vi.fn(() => false),
            resetMaxDepthState: vi.fn(),
        }
        assignableWindow.__PosthogExtensions__.rrwebPlugins = {
            getRecordConsolePlugin: vi.fn(),
        }
    }

    beforeEach(() => {
        fixture = createReplayClient()
        _addCustomEvent = vi.fn()
        sessionRecording = fixture.controller
        sessionId = fixture.client.session.sessionId
        options = fixture.options
        onFeatureFlagsCallback = null
        vi.spyOn(fixture.recorderHost, 'onFlags').mockImplementation((callback) => {
            onFeatureFlagsCallback = callback
            return createDisposable(() => {
                onFeatureFlagsCallback = null
            })
        })
        assignableWindow.__PosthogExtensions__ = {}
        loadScriptMock = vi.fn((_script, callback) => {
            addRRwebToWindow()
            callback()
        })
        fixture.host.loadRecorder = loadScriptMock
    })

    afterEach(() => {
        sessionRecording.dispose({ discardBufferedEvents: true })
        fixture.client.dispose()
        delete (window as any).__PosthogExtensions__
        delete assignableWindow.POSTHOG_DEBUG
        // @ts-expect-error this is a test, it's safe to write to location like this
        window.location = originalLocation
    })

    describe('masking', () => {
        it('passes remote masking options to rrweb', () => {
            options.recording.maskAllInputs = undefined

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        masking: { maskAllInputs: true, maskTextSelector: '*' },
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    maskAllInputs: true,
                    maskTextSelector: '*',
                })
            )
        })

        it('passes remote maskAllElementAttributes to rrweb', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        masking: { maskAllElementAttributes: true },
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    maskAllElementAttributes: true,
                })
            )
        })

        it('passes client-side maskAttributeFn to rrweb', () => {
            const maskAttributeFn = (_name: string, value: string) => value
            options.recording.maskAttributeFn = maskAttributeFn

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    maskAllElementAttributes: false,
                    maskAttributeFn,
                })
            )
        })

        describe('attribute masking options are mutually exclusive', () => {
            let logSpy: vi.SpyInstance
            let warnSpy: vi.SpyInstance

            beforeEach(() => {
                // the logger only emits to the console when debug mode is enabled
                assignableWindow.POSTHOG_DEBUG = true
                logSpy = vi.spyOn(window!.console, 'log').mockImplementation(() => {})
                warnSpy = vi.spyOn(window!.console, 'warn').mockImplementation(() => {})
            })

            afterEach(() => {
                logSpy.mockRestore()
                warnSpy.mockRestore()
                assignableWindow.POSTHOG_DEBUG = undefined
            })

            // the logger prepends a prefix arg, so the human-readable message is the second call arg
            const exclusivityWarnings = () =>
                warnSpy.mock.calls.filter(
                    (call) => typeof call[1] === 'string' && call[1].includes('mutually exclusive')
                )

            it('drops maskAttributeFn and warns when maskAllElementAttributes is also set', () => {
                options.recording.maskAllElementAttributes = true
                options.recording.maskAttributeFn = (_name: string, value: string) => value

                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )

                sessionRecording['_onScriptLoaded']()

                expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                    expect.objectContaining({
                        maskAllElementAttributes: true,
                        maskAttributeFn: undefined,
                    })
                )
                expect(exclusivityWarnings()).toHaveLength(1)
            })

            it('drops maskAttributeFn and warns when the project setting enables maskAllElementAttributes', () => {
                options.recording.maskAttributeFn = (_name: string, value: string) => value

                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                            masking: { maskAllElementAttributes: true },
                        },
                    })
                )

                sessionRecording['_onScriptLoaded']()

                expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                    expect.objectContaining({
                        maskAllElementAttributes: true,
                        maskAttributeFn: undefined,
                    })
                )
                expect(exclusivityWarnings()).toHaveLength(1)
            })

            it('does not warn when only one option is set', () => {
                options.recording.maskAllElementAttributes = true

                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )

                sessionRecording['_onScriptLoaded']()

                expect(exclusivityWarnings()).toHaveLength(0)
            })
        })

        describe('warns when client-side masking shadows the project setting', () => {
            let logSpy: vi.SpyInstance
            let warnSpy: vi.SpyInstance

            beforeEach(() => {
                // the logger only emits to the console when debug mode is enabled
                assignableWindow.POSTHOG_DEBUG = true
                logSpy = vi.spyOn(window!.console, 'log').mockImplementation(() => {})
                warnSpy = vi.spyOn(window!.console, 'warn').mockImplementation(() => {})
            })

            afterEach(() => {
                logSpy.mockRestore()
                warnSpy.mockRestore()
                assignableWindow.POSTHOG_DEBUG = undefined
            })

            function startWithConfigs(
                serverMasking: Partial<SessionRecordingOptions> | undefined,
                clientMasking: Partial<SessionRecordingOptions>
            ) {
                options.recording.maskAllInputs = clientMasking.maskAllInputs
                options.recording.maskTextSelector = clientMasking.maskTextSelector
                options.recording.blockSelector = clientMasking.blockSelector

                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                            masking: serverMasking,
                        },
                    })
                )
                sessionRecording['_onScriptLoaded']()
            }

            // the logger prepends a prefix arg, so the human-readable message is the second call arg
            const maskingWarnings = () =>
                warnSpy.mock.calls.filter((call) => typeof call[1] === 'string' && call[1].includes('take precedence'))

            it('warns when client masking diverges from the project masking', () => {
                startWithConfigs({ maskAllInputs: false, maskTextSelector: undefined }, { maskTextSelector: '*' })

                expect(maskingWarnings()).toHaveLength(1)
                expect(maskingWarnings()[0][1]).toContain('maskTextSelector')
            })

            it('only warns once even if masking is re-evaluated on restart', () => {
                startWithConfigs({ maskAllInputs: false }, { maskAllInputs: true })

                // simulate the recorder re-evaluating masking on subsequent starts
                sessionRecording['_lazyLoadedSessionRecording']!['_warnIfClientMaskingShadowsServer']()
                sessionRecording['_lazyLoadedSessionRecording']!['_warnIfClientMaskingShadowsServer']()

                expect(maskingWarnings()).toHaveLength(1)
            })

            it('does not warn when there is no project masking to shadow', () => {
                startWithConfigs(undefined, { maskTextSelector: '*' })

                expect(maskingWarnings()).toHaveLength(0)
            })

            it('does not warn when client and project masking agree', () => {
                startWithConfigs(
                    { maskAllInputs: true, maskTextSelector: '*' },
                    { maskAllInputs: true, maskTextSelector: '*' }
                )

                expect(maskingWarnings()).toHaveLength(0)
            })
        })

        describe('capturing passwords', () => {
            it.each([
                ['no masking options', {} as SessionRecordingOptions, true],
                ['empty masking options', { maskInputOptions: {} } as SessionRecordingOptions, true],
                ['password not set', { maskInputOptions: { input: true } } as SessionRecordingOptions, true],
                ['password set to true', { maskInputOptions: { password: true } } as SessionRecordingOptions, true],
                ['password set to false', { maskInputOptions: { password: false } } as SessionRecordingOptions, false],
            ])('%s', (_name: string, session_recording: SessionRecordingOptions, expected: boolean) => {
                options.recording = session_recording
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                    expect.objectContaining({
                        maskInputOptions: expect.objectContaining({ password: expected }),
                    })
                )
            })
        })
    })

    describe('sampling passthrough', () => {
        it('passes user sampling for mousemove and mouseInteraction to rrweb.record', () => {
            options.recording.sampling = {
                mousemove: false,
                mouseInteraction: false,
            }

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    sampling: { mousemove: false, mouseInteraction: false },
                })
            )
        })

        it('passes a falsy numeric mousemove value of 0 to rrweb.record', () => {
            options.recording.sampling = { mousemove: 0 }

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    sampling: { mousemove: 0 },
                })
            )
        })

        it('passes a numeric mousemove throttle to rrweb.record', () => {
            options.recording.sampling = { mousemove: 250 }

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    sampling: { mousemove: 250 },
                })
            )
        })

        it('merges user sampling with canvas sampling', () => {
            options.recording.sampling = { mousemove: false }

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        canvasQuality: '0.2',
                        canvasFps: 6,
                        recordCanvas: true,
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    recordCanvas: true,
                    sampling: { mousemove: false, canvas: 6 },
                })
            )
        })

        it('ignores sampling keys that are not allowlisted', () => {
            options.recording.sampling = {
                canvas: 1,
                scroll: 100,
                mousemove: false,
            } as any

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    sampling: { mousemove: false },
                })
            )
        })

        it('does not set sampling when not configured', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    sampling: undefined,
                })
            )
        })
    })

    describe('console logs', () => {
        it('if not enabled, plugin is not used', () => {
            options.consoleLogRecordingEnabled = false

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(assignableWindow.__PosthogExtensions__.rrwebPlugins.getRecordConsolePlugin).not.toHaveBeenCalled()
        })

        it('if enabled, plugin is used', () => {
            options.consoleLogRecordingEnabled = true

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(assignableWindow.__PosthogExtensions__.rrwebPlugins.getRecordConsolePlugin).toHaveBeenCalled()
        })
    })

    describe('linked flags', () => {
        it('uses the active snapshot interval immediately after a linked flag matches', () => {
            vi.useFakeTimers()
            try {
                options.recording!.full_snapshot_interval_millis = 30_000
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: { endpoint: '/s/', linkedFlag: 'the-flag-key' },
                    })
                )

                const takeFullSnapshot = vi.spyOn(
                    sessionRecording['_lazyLoadedSessionRecording'] as any,
                    '_tryTakeFullSnapshot'
                )

                onFeatureFlagsCallback?.({ 'the-flag-key': 'literally-anything' })
                expect(sessionRecording.status).toBe('active')

                vi.advanceTimersByTime(30_000)
                expect(takeFullSnapshot).toHaveBeenCalledTimes(1)
            } finally {
                vi.useRealTimers()
            }
        })

        it('does not postpone the full snapshot when the linked flag stays truthy across reloads', () => {
            vi.useFakeTimers()
            try {
                options.recording!.full_snapshot_interval_millis = 30_000
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: { endpoint: '/s/', linkedFlag: 'the-flag-key' },
                    })
                )

                const takeFullSnapshot = vi.spyOn(
                    sessionRecording['_lazyLoadedSessionRecording'] as any,
                    '_tryTakeFullSnapshot'
                )

                onFeatureFlagsCallback?.({ 'the-flag-key': true })
                expect(sessionRecording.status).toBe('active')

                // flags reload repeatedly while the linked flag stays truthy; this must not
                // restart the interval and starve the periodic full snapshot
                vi.advanceTimersByTime(20_000)
                onFeatureFlagsCallback?.({ 'the-flag-key': true })
                vi.advanceTimersByTime(20_000)
                onFeatureFlagsCallback?.({ 'the-flag-key': true })

                // 40s of wall-clock have elapsed with a 30s interval, so the snapshot must have fired
                expect(takeFullSnapshot).toHaveBeenCalledTimes(1)
            } finally {
                vi.useRealTimers()
            }
        })

        it('stores the linked flag on flags response', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', linkedFlag: 'the-flag-key' },
                })
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlag).toEqual(
                'the-flag-key'
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')

            expect(onFeatureFlagsCallback).not.toBeNull()

            onFeatureFlagsCallback?.({ 'the-flag-key': true })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(true)
            expect(sessionRecording.status).toEqual('active')

            onFeatureFlagsCallback?.({ different: true, keys: true })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')
        })

        it('does not react to flags that are present but false', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', linkedFlag: 'the-flag-key' },
                })
            )

            expect(sessionRecording.status).toEqual('buffering')

            expect(onFeatureFlagsCallback).not.toBeNull()

            onFeatureFlagsCallback?.({ 'the-flag-key': false })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')
        })

        it('can handle linked flags with variants', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        linkedFlag: { flag: 'the-flag-key', variant: 'test-a' },
                    },
                })
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlag).toEqual({
                flag: 'the-flag-key',
                variant: 'test-a',
            })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')

            expect(onFeatureFlagsCallback).not.toBeNull()

            onFeatureFlagsCallback?.({ 'the-flag-key': 'test-a' })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(true)
            expect(sessionRecording.status).toEqual('active')

            onFeatureFlagsCallback?.({ 'the-flag-key': 'control' })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')
        })

        it('can handle linked flags with any variants', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    // when the variant is any we only send the key
                    sessionRecording: { endpoint: '/s/', linkedFlag: 'the-flag-key' },
                })
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlag).toEqual(
                'the-flag-key'
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')

            expect(onFeatureFlagsCallback).not.toBeNull()

            onFeatureFlagsCallback?.({ 'the-flag-key': 'literally-anything' })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(true)
            expect(sessionRecording.status).toEqual('active')

            onFeatureFlagsCallback?.({ 'not-the-flag-key': 'literally-anything' })
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')
        })

        it('can be overriden', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', linkedFlag: 'the-flag-key' },
                })
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlag).toEqual(
                'the-flag-key'
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')

            sessionRecording.overrideLinkedFlag()

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(true)
            expect(sessionRecording.status).toEqual('active')
        })

        /**
         * this is partly a regression test, with a running rrweb,
         * if you don't pause while buffering
         * the browser can be trapped in an infinite loop of pausing
         * while trying to report it is paused 🙈
         */
        it('can be paused while waiting for flag', () => {
            fakeNavigateTo('https://test.com/blocked')

            expect(sessionRecording.status).toEqual('disabled')

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        linkedFlag: 'the-flag-key',
                        urlBlocklist: [
                            {
                                matching: 'regex',
                                url: '/blocked',
                            },
                        ],
                    },
                })
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlag).toEqual(
                'the-flag-key'
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('buffering')
            expect(sessionRecording['paused']).toBeUndefined()

            const snapshotEvent = {
                event: 123,
                type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
                data: {
                    source: 1,
                },
                timestamp: new Date().getTime(),
            }
            _emit(snapshotEvent)

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlag).toEqual(
                'the-flag-key'
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(false)
            expect(sessionRecording.status).toEqual('paused')

            sessionRecording.overrideLinkedFlag()

            expect(sessionRecording['_lazyLoadedSessionRecording']['_linkedFlagMatching'].linkedFlagSeen).toEqual(true)
            expect(sessionRecording.status).toEqual('paused')

            fakeNavigateTo('https://test.com/allowed')

            expect(sessionRecording.status).toEqual('paused')

            _emit(snapshotEvent)
            expect(sessionRecording.status).toEqual('active')
        })
    })

    describe('when rrweb is not available', () => {
        beforeEach(() => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_queuedRRWebEvents']).toEqual([])

            // fake rrweb being unavailable
            assignableWindow.__PosthogExtensions__.rrweb.record = null
        })

        it('queues events', () => {
            sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent']('test', { test: 'test' })

            expect(sessionRecording['_lazyLoadedSessionRecording']['_queuedRRWebEvents']).toHaveLength(1)
        })

        it('limits the queue of events', () => {
            sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent']('test', { test: 'test' })

            expect(sessionRecording['_lazyLoadedSessionRecording']['_queuedRRWebEvents']).toHaveLength(1)

            for (let i = 0; i < 100; i++) {
                sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent']('test', { test: 'test' })
            }

            expect(sessionRecording['_lazyLoadedSessionRecording']['_queuedRRWebEvents']).toHaveLength(10)
        })

        it('processes the queue when rrweb is available again', () => {
            addRRwebToWindow()

            sessionRecording['_lazyLoadedSessionRecording'].onRRwebEmit(
                createIncrementalSnapshot({ data: { source: 1 } }) as any
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_queuedRRWebEvents']).toHaveLength(0)
        })
    })

    describe('when rrweb record() returns undefined', () => {
        it('does not report recording as started', () => {
            loadScriptMock.mockImplementation((_script: any, callback: any) => {
                assignableWindow.__PosthogExtensions__.rrweb = {
                    record: vi.fn(() => undefined),
                    version: 'fake',
                    wasMaxDepthReached: vi.fn(() => false),
                    resetMaxDepthState: vi.fn(),
                }
                assignableWindow.__PosthogExtensions__.rrweb.record.takeFullSnapshot = vi.fn()
                assignableWindow.__PosthogExtensions__.rrweb.record.addCustomEvent = vi.fn()
                fixture.host.createRecorder = () => {
                    return new LazyLoadedSessionRecording(fixture.recorderClient, () => options)
                }
                callback()
            })

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(sessionRecording.started).toEqual(false)
            expect(sessionRecording.status).toEqual('rrweb_error')
        })

        it('recovers when rrweb starts successfully on retry', () => {
            let recordCallCount = 0
            loadScriptMock.mockImplementation((_script: any, callback: any) => {
                assignableWindow.__PosthogExtensions__.rrweb = {
                    record: vi.fn(({ emit }) => {
                        recordCallCount++
                        if (recordCallCount === 1) {
                            return undefined
                        }
                        _emit = emit
                        return () => {}
                    }),
                    version: 'fake',
                    wasMaxDepthReached: vi.fn(() => false),
                    resetMaxDepthState: vi.fn(),
                }
                assignableWindow.__PosthogExtensions__.rrweb.record.takeFullSnapshot = vi.fn(() => {
                    _emit(createFullSnapshot())
                })
                assignableWindow.__PosthogExtensions__.rrweb.record.addCustomEvent = vi.fn()
                fixture.host.createRecorder = () => {
                    return new LazyLoadedSessionRecording(fixture.recorderClient, () => options)
                }
                callback()
            })

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(sessionRecording.started).toEqual(false)
            expect(sessionRecording.status).toEqual('rrweb_error')

            // simulate session rotation triggering a restart
            sessionRecording['_lazyLoadedSessionRecording']!.start()

            expect(sessionRecording.started).toEqual(true)
            expect(sessionRecording.status).not.toEqual('rrweb_error')
        })
    })

    describe('rrweb attach debug signals', () => {
        it('reports neither attached nor start attempted before the recorder runs', () => {
            // No onRemoteConfig call yet: _startRecorder has never been entered.
            const lazy = sessionRecording['_lazyLoadedSessionRecording']
            expect(lazy).toBeUndefined()
            // Once the lazy recorder exists but start has not run, both should be false.
            // We simulate that by constructing it directly without driving the script load.
            const standalone = new LazyLoadedSessionRecording(fixture.recorderClient, () => options)
            expect(standalone.sdkDebugProperties.$sdk_debug_rrweb_attached).toBe(false)
            expect(standalone.sdkDebugProperties.$sdk_debug_rrweb_start_attempted).toBe(false)
        })

        it('reports attached: true and start_attempted: true after a successful start', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            const debug = sessionRecording['_lazyLoadedSessionRecording'].sdkDebugProperties
            expect(debug.$sdk_debug_rrweb_attached).toBe(true)
            expect(debug.$sdk_debug_rrweb_start_attempted).toBe(true)
        })

        it('reports start_attempted: true but attached: false when rrweb.record returns undefined', () => {
            loadScriptMock.mockImplementation((_script: any, callback: any) => {
                assignableWindow.__PosthogExtensions__.rrweb = {
                    record: vi.fn(() => undefined),
                    version: 'fake',
                    wasMaxDepthReached: vi.fn(() => false),
                    resetMaxDepthState: vi.fn(),
                }
                assignableWindow.__PosthogExtensions__.rrweb.record.takeFullSnapshot = vi.fn()
                assignableWindow.__PosthogExtensions__.rrweb.record.addCustomEvent = vi.fn()
                fixture.host.createRecorder = () => {
                    return new LazyLoadedSessionRecording(fixture.recorderClient, () => options)
                }
                callback()
            })

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            const debug = sessionRecording['_lazyLoadedSessionRecording'].sdkDebugProperties
            expect(debug.$sdk_debug_rrweb_start_attempted).toBe(true)
            expect(debug.$sdk_debug_rrweb_attached).toBe(false)
        })
    })

    describe('canvas', () => {
        it('passes the remote config to rrweb', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        canvasQuality: '0.2',
                        canvasFps: 6,
                        recordCanvas: true,
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()
            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    recordCanvas: true,
                    sampling: { canvas: 6 },
                    dataURLOptions: {
                        type: 'image/webp',
                        quality: 0.2,
                    },
                    canvasResolutionScale: 1,
                })
            )
        })

        it.each([
            ['unset', undefined, 1],
            ['a fraction', { resolutionScale: 0.6 }, 0.6],
            ['clamped up to 1', { resolutionScale: 2 }, 1],
            ['clamped to the floor', { resolutionScale: 0.01 }, 0.1],
            ['zero clamped to the floor', { resolutionScale: 0 }, 0.1],
            ['negative clamped to the floor', { resolutionScale: -1 }, 0.1],
            ['NaN ignored (full res)', { resolutionScale: NaN }, 1],
            ['ignored when not a number', { resolutionScale: 'big' as any }, 1],
        ])('passes canvasResolutionScale when canvasCapture is %s', (_label, canvasCapture, expected) => {
            options.recording.canvasCapture = canvasCapture
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        canvasQuality: '0.2',
                        canvasFps: 6,
                        recordCanvas: true,
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({ canvasResolutionScale: expected })
            )
        })

        it('passes a regions provider that reads the live config', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        canvasQuality: '0.2',
                        canvasFps: 6,
                        recordCanvas: true,
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()

            const mockParams = assignableWindow.__PosthogExtensions__.rrweb.record.mock.calls[0][0]
            const canvas = {} as HTMLCanvasElement

            // no provider configured, so the canvas records unmasked
            expect(mockParams.canvasMasking.regionsFn(canvas)).toBeUndefined()

            const regions = [{ x: 1, y: 2, width: 3, height: 4 }]
            const regionsFn = vi.fn(() => regions)
            options.recording.canvasCapture = { maskRegionsFn: regionsFn }
            expect(mockParams.canvasMasking.regionsFn(canvas)).toBe(regions)
            expect(regionsFn).toHaveBeenCalledWith(canvas)
        })

        it('marks canvasMasking configured when maskRegionsFn is set at record start', () => {
            options.recording.canvasCapture = { maskRegionsFn: vi.fn(() => []) }
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        canvasQuality: '0.2',
                        canvasFps: 6,
                        recordCanvas: true,
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()

            const mockParams = assignableWindow.__PosthogExtensions__.rrweb.record.mock.calls[0][0]
            expect(mockParams.canvasMasking.configured()).toBe(true)
        })

        it('does not mark canvasMasking configured when only recordCanvas is on', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        canvasQuality: '0.2',
                        canvasFps: 6,
                        recordCanvas: true,
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()

            const mockParams = assignableWindow.__PosthogExtensions__.rrweb.record.mock.calls[0][0]
            expect(mockParams.canvasMasking.configured()).toBe(false)
        })

        it('reads canvasMasking configured from the live config', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        canvasQuality: '0.2',
                        canvasFps: 6,
                        recordCanvas: true,
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()

            const mockParams = assignableWindow.__PosthogExtensions__.rrweb.record.mock.calls[0][0]
            expect(mockParams.canvasMasking.configured()).toBe(false)

            options.recording.canvasCapture = { maskRegionsFn: vi.fn(() => []) }
            expect(mockParams.canvasMasking.configured()).toBe(true)
        })

        it.each([
            ['null', null],
            ['undefined', undefined],
        ])('reports null when a configured provider returns %s', (_name, returned) => {
            options.recording.canvasCapture = {
                maskRegionsFn: vi.fn(() => returned),
            }
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        canvasQuality: '0.2',
                        canvasFps: 6,
                        recordCanvas: true,
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()

            const mockParams = assignableWindow.__PosthogExtensions__.rrweb.record.mock.calls[0][0]
            expect(mockParams.canvasMasking.regionsFn({} as HTMLCanvasElement)).toBe(null)
        })

        it('reports null and warns once when a configured provider throws', () => {
            assignableWindow.POSTHOG_DEBUG = true
            const logSpy = vi.spyOn(window!.console, 'log').mockImplementation(() => {})
            const warnSpy = vi.spyOn(window!.console, 'warn').mockImplementation(() => {})
            const regionsFn = vi.fn(() => {
                throw new Error('boom')
            })
            options.recording.canvasCapture = { maskRegionsFn: regionsFn }
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        canvasQuality: '0.2',
                        canvasFps: 6,
                        recordCanvas: true,
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()

            const mockParams = assignableWindow.__PosthogExtensions__.rrweb.record.mock.calls[0][0]
            expect(mockParams.canvasMasking.regionsFn({} as HTMLCanvasElement)).toBe(null)
            expect(mockParams.canvasMasking.regionsFn({} as HTMLCanvasElement)).toBe(null)

            expect(regionsFn).toHaveBeenCalledTimes(2)
            expect(
                warnSpy.mock.calls.filter(
                    (call) => typeof call[1] === 'string' && call[1].includes('maskRegionsFn threw')
                )
            ).toHaveLength(1)

            logSpy.mockRestore()
            warnSpy.mockRestore()
            assignableWindow.POSTHOG_DEBUG = undefined
        })

        it('skips when any config variable is missing', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        recordCanvas: null,
                        canvasFps: null,
                        canvasQuality: null,
                    },
                })
            )

            sessionRecording['_onScriptLoaded']()

            const mockParams = assignableWindow.__PosthogExtensions__.rrweb.record.mock.calls[0][0]
            expect(mockParams).not.toHaveProperty('recordCanvas')
            expect(mockParams).not.toHaveProperty('canvasFps')
            expect(mockParams).not.toHaveProperty('canvasQuality')
        })
    })
    describe('URL blocking', () => {
        it('does not capture JSON-LD read on the initial blocked URL after navigation', async () => {
            const script = document.createElement('script')
            script.type = 'application/ld+json'
            script.textContent = JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'Blocked page product',
            })
            document.body.appendChild(script)
            options.recording.captureJsonLd = true
            fakeNavigateTo('https://test.com/blocked')

            try {
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                            urlBlocklist: [{ matching: 'regex', url: '/blocked' }],
                        },
                    })
                )

                fakeNavigateTo('https://test.com/allowed')
                _emit(createMetaSnapshot())
                await Promise.resolve()
                expect(_addCustomEvent).not.toHaveBeenCalledWith(
                    '$json_ld',
                    expect.objectContaining({ name: 'Blocked page product' })
                )

                script.textContent = JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    name: 'Allowed page product',
                })
                await Promise.resolve()
                expect(_addCustomEvent).toHaveBeenCalledWith('$json_ld', {
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    name: 'Allowed page product',
                })
            } finally {
                script.remove()
            }
        })

        it('does not flush buffer and includes pause event when hitting blocked URL', async () => {
            options.recording.captureJsonLd = true
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        urlBlocklist: [
                            {
                                matching: 'regex',
                                url: '/blocked',
                            },
                        ],
                    },
                })
            )
            // Emit some events before hitting blocked URL
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            // Simulate URL change to blocked URL
            fakeNavigateTo('https://test.com/blocked')

            expect(fixture.recorderHost.captureSnapshot).not.toHaveBeenCalled()

            // Verify subsequent events are not captured while on blocked URL
            _emit(createIncrementalSnapshot({ data: { source: 3 } }))
            _emit(createIncrementalSnapshot({ data: { source: 4 } }))

            const blockedJsonLd = document.createElement('script')
            blockedJsonLd.type = 'application/ld+json'
            blockedJsonLd.textContent = JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'Blocked page product',
            })
            document.body.appendChild(blockedJsonLd)
            await Promise.resolve()
            expect(_addCustomEvent).not.toHaveBeenCalledWith(
                '$json_ld',
                expect.objectContaining({ name: 'Blocked page product' })
            )

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toEqual([
                {
                    data: {
                        source: 1,
                    },
                    type: 3,
                },
                {
                    data: {
                        source: 2,
                    },
                    type: 3,
                },
            ])

            // Simulate URL change to allowed URL
            fakeNavigateTo('https://test.com/allowed')
            blockedJsonLd.textContent = JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'Product changed before resume',
            })

            // Verify recording resumes with resume event
            _emit(createIncrementalSnapshot({ data: { source: 5 } }))
            await Promise.resolve()
            expect(_addCustomEvent).not.toHaveBeenCalledWith(
                '$json_ld',
                expect.objectContaining({ name: 'Product changed before resume' })
            )

            blockedJsonLd.textContent = JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'Allowed page product',
            })
            await Promise.resolve()
            expect(_addCustomEvent).toHaveBeenCalledWith('$json_ld', {
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'Allowed page product',
            })
            blockedJsonLd.remove()

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toStrictEqual([
                {
                    data: {
                        source: 1,
                    },
                    type: 3,
                },
                {
                    data: {
                        source: 2,
                    },
                    type: 3,
                },
                // restarts with a snapshot
                expect.objectContaining({
                    type: 2,
                }),
                expect.objectContaining({
                    type: 3,
                    data: { source: 5 },
                }),
            ])
        })

        it('only pauses once when sampling determines session should not record', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        sampleRate: '0.00',
                        urlBlocklist: [
                            {
                                matching: 'regex',
                                url: '/blocked',
                            },
                        ],
                    },
                })
            )
            vi.spyOn(sessionRecording['_lazyLoadedSessionRecording'], '_tryAddCustomEvent')
            expect(sessionRecording.status).toBe('disabled')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_urlTriggerMatching']['urlBlocked']).toBe(false)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(0)

            fakeNavigateTo('https://test.com/blocked')
            // check is trigger by rrweb emit, not the navigation per se, so...
            _emit(createFullSnapshot({ data: { source: 1 } }))

            expect(fixture.recorderHost.captureSnapshot).not.toHaveBeenCalled()
            expect(sessionRecording.status).toBe('paused')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_urlTriggerMatching']['urlBlocked']).toBe(true)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(0)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent']).toHaveBeenCalledWith(
                'recording paused',
                {
                    reason: 'url blocker',
                }
            )
            ;(sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent'] as any).mockClear()

            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            // regression: to check we've not accidentally got stuck in a pausing loop
            expect(sessionRecording['_lazyLoadedSessionRecording']['_tryAddCustomEvent']).not.toHaveBeenCalledWith(
                'recording paused',
                {
                    reason: 'url blocker',
                }
            )
        })
    })

    describe('Event triggering', () => {
        it('uses the active snapshot interval immediately after a trigger matches', () => {
            vi.useFakeTimers()
            try {
                options.recording!.full_snapshot_interval_millis = 30_000
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                            eventTriggers: ['$exception'],
                        },
                    })
                )

                const takeFullSnapshot = vi.spyOn(
                    sessionRecording['_lazyLoadedSessionRecording'] as any,
                    '_tryTakeFullSnapshot'
                )

                fixture.client.publishEvent('$exception')
                expect(sessionRecording.status).toBe('active')

                vi.advanceTimersByTime(30_000)
                expect(takeFullSnapshot).toHaveBeenCalledTimes(1)
            } finally {
                vi.useRealTimers()
            }
        })

        it('does not restart the snapshot timer when a trigger matches on a blocked URL', () => {
            vi.useFakeTimers()
            try {
                fakeNavigateTo('https://test.com/blocked')
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                            eventTriggers: ['$exception'],
                            urlBlocklist: [{ url: '/blocked', matching: 'regex' }],
                        },
                    })
                )

                _emit(createFullSnapshot())
                expect(sessionRecording.status).toBe('paused')
                expect(sessionRecording['_lazyLoadedSessionRecording']['_fullSnapshotTimer']).toBeUndefined()

                fixture.client.publishEvent('$exception')

                expect(sessionRecording.status).toBe('paused')
                expect(sessionRecording['_lazyLoadedSessionRecording']['_fullSnapshotTimer']).toBeUndefined()
            } finally {
                vi.useRealTimers()
            }
        })

        it.each([
            [undefined, 60_000],
            [120_000, 120_000],
            [1000, 1000],
            [3_600_000, 3_600_000],
            [0, 60_000],
            [-1, 60_000],
            [999, 60_000],
            [3_600_001, 60_000],
            [Number.NaN, 60_000],
            [Number.POSITIVE_INFINITY, 60_000],
        ])('uses pending trigger buffer interval %s as %s', (configuredInterval, expectedInterval) => {
            if (!isUndefined(configuredInterval)) {
                options.recording!.trigger_pending_buffer_interval_millis = configuredInterval
            }
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['$exception'],
                    },
                })
            )

            expect(sessionRecording.status).toBe('buffering')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_fullSnapshotIntervalMillis']).toBe(
                expectedInterval
            )
        })

        it('flushes buffer and starts when sees event', async () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['$exception'],
                    },
                })
            )

            expect(sessionRecording.status).toBe('buffering')

            // Emit some events before hitting blocked URL
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(2)

            fixture.client.publishEvent('not-$exception')

            expect(sessionRecording.status).toBe('buffering')

            fixture.client.publishEvent('$exception')

            expect(sessionRecording.status).toBe('active')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(0)
        })

        it('starts if sees an event but still waiting for a URL when in OR', async () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['$exception'],
                        urlTriggers: [{ url: 'start-on-me', matching: 'regex' }],
                        triggerMatchType: 'any',
                    },
                })
            )

            expect(sessionRecording.status).toBe('buffering')

            // Emit some events before hitting blocked URL
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(2)

            fixture.client.publishEvent('not-$exception')

            expect(sessionRecording.status).toBe('buffering')

            fixture.client.publishEvent('$exception')

            // even though still waiting for URL to trigger
            expect(sessionRecording.status).toBe('active')
        })

        it('does not start if sees an event but still waiting for a URL when in AND', async () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['$exception'],
                        urlTriggers: [{ url: 'start-on-me', matching: 'regex' }],
                        triggerMatchType: 'all',
                    },
                })
            )

            expect(sessionRecording.status).toBe('buffering')

            // Emit some events before hitting blocked URL
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(2)

            fixture.client.publishEvent('not-$exception')

            expect(sessionRecording.status).toBe('buffering')

            fixture.client.publishEvent('$exception')

            // because still waiting for URL to trigger
            expect(sessionRecording.status).toBe('buffering')

            // and we can name which leg is still pending so a customer can debug the buffering
            expect(sessionRecording['_lazyLoadedSessionRecording']['_describePendingTriggerConditions']()).toEqual([
                'URL condition not matched',
            ])
        })

        it('evaluates recording status once per active flush', () => {
            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

            const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']
            releaseInteractionHold()
            expect(sessionRecording.status).toBe('active')
            const getStatus = vi.spyOn(lazyRecorder['_strategy']!, 'getStatus')

            lazyRecorder['_flushBuffer']()

            expect(getStatus).toHaveBeenCalledTimes(1)
        })

        it('reports a pending condition once per change', () => {
            const previousDebug = assignableWindow.POSTHOG_DEBUG
            assignableWindow.POSTHOG_DEBUG = true
            const logSpy = vi.spyOn(window!.console, 'log').mockImplementation(() => {})
            const registerSpy = vi.spyOn(fixture.recorderHost, 'registerSessionProperties')

            try {
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                            urlTriggers: [{ url: 'start-on-me', matching: 'regex' }],
                        },
                    })
                )
                // A fresh recorder holds all flushes until interaction; this test targets trigger buffering.
                releaseInteractionHold()
                const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']

                lazyRecorder['_flushBuffer']()
                lazyRecorder['_flushBuffer']()

                expect(
                    logSpy.mock.calls
                        .filter((call) => typeof call[1] === 'string' && call[1].startsWith('buffering:'))
                        .map((call) => call[1])
                ).toEqual(['buffering: URL condition not matched'])
                expect(
                    registerSpy.mock.calls.flatMap(([properties]) =>
                        SDK_DEBUG_REPLAY_PENDING_TRIGGER_CONDITIONS in properties
                            ? [properties[SDK_DEBUG_REPLAY_PENDING_TRIGGER_CONDITIONS]]
                            : []
                    )
                ).toEqual([['URL condition not matched']])
            } finally {
                registerSpy.mockRestore()
                logSpy.mockRestore()
                assignableWindow.POSTHOG_DEBUG = previousDebug
            }
        })

        it('reports the same condition again after leaving buffering', () => {
            const previousDebug = assignableWindow.POSTHOG_DEBUG
            assignableWindow.POSTHOG_DEBUG = true
            const logSpy = vi.spyOn(window!.console, 'log').mockImplementation(() => {})
            const registerSpy = vi.spyOn(fixture.recorderHost, 'registerSessionProperties')

            try {
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                            urlTriggers: [{ url: 'start-on-me', matching: 'regex' }],
                        },
                    })
                )
                releaseInteractionHold()
                const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']

                lazyRecorder['_flushBuffer']()
                lazyRecorder.overrideTrigger('url')
                lazyRecorder['_flushBuffer']()
                fixture.client.kv.remove(SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION)
                lazyRecorder['_flushBuffer']()

                expect(
                    logSpy.mock.calls
                        .filter((call) => typeof call[1] === 'string' && call[1].startsWith('buffering:'))
                        .map((call) => call[1])
                ).toEqual(['buffering: URL condition not matched', 'buffering: URL condition not matched'])
                expect(
                    registerSpy.mock.calls.flatMap(([properties]) =>
                        SDK_DEBUG_REPLAY_PENDING_TRIGGER_CONDITIONS in properties
                            ? [properties[SDK_DEBUG_REPLAY_PENDING_TRIGGER_CONDITIONS]]
                            : []
                    )
                ).toEqual([['URL condition not matched'], [], ['URL condition not matched']])
            } finally {
                registerSpy.mockRestore()
                logSpy.mockRestore()
                assignableWindow.POSTHOG_DEBUG = previousDebug
            }
        })

        it('never sends data when sampling is false regardless of event triggers', async () => {
            // this is a regression test for https://posthoghelp.zendesk.com/agent/tickets/24373
            // where the buffered data was sent to capture when the event trigger fired
            // before the sample rate was taken into account
            // and then would immediately stop

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['$exception'],
                        sampleRate: '0.00', // i.e. never send recording
                        triggerMatchType: 'all',
                    },
                })
            )

            expect(sessionRecording.status).toBe('buffering')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(0)

            // Emit some events before hitting event trigger
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            fixture.client.publishEvent('$exception')
            expect(sessionRecording.status).toBe('disabled')
            expect(fixture.recorderHost.captureSnapshot).not.toHaveBeenCalled()
        })

        it('sends data when sampling is false and there is an event triggers in OR mode', async () => {
            // this is a regression test for https://posthoghelp.zendesk.com/agent/tickets/24373
            // where the buffered data was sent to capture when the event trigger fired
            // before the sample rate was taken into account
            // and then would immediately stop

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['$exception'],
                        sampleRate: '0.00', // i.e. never send recording
                        triggerMatchType: 'any',
                    },
                })
            )

            expect(sessionRecording.status).toBe('buffering')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toHaveLength(0)

            // Emit some events before hitting event trigger
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            fixture.client.publishEvent('$exception')
            expect(sessionRecording.status).toBe('active')
            expect(fixture.recorderHost.captureSnapshot).toHaveBeenCalled()
        })

        it('clears buffer but keeps most recent meta event when trigger pending and receiving full snapshot', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['$exception'],
                    },
                })
            )

            expect(sessionRecording.status).toBe('buffering')

            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createMetaSnapshot())
            _emit(createCustomSnapshot({}, { tag: 'test' }))
            _emit(createFullSnapshot())

            // Buffer should only data since (including) the meta event
            const bufferData = sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data
            expect(bufferData).toEqual([
                createMetaSnapshot(),
                createCustomSnapshot({}, { tag: 'test' }),
                createFullSnapshot(),
            ])
        })
    })

    describe('wait for fresh config before starting', () => {
        beforeEach(() => {
            addRRwebToWindow()
        })

        it('starts recording from fresh persisted config without waiting for remote config', () => {
            fixture.client.kv.set({
                [SESSION_RECORDING_REMOTE_CONFIG]: {
                    enabled: true,
                    endpoint: '/s/',
                    cache_timestamp: Date.now(),
                },
            })

            sessionRecording.startIfEnabledOrStop()
            expect(sessionRecording.started).toBe(true)
        })

        it('does not start recording from stale persisted config', () => {
            const CONFIG_TTL = RECORDING_REMOTE_CONFIG_TTL_MS

            fixture.client.kv.set({
                [SESSION_RECORDING_REMOTE_CONFIG]: {
                    enabled: true,
                    endpoint: '/s/',
                    cache_timestamp: Date.now() - CONFIG_TTL - 1000,
                },
            })

            sessionRecording.startIfEnabledOrStop()
            expect(sessionRecording.started).toBe(false)
        })

        it('does not request fresh config more than once when restarting with stale config', () => {
            // Tests the _hasRequestedConfigRefresh guard in the stop/restart scenario
            // When recording stops and restarts later with stale config, should only request once
            // even if startIfEnabledOrStop is called multiple times before config arrives

            const CONFIG_TTL = RECORDING_REMOTE_CONFIG_TTL_MS

            // First, start recording normally with fresh config
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(sessionRecording.started).toBe(true)

            // Stop recording (simulates stop trigger)
            sessionRecording.stopRecording()
            expect(sessionRecording.started).toBe(false)

            // Simulate time passing - config becomes stale
            fixture.client.kv.set({
                [SESSION_RECORDING_REMOTE_CONFIG]: {
                    enabled: true,
                    endpoint: '/s/',
                    cache_timestamp: Date.now() - CONFIG_TTL - 1000,
                },
            })

            // Clear any previous calls
            vi.mocked(fixture.host.requestConfigRefresh).mockClear()

            // Try to start again - config is stale, should request refresh
            sessionRecording.startIfEnabledOrStop()
            expect(vi.mocked(fixture.host.requestConfigRefresh)).toHaveBeenCalledTimes(1)

            // Try to start again before config arrives - should NOT request again
            sessionRecording.startIfEnabledOrStop()
            expect(vi.mocked(fixture.host.requestConfigRefresh)).toHaveBeenCalledTimes(1) // Still 1, not 2
        })

        it('recording starts when fresh config arrives after stop/restart with stale config', () => {
            // Tests the deferred start flow in stop/restart scenario
            // Recording stops → config becomes stale → start requested → waits for fresh config → starts

            const CONFIG_TTL = RECORDING_REMOTE_CONFIG_TTL_MS

            // First, start recording normally with fresh config
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(sessionRecording.started).toBe(true)

            // Stop recording (simulates stop trigger)
            sessionRecording.stopRecording()
            expect(sessionRecording.started).toBe(false)

            // Simulate time passing - config becomes stale
            fixture.client.kv.set({
                [SESSION_RECORDING_REMOTE_CONFIG]: {
                    enabled: true,
                    endpoint: '/s/',
                    cache_timestamp: Date.now() - CONFIG_TTL - 1000,
                },
            })

            // Try to start again with stale config - should NOT start yet
            sessionRecording.startIfEnabledOrStop()
            expect(sessionRecording.started).toBe(false)

            // Fresh config arrives
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            // Now recording should start
            expect(sessionRecording.started).toBe(true)
        })
    })

    describe('trigger activation re-entry guard', () => {
        it('prevents infinite recursion with triggerMatchType=all and both event + URL triggers', () => {
            // Regression test for infinite recursion bug where custom events emitted during
            // trigger activation would cause _activateTrigger to be called again before
            // persistence had updated, creating an infinite loop and freezing the browser.
            // This specifically tests the 'all' mode scenario where both triggers must match.

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['test_event'],
                        urlTriggers: [{ url: 'https://has-to-be-present-or-invalid.com', matching: 'regex' }],
                        triggerMatchType: 'all',
                    },
                })
            )

            expect(sessionRecording.status).toBe('buffering')

            // Emit some events first to simulate buffering
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))

            // Spy on _activateTrigger to count how many times it's called
            const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']
            const activateTriggerSpy = vi.spyOn(lazyRecorder as any, '_activateTrigger')

            // Trigger the event - with 'all' mode and both triggers configured,
            // this would cause infinite recursion without the re-entry guard
            fixture.client.publishEvent('test_event')

            // Without the fix, this would be called dozens/hundreds of times causing a freeze
            // With the fix, it should be called a reasonable number of times (1-2)
            expect(activateTriggerSpy.mock.calls.length).toBeLessThan(5)

            // With 'all' mode, both triggers need to match before going active
            // So status may still be buffering if URL hasn't matched yet
            expect(['buffering', 'active']).toContain(sessionRecording.status)
        })

        it('allows trigger activation to complete successfully with re-entry guard', () => {
            // Verify that the re-entry guard doesn't break normal trigger activation

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        eventTriggers: ['button_clicked'],
                    },
                })
            )

            expect(sessionRecording.status).toBe('buffering')

            // Add some events to buffer
            _emit(createIncrementalSnapshot({ data: { source: 1 } }))
            _emit(createIncrementalSnapshot({ data: { source: 2 } }))

            // Trigger activation
            fixture.client.publishEvent('button_clicked')

            // Verify trigger activated successfully
            expect(sessionRecording.status).toBe('active')
            expect(fixture.recorderHost.captureSnapshot).toHaveBeenCalled()
        })
    })

    describe('pagehide flush', () => {
        // the mutation rrweb's own pagehide listener emits when it synchronously
        // flushes the deferred stylesheet queue
        const deferredCssMutation = createIncrementalSnapshot({
            data: {
                source: 0,
                texts: [],
                attributes: [{ id: 42, attributes: { _cssText: '.deferred { color: red; }' } }],
                removes: [],
                adds: [],
            },
            timestamp: Date.now(),
        })

        const startWithPagehideEmittingRecorder = () => {
            loadScriptMock.mockImplementation((_script, callback) => {
                addRRwebToWindow()
                // mirror the real recorder: record() registers a pagehide listener that
                // synchronously emits the still-deferred stylesheet mutations. It must be
                // registered during record(), i.e. before the SDK's own pagehide listener.
                const recordMock = assignableWindow.__PosthogExtensions__.rrweb.record as vi.Mock
                recordMock.mockImplementation(({ emit }) => {
                    _emit = emit
                    const flushDeferredCss = () => emit(deferredCssMutation)
                    // oxlint-disable-next-line posthog-js/no-add-event-listener
                    window!.addEventListener('pagehide', flushDeferredCss)
                    return () => window!.removeEventListener('pagehide', flushDeferredCss)
                })
                // the mutation throttler resolves the mutated node through the mirror
                recordMock.mirror = { getNode: () => null }
                callback()
            })
            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
            releaseInteractionHold()
        }

        it('ships mutations the recorder emits on pagehide, after beforeunload already flushed the buffer', () => {
            startWithPagehideEmittingRecorder()
            _emit(createFullSnapshot())

            // beforeunload fires first on a real unload and empties the buffer
            window!.dispatchEvent(new Event('beforeunload'))
            expect(fixture.recorderHost.captureSnapshot).toHaveBeenCalledWith(
                '/s/',
                expect.objectContaining({ $snapshot_data: expect.arrayContaining([createFullSnapshot()]) })
            )
            ;(fixture.recorderHost.captureSnapshot as Mock).mockClear()

            // pagehide: the recorder's listener emits into the (already flushed) buffer,
            // then the SDK's later-registered listener drains and flushes again
            window!.dispatchEvent(new Event('pagehide'))

            expect(fixture.recorderHost.captureSnapshot).toHaveBeenCalledWith(
                '/s/',
                expect.objectContaining({ $snapshot_data: expect.arrayContaining([deferredCssMutation]) })
            )
        })

        it('stops flushing on pagehide once recording is stopped', () => {
            startWithPagehideEmittingRecorder()
            _emit(createFullSnapshot())

            sessionRecording.stopRecording()
            ;(fixture.recorderHost.captureSnapshot as Mock).mockClear()

            window!.dispatchEvent(new Event('pagehide'))

            expect(fixture.recorderHost.captureSnapshot).not.toHaveBeenCalledWith('/s/', expect.anything())
        })
    })

    describe('stop-time deferred stylesheet flush', () => {
        // the mutation rrweb's stop() emits when it synchronously flushes the
        // deferred stylesheet queue during its own teardown
        const deferredCssMutation = createIncrementalSnapshot({
            data: {
                source: 0,
                texts: [],
                attributes: [{ id: 42, attributes: { _cssText: '.deferred { color: red; }' } }],
                removes: [],
                adds: [],
            },
            timestamp: Date.now(),
        })

        function startWithStopEmittingRecorder(stopEvents = [deferredCssMutation]): void {
            loadScriptMock.mockImplementation((_script, callback) => {
                addRRwebToWindow()
                const recordMock = assignableWindow.__PosthogExtensions__.rrweb.record as vi.Mock
                recordMock.mockImplementation(({ emit }) => {
                    _emit = emit
                    // mirror the real recorder: stopping rrweb synchronously flushes the
                    // still-deferred stylesheet mutations through the emit path
                    return () => {
                        for (const event of stopEvents) {
                            emit(event)
                        }
                    }
                })
                // the mutation throttler resolves the mutated node through the mirror
                recordMock.mirror = { getNode: () => null }
                callback()
            })
            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
        }

        afterEach(() => {
            vi.useRealTimers()
        })

        it('ships mutations the recorder emits while stopping, not just buffers them', () => {
            startWithStopEmittingRecorder()
            releaseInteractionHold()
            _emit(createFullSnapshot())

            sessionRecording.stopRecording()

            // the deferred CSS must reach the wire in the final flush, not die in a
            // buffer that was already flushed and cleared before rrweb stopped
            expect(fixture.recorderHost.captureSnapshot).toHaveBeenCalledWith(
                '/s/',
                expect.objectContaining({ $snapshot_data: expect.arrayContaining([deferredCssMutation]) })
            )
        })

        it('drops mutations the recorder emits while discarding a held epoch', () => {
            startWithStopEmittingRecorder()
            // no interaction, so the epoch is still held - the usual state when remote config
            // arrives and turns recording off
            _emit(createFullSnapshot())
            vi.useFakeTimers()

            sessionRecording['_lazyLoadedSessionRecording'].discard()

            // discard means nothing from this epoch is billable, so the mutation rrweb emits as it
            // stops must not schedule a flush that outlives teardown's timer clear
            vi.advanceTimersByTime(RECORDING_BUFFER_TIMEOUT * 2)
            expect(fixture.recorderHost.captureSnapshot).not.toHaveBeenCalledWith('/s/', expect.anything())
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toEqual([])
        })

        it('does not upload when stop-time mutations exceed the size cap during discard', () => {
            const largeDeferredCssMutation = createIncrementalSnapshot({
                data: {
                    source: 0,
                    texts: [],
                    attributes: [
                        {
                            id: 42,
                            attributes: { _cssText: `/*${'x'.repeat(RECORDING_MAX_EVENT_SIZE * 0.6)}*/` },
                        },
                    ],
                    removes: [],
                    adds: [],
                },
                timestamp: Date.now(),
            })
            startWithStopEmittingRecorder([largeDeferredCssMutation, largeDeferredCssMutation])
            releaseInteractionHold()
            ;(fixture.recorderHost.captureSnapshot as Mock).mockClear()

            sessionRecording['_lazyLoadedSessionRecording'].discard()

            expect(fixture.recorderHost.captureSnapshot).not.toHaveBeenCalledWith('/s/', expect.anything())
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data).toEqual([])
        })
    })

    describe('after remote cofig', () => {
        beforeEach(() => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
        })

        describe('isRecordingEnabled', () => {
            it('is enabled if both the server and client config says enabled', () => {
                expect(sessionRecording['_isRecordingEnabled']).toBeTruthy()
            })

            it('is disabled if the server is disabled', () => {
                fixture.client.kv.set({
                    [SESSION_RECORDING_REMOTE_CONFIG]: {
                        enabled: false,
                    },
                })
                expect(sessionRecording['_isRecordingEnabled']).toBe(false)
            })

            it('is disabled if the client config is disabled', () => {
                options.disabled = true
                expect(sessionRecording['_isRecordingEnabled']).toBe(false)
            })
        })

        describe('remote config cache invalidation', () => {
            const CONFIG_TTL = RECORDING_REMOTE_CONFIG_TTL_MS

            it.each([
                [
                    'ignores config with stale cache_timestamp (> 1 hour old)',
                    { enabled: true, endpoint: '/s/', cache_timestamp: Date.now() - CONFIG_TTL - 1000 },
                    false,
                ],
                [
                    'uses config with fresh cache_timestamp (< 1 hour old)',
                    { enabled: true, endpoint: '/s/', cache_timestamp: Date.now() - CONFIG_TTL + 60000 },
                    true,
                ],
                [
                    'uses config with very recent cache_timestamp',
                    { enabled: true, endpoint: '/s/', cache_timestamp: Date.now() - 1000 },
                    true,
                ],
            ])('%s', (_name, persistedConfig, shouldUseConfig) => {
                // stop recording so TTL check is active
                sessionRecording.stopRecording()

                fixture.client.kv.set({
                    [SESSION_RECORDING_REMOTE_CONFIG]: persistedConfig,
                })

                const result = sessionRecording['_lazyLoadedSessionRecording']['_remoteConfig']

                if (shouldUseConfig) {
                    expect(result?.enabled).toBe(true)
                } else {
                    expect(result).toBeUndefined()
                }
                expect(fixture.client.kv.get(SESSION_RECORDING_REMOTE_CONFIG)).toEqual(persistedConfig)
            })

            it('treats legacy config without cache_timestamp as fresh', () => {
                sessionRecording.stopRecording()

                fixture.client.kv.set({
                    [SESSION_RECORDING_REMOTE_CONFIG]: { enabled: true, endpoint: '/s/' },
                })

                const result = sessionRecording['_lazyLoadedSessionRecording']['_remoteConfig']
                expect(result?.enabled).toBe(true)
            })

            it('ignores invalid persisted JSON config when checking freshness', () => {
                fixture.client.kv.set({
                    [SESSION_RECORDING_REMOTE_CONFIG]: '{not json',
                })

                expect(sessionRecording['_isRemoteConfigFresh']()).toBe(false)
                expect(fixture.client.kv.get(SESSION_RECORDING_REMOTE_CONFIG)).toBe('{not json')
            })

            it('ignores invalid persisted JSON config when reading remote config', () => {
                fixture.client.kv.set({
                    [SESSION_RECORDING_REMOTE_CONFIG]: '{not json',
                })

                const result = sessionRecording['_lazyLoadedSessionRecording']['_remoteConfig']

                expect(result).toBeUndefined()
                expect(fixture.client.kv.get(SESSION_RECORDING_REMOTE_CONFIG)).toBe('{not json')
            })

            it('trusts stale config once recording has started (long-lived SPA)', () => {
                expect(sessionRecording['_lazyLoadedSessionRecording'].isStarted).toBe(true)

                // simulate time passing and config becoming stale
                fixture.client.kv.set({
                    [SESSION_RECORDING_REMOTE_CONFIG]: {
                        enabled: true,
                        endpoint: '/s/',
                        cache_timestamp: Date.now() - CONFIG_TTL - 1000,
                    },
                })

                // should still return config because recording has started
                const config = sessionRecording['_lazyLoadedSessionRecording']['_remoteConfig']
                expect(config?.enabled).toBe(true)
            })
        })

        describe('isConsoleLogCaptureEnabled', () => {
            it.each([
                ['enabled when both enabled', true, true, true],
                ['uses client side setting when set to false', true, false, false],
                ['uses client side setting when set to true', false, true, true],
                ['disabled when both disabled', false, false, false],
                ['uses client side setting (disabled) if server side setting is not set', undefined, false, false],
                ['uses client side setting (enabled) if server side setting is not set', undefined, true, true],
                ['is disabled when nothing is set', undefined, undefined, false],
                ['uses server side setting (disabled) if client side setting is not set', undefined, false, false],
                ['uses server side setting (enabled) if client side setting is not set', undefined, true, true],
            ])(
                '%s',
                (
                    _name: string,
                    serverSide: boolean | undefined,
                    clientSide: boolean | undefined,
                    expected: boolean
                ) => {
                    fixture.client.kv.set({ [CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE]: serverSide })
                    options.consoleLogRecordingEnabled = clientSide
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_isConsoleLogCaptureEnabled']).toBe(
                        expected
                    )
                }
            )
        })

        describe('is canvas enabled', () => {
            it.each([
                ['enabled when both enabled', true, true, true],
                ['uses client side setting when set to false', true, false, false],
                ['uses client side setting when set to true', false, true, true],
                ['disabled when both disabled', false, false, false],
                ['uses client side setting (disabled) if server side setting is not set', undefined, false, false],
                ['uses client side setting (enabled) if server side setting is not set', undefined, true, true],
                ['is disabled when nothing is set', undefined, undefined, false],
                ['uses server side setting (disabled) if client side setting is not set', undefined, false, false],
                ['uses server side setting (enabled) if client side setting is not set', undefined, true, true],
            ])(
                '%s',
                (
                    _name: string,
                    serverSide: boolean | undefined,
                    clientSide: boolean | undefined,
                    expected: boolean
                ) => {
                    fixture.client.kv.set({
                        [SESSION_RECORDING_REMOTE_CONFIG]: {
                            cache_timestamp: Date.now(),
                            canvasRecording: { enabled: serverSide, fps: 4, quality: '0.1' },
                        },
                    })
                    options.recording.captureCanvas = { recordCanvas: clientSide }
                    expect(sessionRecording['_lazyLoadedSessionRecording']['_canvasRecording']).toMatchObject({
                        enabled: expected,
                        fps: 4,
                        quality: 0.1,
                    })
                }
            )

            it.each([
                ['max fps and quality', 12, '1.0', 12, 1],
                ['min fps and quality', 0, '0.0', 0, 0],
                ['mid fps and quality', 6, '0.5', 6, 0.5],
                ['null fps and quality', null, null, 4, 0.4],
                ['undefined fps and quality', undefined, undefined, 4, 0.4],
                ['string fps and quality', '12', '1.0', 4, 1],
                ['over max fps and quality', 15, '1.5', 12, 1],
            ])(
                '%s',
                (
                    _name: string,
                    fps: number | string | null | undefined,
                    quality: string | null | undefined,
                    expectedFps: number,
                    expectedQuality: number
                ) => {
                    fixture.client.kv.set({
                        [SESSION_RECORDING_REMOTE_CONFIG]: {
                            cache_timestamp: Date.now(),
                            canvasRecording: { enabled: true, fps, quality },
                        },
                    })

                    expect(sessionRecording['_lazyLoadedSessionRecording']['_canvasRecording']).toMatchObject({
                        enabled: true,
                        fps: expectedFps,
                        quality: expectedQuality,
                    })
                }
            )
        })

        describe('masking config', () => {
            it.each([
                [
                    'enabled when both enabled',
                    { maskAllInputs: true, maskTextSelector: '*' },
                    { maskAllInputs: true, maskTextSelector: '*' },
                    { maskAllInputs: true, maskTextSelector: '*' },
                ],
                [
                    'disabled when both disabled',
                    { maskAllInputs: false },
                    { maskAllInputs: false },
                    { maskAllInputs: false },
                ],
                ['is undefined when nothing is set', undefined, undefined, undefined],
                [
                    'uses client config when set if server config is not set',
                    undefined,
                    { maskAllInputs: true, maskTextSelector: '#client' },
                    { maskAllInputs: true, maskTextSelector: '#client' },
                ],
                [
                    'uses server config when set if client config is not set',
                    { maskAllInputs: false, maskTextSelector: '#server' },
                    undefined,
                    { maskAllInputs: false, maskTextSelector: '#server' },
                ],
                [
                    'overrides server config with client config if both are set',
                    { maskAllInputs: false, maskTextSelector: '#server' },
                    { maskAllInputs: true, maskTextSelector: '#client' },
                    { maskAllInputs: true, maskTextSelector: '#client' },
                ],
                [
                    'partially overrides server config with client config if both are set',
                    { maskAllInputs: true, maskTextSelector: '*' },
                    { maskAllInputs: false },
                    { maskAllInputs: false, maskTextSelector: '*' },
                ],
                [
                    'mask inputs default is correct if client sets text selector',
                    undefined,
                    { maskTextSelector: '*' },
                    { maskAllInputs: true, maskTextSelector: '*' },
                ],
                [
                    'can set blockSelector to img',
                    undefined,
                    { blockSelector: 'img' },
                    { maskAllInputs: true, maskTextSelector: undefined, blockSelector: 'img' },
                ],
                [
                    'can set blockSelector to some other selector',
                    undefined,
                    { blockSelector: 'div' },
                    { maskAllInputs: true, maskTextSelector: undefined, blockSelector: 'div' },
                ],
                [
                    'uses client maskAllElementAttributes when server does not set it',
                    undefined,
                    { maskAllElementAttributes: true },
                    { maskAllInputs: true, maskAllElementAttributes: true },
                ],
                [
                    'uses server maskAllElementAttributes when client does not set it',
                    { maskAllElementAttributes: true },
                    undefined,
                    { maskAllInputs: true, maskAllElementAttributes: true },
                ],
                [
                    'client maskAllElementAttributes overrides server maskAllElementAttributes',
                    { maskAllElementAttributes: true },
                    { maskAllElementAttributes: false },
                    { maskAllInputs: true, maskAllElementAttributes: false },
                ],
            ])(
                '%s',
                (
                    _name: string,
                    serverConfig:
                        | {
                              maskAllInputs?: boolean
                              maskTextSelector?: string
                              blockSelector?: string
                              maskAllElementAttributes?: boolean
                          }
                        | undefined,
                    clientConfig:
                        | {
                              maskAllInputs?: boolean
                              maskTextSelector?: string
                              blockSelector?: string
                              maskAllElementAttributes?: boolean
                          }
                        | undefined,
                    expected:
                        | {
                              maskAllInputs: boolean
                              maskTextSelector?: string
                              blockSelector?: string
                              maskAllElementAttributes?: boolean
                          }
                        | undefined
                ) => {
                    fixture.client.kv.set({
                        [SESSION_RECORDING_REMOTE_CONFIG]: {
                            cache_timestamp: Date.now(),
                            masking: serverConfig,
                        },
                    })

                    options.recording.maskAllInputs = clientConfig?.maskAllInputs
                    options.recording.maskTextSelector = clientConfig?.maskTextSelector
                    options.recording.blockSelector = clientConfig?.blockSelector
                    options.recording.maskAllElementAttributes = clientConfig?.maskAllElementAttributes

                    expect(sessionRecording['_lazyLoadedSessionRecording']['_masking']).toEqual(expected)
                }
            )
        })

        describe('scheduled full snapshots', () => {
            it('starts out unscheduled', () => {
                expect(sessionRecording['_fullSnapshotTimer']).toBe(undefined)
            })

            it('does not schedule a snapshot on start', () => {
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                expect(sessionRecording['_fullSnapshotTimer']).toBe(undefined)
            })

            it('schedules a snapshot, when we take a full snapshot', () => {
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
                const startTimer = sessionRecording['_fullSnapshotTimer']

                _emit(createFullSnapshot())

                expect(sessionRecording['_lazyLoadedSessionRecording']['_fullSnapshotTimer']).not.toBe(undefined)
                expect(sessionRecording['_lazyLoadedSessionRecording']['_fullSnapshotTimer']).not.toBe(startTimer)
            })
        })

        describe('full snapshot timestamp tracking', () => {
            beforeEach(() => {
                sessionRecording.onRemoteConfig(
                    makeFlagsResponse({
                        sessionRecording: {
                            endpoint: '/s/',
                        },
                    })
                )
            })

            it.each([
                [1, [1000]],
                [6, [1000, 2000, 3000, 4000, 5000, 6000]],
                [8, [3000, 4000, 5000, 6000, 7000, 8000]],
            ])('tracks last 6 full snapshot timestamps when %s snapshots emitted', (count, expectedTimestamps) => {
                for (let i = 1; i <= count; i++) {
                    _emit(createFullSnapshot({ timestamp: i * 1000 }))
                }

                const snapshots = sessionRecording['_lazyLoadedSessionRecording']['_fullSnapshotTimestamps']
                expect(snapshots).toEqual(expectedTimestamps.map((ts: number) => [sessionId, ts]))
            })

            it('exposes full snapshot timestamps in sdkDebugProperties', () => {
                _emit(createFullSnapshot({ timestamp: 1000 }))
                _emit(createFullSnapshot({ timestamp: 2000 }))

                expect(sessionRecording.sdkDebugProperties.$sdk_debug_replay_full_snapshots).toEqual([
                    [sessionId, 1000],
                    [sessionId, 2000],
                ])
            })
        })
    })
    describe('recording', () => {
        it('calls rrweb.record with the right options', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            // maskAllInputs should change from default
            // someUnregisteredProp should not be present
            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith({
                emit: expect.anything(),
                errorHandler: expect.anything(),
                maskAllInputs: false,
                blockClass: 'ph-no-capture',
                blockSelector: undefined,
                ignoreClass: 'ph-ignore-input',
                maskTextClass: 'ph-mask',
                maskTextSelector: undefined,
                maskTextFn: undefined,
                maskInputOptions: { password: true },
                maskInputFn: undefined,
                maskAllElementAttributes: false,
                maskAttributeFn: undefined,
                slimDOMOptions: {},
                collectFonts: false,
                plugins: [],
                inlineStylesheet: true,
                inlineStylesheetBudgetRules: 10_000,
                recordCrossOriginIframes: false,
            })
        })

        it('removes scripts when JSON-LD capture is enabled', () => {
            options.recording.slimDOMOptions = { script: false, comment: true }
            options.recording.captureJsonLd = true

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    slimDOMOptions: { script: true, comment: true },
                })
            )
        })

        it.each(['maskCapturedNetworkRequestFn', 'maskNetworkRequestFn'] as const)(
            'applies replay URL privacy settings to JSON-LD payloads through %s',
            async (maskOption) => {
                const script = document.createElement('script')
                script.type = 'application/ld+json'
                script.textContent = JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    category: 'https://example.com/category?gclid=secret&token=private#fragment',
                    offers: [{ '@type': 'Offer', availability: '/unavailable' }],
                })
                document.body.appendChild(script)
                options.recording.captureJsonLd = true
                options.maskPersonalData = true
                options.stripUrlHash = true
                const maskUrl = vi.fn((url: string) =>
                    url === '/unavailable' ? undefined : url.replace('token=private', 'token=redacted')
                )
                if (maskOption === 'maskCapturedNetworkRequestFn') {
                    options.recording.maskCapturedNetworkRequestFn = (request) => {
                        const name = maskUrl(request.name)
                        return name ? { ...request, name } : null
                    }
                } else {
                    options.recording.maskNetworkRequestFn = (request) => {
                        const url = maskUrl(request.url)
                        return url ? { ...request, url } : null
                    }
                }
                try {
                    sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
                    _emit(createMetaSnapshot())
                    await Promise.resolve()

                    expect(maskUrl).toHaveBeenCalledWith('https://example.com/category?gclid=<masked>&token=private')
                    expect(_addCustomEvent).toHaveBeenCalledWith('$json_ld', {
                        '@context': 'https://schema.org',
                        '@type': 'Product',
                        category: 'https://example.com/category?gclid=<masked>&token=redacted',
                        offers: [{ '@type': 'Offer' }],
                    })
                } finally {
                    script.remove()
                }
            }
        )

        it('emits sanitized JSON-LD only while capture is enabled', async () => {
            const target = document.createElement('div')
            target.id = 'product-123'
            document.body.appendChild(target)
            const script = document.createElement('script')
            script.type = 'application/ld+json'
            script.textContent = JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                '@id': 'https://example.com/products/123#product-123',
                name: 'Camera',
                email: 'private@example.com',
            })
            document.body.appendChild(script)
            options.recording.captureJsonLd = true

            try {
                sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

                expect(_addCustomEvent).not.toHaveBeenCalledWith('$json_ld', expect.anything())
                _addCustomEvent.mockImplementation((tag: string, payload: unknown) => {
                    _emit(createCustomSnapshot({}, payload as Record<string, unknown>, tag))
                })
                _emit(createMetaSnapshot())
                await Promise.resolve()

                expect(_addCustomEvent).toHaveBeenCalledWith('$json_ld', {
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    '@id': 'product-123',
                    name: 'Camera',
                })

                _emit(createFullSnapshot())
                _emit(createFullSnapshot())
                await Promise.resolve()
                const jsonLdEvents = sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.filter(
                    (event: eventWithTime) => event.type === EventType.Custom && event.data.tag === '$json_ld'
                )
                expect(jsonLdEvents).toHaveLength(1)
                expect(jsonLdEvents[0].data.href).toBe('http://localhost/')

                options.recording.captureJsonLd = false
                document.body.appendChild(
                    Object.assign(document.createElement('script'), {
                        type: 'application/ld+json',
                        textContent: JSON.stringify({
                            '@context': 'https://schema.org',
                            '@type': 'Product',
                            name: 'After disable',
                        }),
                    })
                )
                await Promise.resolve()
                expect(_addCustomEvent).not.toHaveBeenCalledWith(
                    '$json_ld',
                    expect.objectContaining({ name: 'After disable' })
                )
            } finally {
                _addCustomEvent.mockReset()
                target.remove()
                document.querySelectorAll('script[type="application/ld+json"]').forEach((element) => element.remove())
            }
        })

        it.each([
            ['rrweb ignored the target element', 'link', undefined],
            ['attributeFilter omits id', 'div', ['class']],
        ])('drops a JSON-LD @id when %s', async (_reason, tagName, attributeFilter) => {
            const target = document.createElement(tagName)
            target.id = 'product-123'
            document.body.appendChild(target)
            const script = document.createElement('script')
            script.type = 'application/ld+json'
            script.textContent = JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                '@id': '#product-123',
                name: 'Camera',
            })
            document.body.appendChild(script)
            options.recording.captureJsonLd = true
            options.recording.attributeFilter = attributeFilter

            try {
                sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
                _emit(createMetaSnapshot())
                await Promise.resolve()

                expect(_addCustomEvent).toHaveBeenCalledWith('$json_ld', {
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    name: 'Camera',
                })
            } finally {
                target.remove()
                script.remove()
            }
        })

        it('emits the latest JSON-LD after returning from idle', async () => {
            const script = document.createElement('script')
            script.type = 'application/ld+json'
            script.textContent = JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'Before idle',
            })
            document.body.appendChild(script)
            options.recording.captureJsonLd = true

            try {
                sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
                _emit(createMetaSnapshot())
                await Promise.resolve()
                _addCustomEvent.mockClear()

                const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']
                lazyRecorder['_isIdle'] = true
                script.textContent = JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    name: 'After idle',
                })
                await Promise.resolve()
                expect(_addCustomEvent).not.toHaveBeenCalledWith(
                    '$json_ld',
                    expect.objectContaining({ name: 'After idle' })
                )

                _emit(createIncrementalSnapshot({ timestamp: Date.now() + 1 }))
                await Promise.resolve()
                expect(_addCustomEvent).toHaveBeenCalledWith('$json_ld', {
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    name: 'After idle',
                })
            } finally {
                script.remove()
            }
        })

        it('does not queue JSON-LD before rrweb is ready', async () => {
            const script = document.createElement('script')
            script.type = 'application/ld+json'
            script.textContent = JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'Before disable',
            })
            document.body.appendChild(script)
            options.recording.captureJsonLd = true

            try {
                sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
                expect(_addCustomEvent).not.toHaveBeenCalledWith('$json_ld', expect.anything())

                options.recording.captureJsonLd = false
                _emit(createMetaSnapshot())
                await Promise.resolve()

                expect(_addCustomEvent).not.toHaveBeenCalledWith('$json_ld', expect.anything())
                expect(sessionRecording['_lazyLoadedSessionRecording']['_queuedRRWebEvents']).toEqual([])
            } finally {
                script.remove()
            }
        })

        it('restores JSON-LD after a pending-trigger snapshot truncates the buffer', async () => {
            const script = document.createElement('script')
            script.type = 'application/ld+json'
            script.textContent = JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'Camera',
            })
            document.body.appendChild(script)
            options.recording.captureJsonLd = true

            try {
                sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
                _addCustomEvent.mockImplementation((tag: string, payload: unknown) => {
                    _emit(createCustomSnapshot({}, payload as Record<string, unknown>, tag))
                })
                _emit(createMetaSnapshot({ data: { href: 'https://test.com/first' } }))
                await Promise.resolve()

                const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']
                const pendingTrigger = vi.spyOn(lazyRecorder['_strategy']!, 'hasPendingTriggers').mockReturnValue(true)
                try {
                    _emit(createMetaSnapshot({ data: { href: 'https://test.com/second' } }))
                    _emit(createFullSnapshot())
                    await Promise.resolve()

                    const bufferedEvents = lazyRecorder['_buffer'].data
                    const fullSnapshotIndex = bufferedEvents.findIndex((event: eventWithTime) => event.type === 2)
                    const jsonLdIndexes = bufferedEvents
                        .map((event: eventWithTime, index: number) => (event.data?.tag === '$json_ld' ? index : -1))
                        .filter((index: number) => index >= 0)
                    expect(bufferedEvents[0]).toEqual(createMetaSnapshot({ data: { href: 'https://test.com/second' } }))
                    expect(jsonLdIndexes).toHaveLength(1)
                    expect(jsonLdIndexes[0]).toBeGreaterThan(fullSnapshotIndex)
                    expect(bufferedEvents[jsonLdIndexes[0]]).toEqual({
                        ...createCustomSnapshot(
                            {},
                            { '@context': 'https://schema.org', '@type': 'Product', name: 'Camera' },
                            '$json_ld'
                        ),
                        data: {
                            tag: '$json_ld',
                            payload: { '@context': 'https://schema.org', '@type': 'Product', name: 'Camera' },
                            href: 'http://localhost/',
                        },
                    })
                } finally {
                    pendingTrigger.mockRestore()
                }
            } finally {
                _addCustomEvent.mockReset()
                script.remove()
            }
        })

        it.each([
            ['default', false, 'https://example.com/private?secret=<masked>#fragment'],
            ['modern', true, 'https://example.com/public?secret=<masked>'],
            ['legacy', true, 'https://example.com/public?secret=<masked>'],
            ['reject', true, undefined],
            ['throw', true, undefined],
        ] as const)('applies %s URL masking to JSON-LD events', (masking, stripHash, expectedHref) => {
            options.recording.captureJsonLd = true
            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
            options.stripUrlHash = stripHash
            options.maskPersonalData = true
            options.personalDataQueryParams = ['secret']
            if (masking === 'modern') {
                options.recording.maskCapturedNetworkRequestFn = (request) => ({
                    ...request,
                    name: request.name.replace('/private', '/public'),
                })
            } else if (masking === 'legacy') {
                options.recording.maskNetworkRequestFn = (request) => ({
                    ...request,
                    url: request.url.replace('/private', '/public'),
                })
            } else if (masking === 'reject' || masking === 'throw') {
                options.recording.maskCapturedNetworkRequestFn = () => {
                    if (masking === 'throw') {
                        throw new Error('masking failed')
                    }
                    return undefined
                }
            }
            fakeNavigateTo('https://example.com/private?secret=hidden#fragment')
            const payload = { '@context': 'https://schema.org', '@type': 'Product' }
            _emit(createCustomSnapshot({}, payload, '$json_ld'))
            const events = sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data
            const jsonLd = events.find((event: eventWithTime) => event.type === 5 && event.data.tag === '$json_ld')
            expect(jsonLd).toBeDefined()
            expect(jsonLd.data.href).toBe(expectedHref)
            expect(jsonLd.data.payload).toEqual(payload)
        })

        it('does not emit JSON-LD by default', () => {
            const script = document.createElement('script')
            script.type = 'application/ld+json'
            script.textContent = JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'Camera',
            })
            document.body.appendChild(script)

            try {
                sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

                expect(_addCustomEvent.mock.calls.some(([tag]) => tag === '$json_ld')).toBe(false)
            } finally {
                script.remove()
            }
        })

        it('does not enable JSON-LD capture for a truthy non-boolean value', () => {
            const script = document.createElement('script')
            script.type = 'application/ld+json'
            script.textContent = JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'Camera',
            })
            document.body.appendChild(script)
            options.recording.slimDOMOptions = { script: false }
            options.recording.captureJsonLd = 'false' as unknown as boolean

            try {
                sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

                expect(_addCustomEvent.mock.calls.some(([tag]) => tag === '$json_ld')).toBe(false)
                expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                    expect.objectContaining({ slimDOMOptions: { script: false } })
                )
            } finally {
                script.remove()
            }
        })

        it('contains and logs recorder-owned callback failures once without swallowing host failures', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            const previousDebug = assignableWindow.POSTHOG_DEBUG
            assignableWindow.POSTHOG_DEBUG = true
            const errorSpy = vi.spyOn(window!.console, 'error').mockImplementation(() => {})

            try {
                const recordMock = assignableWindow.__PosthogExtensions__.rrweb.record as vi.Mock
                const errorHandler = recordMock.mock.calls[0][0].errorHandler
                const recorderError = new TypeError('recorder callback failed')

                expect(errorHandler(new DOMException('invalid index', 'IndexSizeError'), 'host')).toBe(false)
                expect(errorSpy).not.toHaveBeenCalled()
                expect(errorHandler(recorderError, 'rrweb')).toBe(true)
                expect(errorHandler(recorderError, 'rrweb')).toBe(true)
                expect(errorSpy).toHaveBeenCalledTimes(1)
            } finally {
                assignableWindow.POSTHOG_DEBUG = previousDebug
                errorSpy.mockRestore()
            }
        })

        // This harness replaces the rrweb extension with vi mocks (addRRwebToWindow), so it
        // cannot host a real rrweb record() run; the three budget tests below therefore pin the
        // plumbing boundary instead: the configured value reaches the recorder options verbatim.
        // What the shipped default then does inside record() (a sheet crossing 10,000 rules is
        // deferred and later delivered as a _cssText mutation) is pinned end-to-end in
        // packages/rrweb/rrweb/test/record/deferred-stylesheet-inlining.test.ts.
        it('passes the default stylesheet budget of 10,000 rules to rrweb.record', () => {
            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({ inlineStylesheetBudgetRules: 10_000 })
            )
        })

        it('passes an explicit inlineStylesheetBudgetRules of 0 through to rrweb.record to disable the budget', () => {
            options.recording.inlineStylesheetBudgetRules = 0

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({ inlineStylesheetBudgetRules: 0 })
            )
        })

        it('passes a raised inlineStylesheetBudgetRules through to rrweb.record', () => {
            options.recording.inlineStylesheetBudgetRules = 50_000

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({ inlineStylesheetBudgetRules: 50_000 })
            )
        })

        it('passes a configured attributeFilter through to rrweb.record', () => {
            options.recording.attributeFilter = ['class', 'value']

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            expect(assignableWindow.__PosthogExtensions__.rrweb.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    attributeFilter: ['class', 'value'],
                })
            )
        })
    })
    describe('buffering minimum duration', () => {
        it('can report no duration when no data', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(null)
        })

        it('can report zero duration', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            const { sessionStartTimestamp } = fixture.client.session
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp }))
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(0)
        })

        it('can report a duration', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )

            const { sessionStartTimestamp } = fixture.client.session
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 100 }))
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(100)
        })

        it('starts with an undefined minimum duration', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                    },
                })
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_minimumDuration']).toBe(null)
        })

        it('can set minimum duration from flags response', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500 },
                })
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_minimumDuration']).toBe(1500)
        })

        it('does not flush if below the minimum duration', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500 },
                })
            )
            expect(sessionRecording.status).toBe('active')
            const { sessionStartTimestamp } = fixture.client.session
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 100 }))
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(100)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_minimumDuration']).toBe(1500)

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toBe(1) // the emitted incremental event
            // call the private method to avoid waiting for the timer
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            expect(fixture.recorderHost.captureSnapshot).not.toHaveBeenCalled()
        })

        it('does flush if session duration is negative', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500 },
                })
            )

            expect(sessionRecording.status).toBe('active')
            const { sessionStartTimestamp } = fixture.client.session

            // if we have some data in the buffer and the buffer has a session id but then the session id changes
            // then the session duration will be negative, and we will never flush the buffer
            // this setup isn't quite that but does simulate the behaviour closely enough
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp - 1000 }))

            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(-1000)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_minimumDuration']).toBe(1500)

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toBe(1) // the emitted incremental event
            // call the private method to avoid waiting for the timer
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            expect(fixture.recorderHost.captureSnapshot).toHaveBeenCalled()
        })

        it('does not stay buffering after the minimum duration', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { minimumDurationMilliseconds: 1500 },
                })
            )

            expect(sessionRecording.status).toBe('active')
            const { sessionStartTimestamp } = fixture.client.session
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 100 }))
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(100)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_minimumDuration']).toBe(1500)

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toBe(1) // the emitted incremental event
            // call the private method to avoid waiting for the timer
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            expect(fixture.recorderHost.captureSnapshot).not.toHaveBeenCalled()

            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 1501 }))

            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toBe(2) // two emitted incremental events
            // call the private method to avoid waiting for the timer
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            expect(fixture.recorderHost.captureSnapshot).toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toBe(0)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(null)
            _emit(createIncrementalSnapshot({ data: { source: 1 }, timestamp: sessionStartTimestamp + 1502 }))
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toBe(1)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sessionDuration']).toBe(1502)
            // call the private method to avoid waiting for the timer
            sessionRecording['_lazyLoadedSessionRecording']['_flushBuffer']()

            expect(fixture.recorderHost.captureSnapshot).toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer'].data.length).toBe(0)
        })
    })
})
