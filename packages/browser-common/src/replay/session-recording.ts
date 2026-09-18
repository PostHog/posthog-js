import {
    SDK_DEBUG_RECORDING_SCRIPT_NOT_LOADED,
    RECORDING_REMOTE_CONFIG_TTL_MS,
    SESSION_RECORDING_IS_SAMPLED,
    SESSION_RECORDING_SAMPLE_RATE,
    SESSION_RECORDING_OVERRIDE_SAMPLING,
    SESSION_RECORDING_OVERRIDE_LINKED_FLAG,
    SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER,
    SESSION_RECORDING_OVERRIDE_URL_TRIGGER,
    SESSION_RECORDING_REMOTE_CONFIG,
} from './constants'
import type { Properties, RemoteConfig, SessionRecordingPersistedConfig, SessionStartReason } from './types'
import { type eventWithTime } from './rrweb-types'

import { isNullish, isNumber, isUndefined, isValidSampleRate } from '@posthog/core'
import { createLogger } from '../utils/logger'
import { document, window } from '../utils/globals'
import { addEventListener } from '../utils/general-utils'
import type { LazyLoadedSessionRecordingInterface } from './recorder'
import type { Client, Disposable, DeepReadonly } from '../index'
import type { RemoteConfigResult } from '../types/remote-config'
import type { ReplayOptions, ReplayHost } from './host'
import { continueWith } from '../utils/promise-utils'
import {
    AWAITING_CONFIG,
    DISABLED,
    LAZY_LOADING,
    MISSING_CONFIG,
    type SessionRecordingStatus,
    type TriggerType,
} from './external/triggerMatching'
import type { Extension } from '../extension'

const LOGGER_PREFIX = '[SessionRecording]'
const logger = createLogger(LOGGER_PREFIX)

const hasDocumentEverBeenVisible = (): boolean => {
    if (!document?.visibilityState || document.visibilityState === 'visible') {
        return true
    }

    const visibilityEntries = window?.performance?.getEntriesByType?.('visibility-state')
    return !visibilityEntries?.length || visibilityEntries.some((entry) => entry.name === 'visible')
}

export class SessionRecording implements Extension {
    readonly name = 'sessionRecording'
    private _client?: Client
    private _host!: ReplayHost
    private _ready = false
    private _initializeRequested = false
    private _initializing = false
    private _remoteConfigSubscription?: Disposable
    private _loading = false
    private _startAfterLoad = false
    private _startRequested = false
    private _pendingOverrides: Record<string, boolean> = {}

    _forceAllowLocalhostNetworkCapture: boolean = false

    private _recordingStatus: SessionRecordingStatus = DISABLED

    private get _config() {
        return this._options()
    }

    private get _persistence() {
        return this._client?.kv
    }

    private _persistFlagsOnSessionListener: Disposable | undefined = undefined
    private _lazyLoadedSessionRecording: LazyLoadedSessionRecordingInterface | undefined
    private _sessionRecordingDisposed = false
    private _documentWasEverVisible = hasDocumentEverBeenVisible()

    private _onVisibilityChange = (): void => {
        if (document?.visibilityState === 'visible') {
            this._documentWasEverVisible = true
            this._lazyLoadedSessionRecording?.setDocumentWasEverVisible?.(true)
        }
    }

    public get started(): boolean {
        return !!this._lazyLoadedSessionRecording?.isStarted
    }

    get status(): SessionRecordingStatus {
        if (this._recordingStatus === AWAITING_CONFIG || this._recordingStatus === MISSING_CONFIG) {
            return this._recordingStatus
        }
        return this._lazyLoadedSessionRecording?.status ?? this._recordingStatus
    }

    constructor(private readonly _options: () => ReplayOptions) {}

    setup(client: Client): void | Promise<void> {
        if (this._sessionRecordingDisposed) return
        if (!client.replay) throw new Error(LOGGER_PREFIX + ' started without replay host capabilities')
        this._client = client
        this._host = client.replay
        // Visibility must be observed before deferred initialization and before the chunk loads.
        if (document?.addEventListener) {
            addEventListener(document, 'visibilitychange', this._onVisibilityChange)
        }
        return continueWith(client.kv.initialize(), () => {
            if (this._sessionRecordingDisposed) return
            this._ready = true
            if (Object.keys(this._pendingOverrides).length) client.kv.set(this._pendingOverrides)
            this._pendingOverrides = {}
            if (this._initializeRequested) this.initialize()
        })
    }

    initialize(): void {
        this._initializeRequested = true
        if (this._sessionRecordingDisposed || this._initializing || !this._ready || !this._client) return
        this._initializing = true
        const subscription = this._client.onRemoteConfig((result) => this.onRemoteConfig(result))
        if (this._sessionRecordingDisposed) {
            subscription.dispose()
            return
        }
        this._remoteConfigSubscription = subscription
        this.startIfEnabledOrStop()
    }

