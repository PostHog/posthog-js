// @vitest-environment jsdom

import { SessionRecording } from '../../../../extensions/replay/session-recording'
import { AndTriggerMatching, OrTriggerMatching } from '../../../../extensions/replay/external/triggerMatching'
import {
    FULL_SNAPSHOT_EVENT_TYPE,
    META_EVENT_TYPE,
} from '../../../../extensions/replay/external/sessionrecording-utils'
import {
    RECORDING_REMOTE_CONFIG_TTL_MS,
    SESSION_RECORDING_REMOTE_CONFIG,
} from '../../../../extensions/replay/constants'
import type { RemoteConfig, SessionRecordingPersistedConfig } from '@posthog/browser-common/replay/types'
import type { RemoteConfigResult } from '@posthog/browser-common'
import type { eventWithTime, fullSnapshotEvent, metaEvent } from '@posthog/browser-common/replay/rrweb-types'
import type { rrwebRecord } from '../../../../extensions/replay/rrweb'
import { replayWindow } from '../../../../extensions/replay/globals'
import { createReplayClient } from './helpers/replay-client'

const EMPTY_BUFFER = {
    data: [],
    sizes: [],
    sessionId: null,
    size: 0,
    windowId: null,
}
const createMetaSnapshot = (event = {}): metaEvent =>
    ({
        type: META_EVENT_TYPE,
        data: { href: 'https://has-to-be-present-or-invalid.com' },
        ...event,
    }) as metaEvent
const createFullSnapshot = (event = {}): fullSnapshotEvent =>
    ({
        type: FULL_SNAPSHOT_EVENT_TYPE,
        data: {},
        ...event,
    }) as fullSnapshotEvent

function makeFlagsResponse(config: Partial<RemoteConfig>): RemoteConfigResult {
    return { ok: true, config: config as RemoteConfig }
}

