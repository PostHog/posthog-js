import {
    COOKIELESS_ALWAYS,
    SDK_DEBUG_RECORDING_SCRIPT_NOT_LOADED,
    SESSION_RECORDING_IS_SAMPLED,
    SESSION_RECORDING_SAMPLE_RATE,
    SESSION_RECORDING_OVERRIDE_SAMPLING,
    SESSION_RECORDING_OVERRIDE_LINKED_FLAG,
    SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER,
    SESSION_RECORDING_OVERRIDE_URL_TRIGGER,
    SESSION_RECORDING_REMOTE_CONFIG,
} from '../../constants'
import { PostHog } from '../../posthog-core'
import { RemoteConfigLoader } from '../../remote-config'
import {
    CaptureResult,
    Properties,
    RemoteConfig,
    RemoteConfigResult,
    SessionRecordingPersistedConfig,
    SessionStartReason,
} from '../../types'
import { type eventWithTime } from './types/rrweb-types'

import { isNullish, isNumber, isUndefined, isValidSampleRate } from '@posthog/core'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { document, window } from '@posthog/browser-common/utils/globals'
import { addEventListener } from '@posthog/browser-common/utils/general-utils'
import { assignableWindow, LazyLoadedSessionRecordingInterface, PostHogExtensionKind } from '../../utils/globals'
import { RECORDING_REMOTE_CONFIG_TTL_MS } from './external/lazy-loaded-session-recorder'
import {
    AWAITING_CONFIG,
    DISABLED,
    LAZY_LOADING,
    MISSING_CONFIG,
    SessionRecordingStatus,
    TriggerType,
} from './external/triggerMatching'
import type { Extension } from '../types'

const LOGGER_PREFIX = '[SessionRecording]'
const logger = createLogger(LOGGER_PREFIX)

// only the first events of a pageload need buffering, so this can stay small
const PRE_START_EVENT_BUFFER_LIMIT = 100

const hasDocumentEverBeenVisible = (): boolean => {
    if (!document?.visibilityState || document.visibilityState === 'visible') {
        return true
    }

    const visibilityEntries = window?.performance?.getEntriesByType?.('visibility-state')
    return !visibilityEntries?.length || visibilityEntries.some((entry) => entry.name === 'visible')
}

export class SessionRecording implements Extension {
    _forceAllowLocalhostNetworkCapture: boolean = false

    private _recordingStatus: SessionRecordingStatus = DISABLED

    private get _config() {
        return this._instance.config
    }

    private get _persistence() {
        return this._instance.persistence
    }

    private _persistFlagsOnSessionListener: (() => void) | undefined = undefined
    private _lazyLoadedSessionRecording: LazyLoadedSessionRecordingInterface | undefined
    private _sessionRecordingDisposed = false
    private _documentWasEverVisible = hasDocumentEverBeenVisible()

    // the lazy recorder only registers its trigger listener once its script has loaded; events
    // captured before then (like the initial $pageview) are buffered for replay on start.
    // the session id is stamped at capture time because before_send may rewrite $session_id
    private _eventsCapturedBeforeRecorderStarted: { event: CaptureResult; sessionId: string | undefined }[] = []
    private _removePreStartEventBufferHook: (() => void) | undefined

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

    constructor(private readonly _instance: PostHog) {
        if (!this._instance.sessionManager) {
            logger.error('started without valid sessionManager')
            throw new Error(LOGGER_PREFIX + ' started without valid sessionManager. This is a bug.')
        }

        if (this._config.cookieless_mode === COOKIELESS_ALWAYS) {
            throw new Error(LOGGER_PREFIX + ' cannot be used with cookieless_mode="always"')
        }

        // Start before the recorder chunk loads so a visible -> hidden transition during
        // lazy loading is not mistaken for a document that was never foregrounded.
        if (document?.addEventListener) {
            addEventListener(document, 'visibilitychange', this._onVisibilityChange)
        }

        this._startBufferingPreStartEvents()
    }

    initialize() {
        this.startIfEnabledOrStop()
    }

    dispose(): void {
        this._sessionRecordingDisposed = true
        document?.removeEventListener?.('visibilitychange', this._onVisibilityChange)
        this._stopBufferingPreStartEvents()
        this.stopRecording()
    }