    dispose({ discardBufferedEvents = false }: { discardBufferedEvents?: boolean } = {}): void {
        if (this._sessionRecordingDisposed) return
        this._sessionRecordingDisposed = true
        this._remoteConfigSubscription?.dispose()
        document?.removeEventListener?.('visibilitychange', this._onVisibilityChange)
        if (discardBufferedEvents) {
            this._discardRecording(true)
        } else {
            this.stopRecording()
        }
    }

    private get _isRecordingEnabled() {
        const enabled_server_side = !!this._client?.kv.get<SessionRecordingPersistedConfig>(
            SESSION_RECORDING_REMOTE_CONFIG
        )?.enabled
        const enabled_client_side = !this._config.disabled
        const isDisabled = this._config.disabled || !this._host.isAllowed
        return window && enabled_server_side && enabled_client_side && !isDisabled
    }

    startIfEnabledOrStop(startReason?: SessionStartReason) {
        if (this._sessionRecordingDisposed || !this._ready) {
            return
        }

        if (this._isRecordingEnabled && this._lazyLoadedSessionRecording?.isStarted) {
            return
        }

        // According to the rrweb docs, rrweb is not supported on IE11 and below:
        // "rrweb does not support IE11 and below because it uses the MutationObserver API, which was supported by these browsers."
        // https://github.com/rrweb-io/rrweb/blob/master/guide.md#compatibility-note
        //
        // However, MutationObserver does exist on IE11, it just doesn't work well and does not detect all changes.
        // Instead, when we load "recorder.js", the first JS error is about "Object.assign" and "Array.from" being undefined.
        // Thus instead of MutationObserver, we look for this function and block recording if it's undefined.
        const canRunReplay = !isUndefined(Object.assign) && !isUndefined(Array.from)
        if (this._isRecordingEnabled && canRunReplay) {
            this._lazyLoadAndStart(startReason)
            logger.info('starting')
        } else {
            this._recordingStatus = DISABLED
            this.stopRecording()
        }
    }

    /**
     * session recording waits until it receives remote config before loading the script
     * this is to ensure we can control the script name remotely
     * and because we wait until we have local and remote config to determine if we should start at all
     * if start is called and there is no remote config then we wait until there is
     */
    private _lazyLoadAndStart(startReason?: SessionStartReason) {
        // by checking `_isRecordingEnabled` here we know that
        // we have stored remote config and client config to read
        // replay waits for both local and remote config before starting
        if (!this._isRecordingEnabled) {
            return
        }

        if (this._recordingStatus !== AWAITING_CONFIG && this._recordingStatus !== MISSING_CONFIG) {
            this._recordingStatus = LAZY_LOADING
        }

        this._startRequested = true
        if (this._loading) {
            this._startAfterLoad = true
            return
        }
        this._loading = true
        const loading = this._host.loadRecorder(this._scriptName, (err) => {
            try {
                if (
                    this._sessionRecordingDisposed ||
                    !this._startRequested ||
                    !this._isRecordingEnabled ||
                    !this._host.sessionActive
                ) {
                    this._recordingStatus = DISABLED
                    return
                }
                if (err) {
                    this._host.registerSessionProperties({ [SDK_DEBUG_RECORDING_SCRIPT_NOT_LOADED]: true })
                    logger.error('could not load recorder', err)
                    return
                }
                this._onScriptLoaded(startReason)
            } finally {
                this._loading = false
                if (this._startAfterLoad) {
                    this._startAfterLoad = false
                    if (this._startRequested) this.startIfEnabledOrStop(startReason)
                }
            }
        })
        if (loading === false) this._loading = false
    }

    stopRecording() {
        this._startRequested = false
        this._persistFlagsOnSessionListener?.dispose()
        this._persistFlagsOnSessionListener = undefined
        this._lazyLoadedSessionRecording?.stop()
    }

    private _discardRecording(discardProducerEvents = false) {
        this._startRequested = false
        this._persistFlagsOnSessionListener?.dispose()
        this._persistFlagsOnSessionListener = undefined
        this._lazyLoadedSessionRecording?.discard({ discardProducerEvents })
    }

    private _resetSampling() {
        this._persistence?.remove(SESSION_RECORDING_IS_SAMPLED)
        this._persistence?.remove(SESSION_RECORDING_SAMPLE_RATE)
    }