describe('SessionRecording', () => {
    let fixture: ReturnType<typeof createReplayClient>
    let sessionRecording: SessionRecording
    let client: ReturnType<typeof createReplayClient>['client']
    let options: ReturnType<typeof createReplayClient>['options']
    let sessionId: string
    let loadScriptMock: ReturnType<typeof vi.fn>
    let registerForSessionMock: ReturnType<typeof vi.fn>
    let _emit: (event: eventWithTime) => void

    beforeEach(() => {
        fixture = createReplayClient()
        registerForSessionMock = vi.fn()
        fixture.host.registerSessionProperties = registerForSessionMock
        ;({ client, options } = fixture)
        sessionRecording = fixture.controller
        sessionId = client.session.sessionId
        const record = Object.assign(
            vi.fn(({ emit }) => {
                _emit = emit
                return () => {}
            }),
            {
                takeFullSnapshot: vi.fn(() => _emit(createFullSnapshot())),
                addCustomEvent: vi.fn(),
            }
        )
        loadScriptMock = vi.fn((_script, callback) => {
            replayWindow!.__PosthogExtensions__ = {
                rrweb: { record: record as unknown as rrwebRecord, version: 'fake' },
            }
            callback()
        })
        fixture.host.loadRecorder = loadScriptMock
    })

    afterEach(() => {
        sessionRecording.dispose({ discardBufferedEvents: true })
        client.dispose()
        delete replayWindow!.__PosthogExtensions__
    })

    describe('onRemoteConfig()', () => {
        beforeEach(() => {
            vi.spyOn(sessionRecording, 'startIfEnabledOrStop')
        })

        it('uses anyMatchSessionRecordingStatus when triggerMatching is "any"', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', triggerMatchType: 'any' },
                })
            )
            // Trigger matching is now internal to V1 strategy
            const strategy = sessionRecording['_lazyLoadedSessionRecording']['_strategy']
            expect(strategy?.['_triggerStatusMatcher']).toBeInstanceOf(OrTriggerMatching)
        })

        it('uses allMatchSessionRecordingStatus when triggerMatching is "all"', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', triggerMatchType: 'all' },
                })
            )
            // Trigger matching is now internal to V1 strategy
            const strategy = sessionRecording['_lazyLoadedSessionRecording']['_strategy']
            expect(strategy?.['_triggerStatusMatcher']).toBeInstanceOf(AndTriggerMatching)
        })

        it('uses most restrictive when triggerMatching is not specified', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/' },
                })
            )
            // Trigger matching is now internal to V1 strategy
            const strategy = sessionRecording['_lazyLoadedSessionRecording']['_strategy']
            expect(strategy?.['_triggerStatusMatcher']).toBeInstanceOf(AndTriggerMatching)
        })

        it('when the first event is a meta it does not take a manual full snapshot', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/' },
                })
            )
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording['status']).toBe('active')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                ...EMPTY_BUFFER,
                sessionId: sessionId,
                windowId: 'windowId',
            })

            const metaSnapshot = createMetaSnapshot({
                data: { href: 'https://example.com' },
            })
            _emit(metaSnapshot)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                data: [metaSnapshot],
                sizes: [48],
                sessionId: sessionId,
                size: 48,
                windowId: 'windowId',
            })
        })

        it('when the first event is a full snapshot it does not take a manual full snapshot', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/' },
                })
            )
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording['status']).toBe('active')
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                ...EMPTY_BUFFER,
                sessionId: sessionId,
                windowId: 'windowId',
            })

            const fullSnapshot = createFullSnapshot()
            _emit(fullSnapshot)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_buffer']).toEqual({
                data: [fullSnapshot],
                sizes: [20],
                sessionId: sessionId,
                size: 20,
                windowId: 'windowId',
            })
        })

        it('status is disabled until config enables recording', () => {
            expect(sessionRecording['status']).toBe('disabled')

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))
            expect(sessionRecording['status']).toBe('active')
        })

        it('sample rate is null when flags does not return it', () => {
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/' },
                })
            )
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording['_lazyLoadedSessionRecording']['_isSampled']).toBe(null)
        })

        it('stores true in persistence if recording is enabled from the server', () => {
            client.kv.set({ [SESSION_RECORDING_REMOTE_CONFIG]: undefined })

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: { endpoint: '/s/' } }))

            expect(client.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)!.enabled).toBe(true)
        })

        it('stores true in persistence if canvas is enabled from the server', () => {
            client.kv.set({ [SESSION_RECORDING_REMOTE_CONFIG]: undefined })

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        recordCanvas: true,
                        canvasFps: 6,
                        canvasQuality: '0.2',
                    },
                })
            )

            expect(client.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)!.recordCanvas).toBe(
                true
            )
            expect(client.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)!.canvasFps).toBe(6)
            expect(client.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)!.canvasQuality).toBe(
                '0.2'
            )
        })

        it('stores masking config in persistence if set on the server', () => {
            client.kv.set({ [SESSION_RECORDING_REMOTE_CONFIG]: undefined })

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        masking: { maskAllInputs: true, maskTextSelector: '*' },
                    },
                })
            )

            expect(client.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)!.masking).toEqual({
                maskAllInputs: true,
                maskTextSelector: '*',
            })
        })

        it('stores nothing in persistence if recording is not returned from the server', () => {
            client.kv.set({ [SESSION_RECORDING_REMOTE_CONFIG]: undefined })

            sessionRecording.onRemoteConfig(makeFlagsResponse({}))

            expect(client.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)).toBe(undefined)
            expect(sessionRecording.status).toBe('disabled')
        })

        it('stores response in persistence if recording is false from the server', () => {
            client.kv.set({ [SESSION_RECORDING_REMOTE_CONFIG]: undefined })

            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: false }))

            expect(sessionRecording.status).toBe('disabled')
        })

        it('discards recording when server disables it after starting from cached config', () => {
            // Fresh cached config from previous page load
            client.kv.set({
                [SESSION_RECORDING_REMOTE_CONFIG]: {
                    enabled: true,
                    endpoint: '/s/',
                    cache_timestamp: Date.now(),
                },
            })

            // Recording starts from cache
            sessionRecording.startIfEnabledOrStop()
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording.status).toBe('active')

            const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']
            const discardSpy = vi.spyOn(lazyRecorder!, 'discard')
            const flushSpy = vi.spyOn(lazyRecorder as any, '_flushBuffer')

            // Server responds with recording disabled
            sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: false }))

            expect(discardSpy).toHaveBeenCalled()
            expect(flushSpy).not.toHaveBeenCalled()
            expect(sessionRecording['_persistFlagsOnSessionListener']).toBeUndefined()
            expect(client.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)!.enabled).toBe(false)
        })

        it('stores sample rate', () => {
            client.kv.set({ SESSION_RECORDING_REMOTE_CONFIG: undefined })

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', sampleRate: '0.70' },
                })
            )

            expect(client.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)!.sampleRate).toBe(
                0.7
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sampleRate']).toBe(0.7)
        })

        it('local sampleRate takes precedence over remote config', () => {
            options.recording.sampleRate = 0.3

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', sampleRate: '0.70' },
                })
            )

            expect(client.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)!.sampleRate).toBe(
                0.3
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sampleRate']).toBe(0.3)
        })

        it('local sampleRate of 0 takes precedence over remote config', () => {
            options.recording.sampleRate = 0

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', sampleRate: '0.70' },
                })
            )

            expect(client.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)!.sampleRate).toBe(0)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sampleRate']).toBe(0)
        })

        it('falls back to remote config when local sampleRate is undefined', () => {
            options.recording.sampleRate = undefined

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', sampleRate: '0.50' },
                })
            )

            expect(client.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)!.sampleRate).toBe(
                0.5
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sampleRate']).toBe(0.5)
        })

        it('ignores local sampleRate greater than 1 and falls back to remote config', () => {
            options.recording.sampleRate = 1.5

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', sampleRate: '0.70' },
                })
            )

            expect(client.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)!.sampleRate).toBe(
                0.7
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sampleRate']).toBe(0.7)
        })

        it('ignores local sampleRate less than 0 and falls back to remote config', () => {
            options.recording.sampleRate = -0.5

            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/s/', sampleRate: '0.70' },
                })
            )

            expect(client.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)!.sampleRate).toBe(
                0.7
            )
            expect(sessionRecording['_lazyLoadedSessionRecording']['_sampleRate']).toBe(0.7)
        })

        it('starts session recording, saves setting and endpoint when enabled', () => {
            client.kv.set({ [SESSION_RECORDING_REMOTE_CONFIG]: undefined })
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: { endpoint: '/ses/' },
                })
            )

            expect(sessionRecording.startIfEnabledOrStop).toHaveBeenCalled()
            expect(loadScriptMock).toHaveBeenCalled()
            expect(client.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)!.enabled).toBe(true)
            expect(sessionRecording['_lazyLoadedSessionRecording']['_endpoint']).toEqual('/ses/')
        })

        it('starts recording from persisted config when remote config fetch fails', () => {
            // Fresh config in persistence (simulating cache from previous page load)
            client.kv.set({
                [SESSION_RECORDING_REMOTE_CONFIG]: {
                    enabled: true,
                    endpoint: '/s/',
                    cache_timestamp: Date.now(),
                },
            })

            // Remote config fetch fails — empty object, no sessionRecording key
            sessionRecording.onRemoteConfig(makeFlagsResponse({}))

            // Should fall back to persisted config and start recording
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording.status).toBe('active')
            expect(registerForSessionMock).not.toHaveBeenCalledWith({ $sdk_debug_replay_stale_config: true })
        })

        it('does not start recording when config fetch fails and no persisted config exists', () => {
            client.kv.set({ [SESSION_RECORDING_REMOTE_CONFIG]: undefined })

            // Remote config fetch fails
            sessionRecording.onRemoteConfig(makeFlagsResponse({}))

            // No persisted config to fall back to
            expect(loadScriptMock).not.toHaveBeenCalled()
            expect(sessionRecording.status).toBe('disabled')
            expect(registerForSessionMock).not.toHaveBeenCalledWith({ $sdk_debug_replay_stale_config: true })
        })

        it('awaits config when config fetch fails and persisted config is stale', () => {
            client.kv.set({
                [SESSION_RECORDING_REMOTE_CONFIG]: {
                    enabled: true,
                    endpoint: '/s/',
                    cache_timestamp: Date.now() - RECORDING_REMOTE_CONFIG_TTL_MS - 1000,
                },
            })

            // Remote config fetch fails
            sessionRecording.onRemoteConfig(makeFlagsResponse({}))

            // Script loads, refresh requested — waiting for fresh config
            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording.status).toBe('awaiting_config')
        })

        it('awaits config when config fetch fails and persisted config has no cache_timestamp', () => {
            // configs persisted by pre-cache_timestamp SDK versions can be arbitrarily old,
            // so they must not start recording under their stale trigger/sampling settings
            client.kv.set({
                [SESSION_RECORDING_REMOTE_CONFIG]: {
                    enabled: true,
                    endpoint: '/s/',
                },
            })

            // Remote config fetch fails
            sessionRecording.onRemoteConfig(makeFlagsResponse({}))

            expect(loadScriptMock).toHaveBeenCalled()
            expect(sessionRecording.status).toBe('awaiting_config')
        })

        describe.each(['expired', 'undated'])('%s persisted config', (age) => {
            beforeEach(() => {
                client.kv.set({
                    [SESSION_RECORDING_REMOTE_CONFIG]: {
                        enabled: true,
                        endpoint: '/s/',
                        ...(age === 'expired'
                            ? { cache_timestamp: Date.now() - RECORDING_REMOTE_CONFIG_TTL_MS - 1000 }
                            : {}),
                    },
                })
                sessionRecording.onRemoteConfig(makeFlagsResponse({}))
                expect(sessionRecording.status).toBe('awaiting_config')
                expect(registerForSessionMock).not.toHaveBeenCalledWith({
                    $sdk_debug_replay_stale_config: true,
                })
            })

            it.each<RemoteConfigResult>([{ ok: false }, makeFlagsResponse({})])(
                'tags the session without starting recording when refresh returns %j',
                (result) => {
                    sessionRecording.onRemoteConfig(result)
                    expect(sessionRecording.status).toBe('missing_config')
                    expect(registerForSessionMock).toHaveBeenCalledWith({
                        $sdk_debug_replay_stale_config: true,
                    })
                    expect(replayWindow!.__PosthogExtensions__.rrweb.record).not.toHaveBeenCalled()

                    registerForSessionMock.mockClear()
                    sessionRecording.onRemoteConfig(result)
                    expect(sessionRecording.status).toBe('missing_config')
                    expect(registerForSessionMock).not.toHaveBeenCalled()
                    expect(replayWindow!.__PosthogExtensions__.rrweb.record).not.toHaveBeenCalled()
                }
            )

            it.each([false, { endpoint: '/s/' }])('does not tag a successful refresh: %j', (sessionRecordingConfig) => {
                sessionRecording.onRemoteConfig(makeFlagsResponse({ sessionRecording: sessionRecordingConfig }))
                expect(registerForSessionMock).not.toHaveBeenCalledWith({
                    $sdk_debug_replay_stale_config: true,
                })
                if (sessionRecordingConfig === false) {
                    expect(replayWindow!.__PosthogExtensions__.rrweb.record).not.toHaveBeenCalled()
                } else {
                    expect(sessionRecording.status).toBe('active')
                }
            })
        })

        it('discards buffer on beforeunload if status is buffering', () => {
            // Set persistence to simulate config exists
            client.kv.set({
                [SESSION_RECORDING_REMOTE_CONFIG]: {
                    enabled: true,
                    endpoint: '/s/',
                },
            })

            // Receive config to start recording
            sessionRecording.onRemoteConfig(
                makeFlagsResponse({
                    sessionRecording: {
                        endpoint: '/s/',
                        urlTriggers: [{ url: 'example.com', matching: 'regex' }],
                    },
                })
            )

            // Should be buffering (waiting for trigger)
            expect(sessionRecording.status).toBe('buffering')

            const lazyRecorder = sessionRecording['_lazyLoadedSessionRecording']
            const clearBufferSpy = vi.spyOn(lazyRecorder as any, '_clearBuffer')
            const flushBufferSpy = vi.spyOn(lazyRecorder as any, '_flushBuffer')

            // Trigger beforeunload
            window.dispatchEvent(new Event('beforeunload'))

            // Should have cleared buffer, not flushed it
            expect(clearBufferSpy).toHaveBeenCalled()
            expect(flushBufferSpy).not.toHaveBeenCalled()
        })
    })
})