    /** called by the lazy-loaded recorder on start, so pre-start events can be replayed through trigger matching */
    public consumeEventsCapturedBeforeRecorderStarted(): CaptureResult[] {
        const buffered = this._eventsCapturedBeforeRecorderStarted
        this._stopBufferingPreStartEvents()
        // a rotation or reset during the chunk load must not let a previous session's events activate this one
        const sessionId = this._instance.sessionManager?.checkAndGetSessionAndWindowId(true)?.sessionId
        return buffered.filter((entry) => entry.sessionId === sessionId).map((entry) => entry.event)
    }

    private _startBufferingPreStartEvents(): void {
        if (this._removePreStartEventBufferHook || this._sessionRecordingDisposed) {
            return
        }
        this._removePreStartEventBufferHook = this._instance.on?.('eventCaptured', (event) => {
            // $snapshot is recorder output: it can never be a trigger and its payloads are heavy
            if (event.event === '$snapshot') {
                return
            }
            if (this._eventsCapturedBeforeRecorderStarted.length < PRE_START_EVENT_BUFFER_LIMIT) {
                const sessionId = this._instance.sessionManager?.checkAndGetSessionAndWindowId(true)?.sessionId
                this._eventsCapturedBeforeRecorderStarted.push({ event, sessionId })
            }
        })
    }

    private _stopBufferingPreStartEvents(): void {
        this._removePreStartEventBufferHook?.()
        this._removePreStartEventBufferHook = undefined
        this._eventsCapturedBeforeRecorderStarted = []
    }

    private get _isRecordingEnabled() {
        const enabled_server_side = !!this._instance.get_property(SESSION_RECORDING_REMOTE_CONFIG)?.enabled
        const enabled_client_side = !this._config.disable_session_recording
        const isDisabled = this._config.disable_session_recording || this._instance.consent.isOptedOut()
        return window && enabled_server_side && enabled_client_side && !isDisabled
    }