    private _validateSampleRate(rate: unknown, source: string): number | null {
        if (isNullish(rate)) {
            return null
        }
        const parsed = isNumber(rate) ? rate : parseFloat(rate as string)
        if (!isValidSampleRate(parsed)) {
            logger.warn(`${source} must be between 0 and 1. Ignoring invalid value:`, rate)
            return null
        }
        return parsed
    }

    private _persistRemoteConfig(response: DeepReadonly<RemoteConfig>): void {
        if (this._persistence) {
            const persistence = this._persistence

            const persistResponse = () => {
                const sessionRecordingConfigResponse =
                    response.sessionRecording === false ? undefined : response.sessionRecording

                const localSampleRate = this._validateSampleRate(
                    this._config.recording?.sampleRate,
                    'session_recording.sampleRate'
                )
                const remoteSampleRate = this._validateSampleRate(
                    sessionRecordingConfigResponse?.sampleRate,
                    'remote config sampleRate'
                )
                const parsedSampleRate = localSampleRate ?? remoteSampleRate
                if (isNullish(parsedSampleRate)) {
                    this._resetSampling()
                }

                const receivedMinimumDuration = sessionRecordingConfigResponse?.minimumDurationMilliseconds

                persistence.set({
                    [SESSION_RECORDING_REMOTE_CONFIG]: {
                        cache_timestamp: Date.now(),
                        enabled: !!sessionRecordingConfigResponse,
                        ...sessionRecordingConfigResponse,
                        networkPayloadCapture: {
                            capturePerformance: response.capturePerformance,
                            ...sessionRecordingConfigResponse?.networkPayloadCapture,
                        },
                        canvasRecording: {
                            enabled: sessionRecordingConfigResponse?.recordCanvas,
                            fps: sessionRecordingConfigResponse?.canvasFps,
                            quality: sessionRecordingConfigResponse?.canvasQuality,
                        },
                        sampleRate: parsedSampleRate,
                        minimumDurationMilliseconds: isUndefined(receivedMinimumDuration)
                            ? null
                            : receivedMinimumDuration,
                        endpoint: sessionRecordingConfigResponse?.endpoint,
                        triggerMatchType: sessionRecordingConfigResponse?.triggerMatchType,
                        masking: sessionRecordingConfigResponse?.masking,
                        urlTriggers: sessionRecordingConfigResponse?.urlTriggers,
                        // V2 fields - will be undefined for V1 configs
                        version: sessionRecordingConfigResponse?.version,
                        triggerGroups: sessionRecordingConfigResponse?.triggerGroups,
                    } satisfies DeepReadonly<SessionRecordingPersistedConfig>,
                })
            }

            persistResponse()

            // in case we see multiple flags responses, we should only use the response from the most recent one
            this._persistFlagsOnSessionListener?.dispose()
            // we 100% know there is a session manager by this point
            this._persistFlagsOnSessionListener = this._host.onSessionChange(persistResponse)
        }
    }

    onRemoteConfig(result: DeepReadonly<RemoteConfigResult>) {
        if (this._sessionRecordingDisposed || !this._ready) return
        // A failed fetch and a response without a sessionRecording key behave the same:
        // no fresh server config arrived, so fall back to whatever is already persisted.
        const response = result.ok ? result.config : undefined
        if (!response || !('sessionRecording' in response)) {
            if (this._recordingStatus === AWAITING_CONFIG) {
                this._recordingStatus = MISSING_CONFIG
                logger.warn('config refresh failed, recording will not start until page reload')
            }
            this.startIfEnabledOrStop()
            return
        }
        if (response.sessionRecording === false) {
            this._persistRemoteConfig(response)
            this._discardRecording()
            return
        }

        this._persistRemoteConfig(response)
        this.startIfEnabledOrStop()
    }

    log(message: string, level: 'log' | 'warn' | 'error' = 'log') {
        if (this._lazyLoadedSessionRecording?.log) {
            this._lazyLoadedSessionRecording.log(message, level)
        } else {
            logger.warn('log called before recorder was ready')
        }
    }