    startIfEnabledOrStop(startReason?: SessionStartReason) {
        if (this._sessionRecordingDisposed) {
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
            // re-arm after a disabled-state teardown so this load window is covered too
            this._startBufferingPreStartEvents()
            this._lazyLoadAndStart(startReason)
            logger.info('starting')
        } else {
            this._recordingStatus = DISABLED
            // before the first remote config arrives recording is merely pending, so only a definitive "off" releases the buffer
            const clientDisabled = this._config.disable_session_recording || this._instance.consent.isOptedOut()
            const serverDecided = !isUndefined(this._instance.get_property(SESSION_RECORDING_REMOTE_CONFIG))
            if (clientDisabled || serverDecided) {
                this._stopBufferingPreStartEvents()
            }
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

        // If the recorder is already loaded, don't load the script. Both halves are needed:
        // `rrweb.record` is the recorder itself, `initSessionRecording` is the code that drives it.
        // The `.full` bundles and `posthog-js/dist/posthog-recorder` (or `dist/lazy-recorder`) define both,
        // so nothing is fetched. Otherwise remotely import the recorder from the cdn.
        if (
            !assignableWindow?.__PosthogExtensions__?.rrweb?.record ||
            !assignableWindow.__PosthogExtensions__?.initSessionRecording
        ) {
            const loadExternalDependency = assignableWindow.__PosthogExtensions__?.loadExternalDependency
            if (!loadExternalDependency) {
                // no loader and no recorder imported: recording can never start
                this._stopBufferingPreStartEvents()
                return
            }
            loadExternalDependency(this._instance, this._scriptName, (err) => {
                if (err) {
                    this._stopBufferingPreStartEvents()
                    // most often this is an ad blocker matching the `/static/<script>.js` path.
                    // flag it on the session so a blocked recorder is visible in analytics
                    // instead of only in the browser console
                    this._instance.register_for_session({
                        [SDK_DEBUG_RECORDING_SCRIPT_NOT_LOADED]: true,
                    })
                    return logger.error('could not load recorder', err)
                }
                this._onScriptLoaded(startReason)
            })
        } else {
            this._onScriptLoaded(startReason)
        }
    }

    stopRecording() {
        this._persistFlagsOnSessionListener?.()
        this._persistFlagsOnSessionListener = undefined
        this._lazyLoadedSessionRecording?.stop()
    }

    private _discardRecording() {
        this._persistFlagsOnSessionListener?.()
        this._persistFlagsOnSessionListener = undefined
        this._lazyLoadedSessionRecording?.discard()
    }

    private _resetSampling() {
        this._persistence?.unregister(SESSION_RECORDING_IS_SAMPLED)
        this._persistence?.unregister(SESSION_RECORDING_SAMPLE_RATE)
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

    private _persistRemoteConfig(response: RemoteConfig): void {
        if (this._persistence) {
            const persistence = this._persistence

            const persistResponse = () => {
                const sessionRecordingConfigResponse =
                    response.sessionRecording === false ? undefined : response.sessionRecording

                const localSampleRate = this._validateSampleRate(
                    this._config.session_recording?.sampleRate,
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

                persistence.register({
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
                    } satisfies SessionRecordingPersistedConfig,
                })
            }

            persistResponse()

            // in case we see multiple flags responses, we should only use the response from the most recent one
            this._persistFlagsOnSessionListener?.()
            // we 100% know there is a session manager by this point
            this._persistFlagsOnSessionListener = this._instance.sessionManager?.onSessionId(persistResponse)
        }
    }

    onRemoteConfig(result: RemoteConfigResult) {
        // A failed fetch and a response without a sessionRecording key behave the same:
        // no fresh server config arrived, so fall back to whatever is already persisted.
        const response = result.ok ? result.config : undefined
        if (!response || !('sessionRecording' in response)) {
            if (this._recordingStatus === AWAITING_CONFIG) {
                this._recordingStatus = MISSING_CONFIG
                logger.warn('config refresh failed, recording will not start until page reload')
            }
            this.startIfEnabledOrStop()
            if (!this._isRecordingEnabled) {
                // nothing persisted can start the recorder, so nothing will consume the buffer before reload
                this._stopBufferingPreStartEvents()
            }
            return
        }
        if (response.sessionRecording === false) {
            this._persistRemoteConfig(response)
            this._discardRecording()
            this._stopBufferingPreStartEvents()
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

    private get _scriptName(): PostHogExtensionKind {
        const remoteConfig: SessionRecordingPersistedConfig | undefined = this._instance?.persistence?.get_property(
            SESSION_RECORDING_REMOTE_CONFIG
        )
        return (remoteConfig?.scriptConfig?.script as PostHogExtensionKind) || 'lazy-recorder'
    }

    private _isRemoteConfigFresh(): boolean {
        const persistedConfig = this._instance.get_property(SESSION_RECORDING_REMOTE_CONFIG)
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
        if (this._sessionRecordingDisposed) {
            return
        }

        if (!assignableWindow.__PosthogExtensions__?.initSessionRecording) {
            logger.warn(
                'Called on script loaded before session recording is available. This can be caused by adblockers.'
            )
            this._stopBufferingPreStartEvents()
            this._instance.register_for_session({
                [SDK_DEBUG_RECORDING_SCRIPT_NOT_LOADED]: true,
            })
            return
        }

        if (!this._lazyLoadedSessionRecording) {
            this._lazyLoadedSessionRecording = assignableWindow.__PosthogExtensions__?.initSessionRecording(
                this._instance,
                this._documentWasEverVisible
            )
            ;(this._lazyLoadedSessionRecording as any)._forceAllowLocalhostNetworkCapture =
                this._forceAllowLocalhostNetworkCapture
        }

        if (!this._isRemoteConfigFresh()) {
            if (this._recordingStatus === MISSING_CONFIG) {
                // a config refresh already failed; recording will not start until page reload
                this._stopBufferingPreStartEvents()
                return
            }
            if (this._recordingStatus === AWAITING_CONFIG) {
                // a fresh config is on its way; keep buffering until it arrives
                return
            }
            this._recordingStatus = AWAITING_CONFIG
            logger.info('persisted remote config is stale, requesting fresh config before starting')
            new RemoteConfigLoader(this._instance).load()
            return
        }

        this._recordingStatus = LAZY_LOADING
        this._lazyLoadedSessionRecording.setDocumentWasEverVisible?.(this._documentWasEverVisible)
        this._lazyLoadedSessionRecording.start(startReason)
        // an older recorder chunk may never consume the buffer
        this._stopBufferingPreStartEvents()
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
    public overrideLinkedFlag() {
        if (!this._lazyLoadedSessionRecording) {
            this._persistence?.register({
                [SESSION_RECORDING_OVERRIDE_LINKED_FLAG]: true,
            })
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
            this._persistence?.register({
                [SESSION_RECORDING_OVERRIDE_SAMPLING]: true,
            })
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
            this._persistence?.register({
                [triggerType === 'url'
                    ? SESSION_RECORDING_OVERRIDE_URL_TRIGGER
                    : SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER]: true,
            })
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
}