    private get _scriptName(): string {
        return (
            this._client?.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)?.scriptConfig
                ?.script || 'lazy-recorder'
        )
    }

    private _isRemoteConfigFresh(): boolean {
        const persistedConfig = this._client?.kv.get<SessionRecordingPersistedConfig | string>(
            SESSION_RECORDING_REMOTE_CONFIG
        )
        if (!persistedConfig) {
            return false
        }
        let config: SessionRecordingPersistedConfig
        try {
            config = typeof persistedConfig === 'object' ? persistedConfig : JSON.parse(persistedConfig)
        } catch (e) {
            // Do not unregister here: the SDK only registers structured configs, and this read path should
            // ignore corrupt legacy/external values without mutating persistence.
            logger.warn('persisted remote config for session recording is invalid and will be ignored', e)
            return false
        }
        // configs persisted by SDK versions that predate cache_timestamp have unknown age.
        // Treat them as stale so recording waits for a fresh config instead of starting
        // under arbitrarily old trigger/sampling settings.
        if (isNullish(config.cache_timestamp)) {
            return false
        }
        return Date.now() - config.cache_timestamp <= RECORDING_REMOTE_CONFIG_TTL_MS
    }

    private _onScriptLoaded(startReason?: SessionStartReason) {
        if (this._sessionRecordingDisposed || !this._isRecordingEnabled || !this._host.sessionActive) {
            this._recordingStatus = DISABLED
            return
        }

        if (!this._lazyLoadedSessionRecording) {
            this._lazyLoadedSessionRecording = this._host.createRecorder(
                this._documentWasEverVisible,
                this._forceAllowLocalhostNetworkCapture
            )
        }
        if (!this._lazyLoadedSessionRecording) {
            logger.warn(
                'Called on script loaded before session recording is available. This can be caused by adblockers.'
            )
            this._host.registerSessionProperties({ [SDK_DEBUG_RECORDING_SCRIPT_NOT_LOADED]: true })
            return
        }

        if (!this._isRemoteConfigFresh()) {
            if (this._recordingStatus === MISSING_CONFIG || this._recordingStatus === AWAITING_CONFIG) {
                return
            }
            this._recordingStatus = AWAITING_CONFIG
            logger.info('persisted remote config is stale, requesting fresh config before starting')
            this._host.requestConfigRefresh()
            return
        }

        this._recordingStatus = LAZY_LOADING
        this._lazyLoadedSessionRecording.setDocumentWasEverVisible?.(this._documentWasEverVisible)
        this._lazyLoadedSessionRecording.start(startReason)
    }

    /**
     * this is maintained on the public API only because it has always been on the public API
     * if you are calling this directly you are certainly doing something wrong
     * @deprecated
     */
    onRRwebEmit(rawEvent: eventWithTime) {
        this._lazyLoadedSessionRecording?.onRRwebEmit?.(rawEvent)
    }

    /**
     * this ignores the linked flag config and (if other conditions are met) causes capture to start
     *
     * It is not usual to call this directly,
     * instead call `posthog.startSessionRecording({linked_flag: true})`
     * */
    private _storeOverride(key: string): void {
        if (this._ready) this._client?.kv.set(key, true)
        else this._pendingOverrides[key] = true
    }

    public overrideLinkedFlag() {
        if (!this._lazyLoadedSessionRecording) {
            this._storeOverride(SESSION_RECORDING_OVERRIDE_LINKED_FLAG)
        }

        this._lazyLoadedSessionRecording?.overrideLinkedFlag()
    }

    /**
     * this ignores the sampling config and (if other conditions are met) causes capture to start
     *
     * It is not usual to call this directly,
     * instead call `posthog.startSessionRecording({sampling: true})`
     * */
    public overrideSampling() {
        if (!this._lazyLoadedSessionRecording) {
            this._storeOverride(SESSION_RECORDING_OVERRIDE_SAMPLING)
        }

        this._lazyLoadedSessionRecording?.overrideSampling()
    }

    /**
     * this ignores the URL/Event trigger config and (if other conditions are met) causes capture to start
     *
     * It is not usual to call this directly,
     * instead call `posthog.startSessionRecording({trigger: 'url' | 'event'})`
     * */
    public overrideTrigger(triggerType: TriggerType) {
        if (!this._lazyLoadedSessionRecording) {
            this._storeOverride(
                triggerType === 'url'
                    ? SESSION_RECORDING_OVERRIDE_URL_TRIGGER
                    : SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER
            )
        }

        this._lazyLoadedSessionRecording?.overrideTrigger(triggerType)
    }

    /*
     * whenever we capture an event, we add these properties to the event
     * these are used to debug issues with the session recording
     * when looking at the event feed for a session
     */
    get sdkDebugProperties(): Properties {
        return (
            this._lazyLoadedSessionRecording?.sdkDebugProperties || {
                $recording_status: this.status,
            }
        )
    }

    /**
     * This adds a custom event to the session recording
     *
     * It is not intended for arbitrary public use - playback only displays known custom events
     * And is exposed on the public interface only so that other parts of the SDK are able to use it
     *
     * if you are calling this from client code, you're probably looking for `posthog.capture('$custom_event', {...})`
     */
    tryAddCustomEvent(tag: string, payload: any): boolean {
        return !!this._lazyLoadedSessionRecording?.tryAddCustomEvent(tag, payload)
    }

    flushBeforeIdentityReset(): void {
        this._lazyLoadedSessionRecording?.flushBeforeIdentityReset?.()
    }
}
