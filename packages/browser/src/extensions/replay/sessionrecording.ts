import { SESSION_RECORDING_ENABLED_SERVER_SIDE, SESSION_RECORDING_SCRIPT_CONFIG } from '../../constants'
import { PostHog } from '../../posthog-core'
import { Properties, RemoteConfig, SessionStartReason } from '../../types'
import { type eventWithTime } from '@rrweb/types'

import { isUndefined } from '../../utils/type-utils'
import { createLogger } from '../../utils/logger'
import {
    assignableWindow,
    LazyLoadedSessionRecordingInterface,
    PostHogExtensionKind,
    window,
} from '../../utils/globals'
import { DISABLED, LAZY_LOADING, SessionRecordingStatus, TriggerType } from './triggerMatching'

const LOGGER_PREFIX = '[SessionRecording]'
const logger = createLogger(LOGGER_PREFIX)

export class SessionRecording {
    // todo can we improve the API here, folk are using this e.g. for capacitor
    set forceAllowLocalhostNetworkCapture(value: boolean) {
        if ((this._lazyLoadedSessionRecording as any)?._forceAllowLocalhostNetworkCapture) {
            ;(this._lazyLoadedSessionRecording as any)._forceAllowLocalhostNetworkCapture = value
        }
    }

    private _captureStarted: boolean

    private _lazyLoadedSessionRecording: LazyLoadedSessionRecordingInterface | undefined

    public get started(): boolean {
        // TODO could we use status instead of _captureStarted?
        return this._captureStarted
    }

    /**
     * defaults to buffering mode until a flags response is received
     * once a flags response is received status can be disabled, active or sampled
     */
    get status(): SessionRecordingStatus {
        if (!this._isRecordingEnabled) {
            return DISABLED
        }
        return this._lazyLoadedSessionRecording?.status || LAZY_LOADING
    }

    constructor(private readonly _instance: PostHog) {
        this._captureStarted = false

        if (!this._instance.sessionManager) {
            logger.error('started without valid sessionManager')
            throw new Error(LOGGER_PREFIX + ' started without valid sessionManager. This is a bug.')
        }
        if (this._instance.config.cookieless_mode === 'always') {
            throw new Error(LOGGER_PREFIX + ' cannot be used with cookieless_mode="always"')
        }
    }

    private get _isRecordingEnabled() {
        const enabled_server_side = !!this._instance.get_property(SESSION_RECORDING_ENABLED_SERVER_SIDE)
        const enabled_client_side = !this._instance.config.disable_session_recording
        return window && enabled_server_side && enabled_client_side
    }

    startIfEnabledOrStop(startReason?: SessionStartReason) {
        if (this._isRecordingEnabled) {
            this._startCapture(startReason)
        } else {
            this.stopRecording()
        }
    }

    stopRecording() {
        if (this._captureStarted) {
            this._lazyLoadedSessionRecording?.stop()
            this._captureStarted = false
        }
    }

    onRemoteConfig(response: RemoteConfig) {
        // TODO: and what if we get the remote config before we get the lazy loader?
        this._lazyLoadedSessionRecording?.onRemoteConfig(response)
        this.startIfEnabledOrStop()
    }

    log(message: string, level: 'log' | 'warn' | 'error' = 'log') {
        if (this._lazyLoadedSessionRecording?.log) {
            this._lazyLoadedSessionRecording.log(message, level)
        } else {
            logger.warn('log called before recorder was ready')
        }
    }

    private _startCapture(startReason?: SessionStartReason) {
        if (isUndefined(Object.assign) || isUndefined(Array.from)) {
            // According to the rrweb docs, rrweb is not supported on IE11 and below:
            // "rrweb does not support IE11 and below because it uses the MutationObserver API, which was supported by these browsers."
            // https://github.com/rrweb-io/rrweb/blob/master/guide.md#compatibility-note
            //
            // However, MutationObserver does exist on IE11, it just doesn't work well and does not detect all changes.
            // Instead, when we load "recorder.js", the first JS error is about "Object.assign" and "Array.from" being undefined.
            // Thus instead of MutationObserver, we look for this function and block recording if it's undefined.
            return
        }

        // We do not switch recorder versions midway through a recording.
        // do not start if explicitly disabled or if the user has opted out
        if (
            this._captureStarted ||
            this._instance.config.disable_session_recording ||
            this._instance.consent.isOptedOut()
        ) {
            return
        }

        this._captureStarted = true

        // If recorder.js is already loaded (if array.full.js snippet is used or posthog-js/dist/recorder is
        // imported), don't load the script. Otherwise, remotely import recorder.js from cdn since it hasn't been loaded.
        if (!assignableWindow?.__PosthogExtensions__?.rrweb?.record) {
            assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(
                this._instance,
                this._scriptName,
                (err) => {
                    if (err) {
                        return logger.error('could not load recorder', err)
                    }

                    this._onScriptLoaded(startReason)
                }
            )
        } else {
            this._onScriptLoaded(startReason)
        }

        logger.info('starting')
    }

    private get _scriptName(): PostHogExtensionKind {
        return (
            (this._instance?.persistence?.get_property(SESSION_RECORDING_SCRIPT_CONFIG)
                ?.script as PostHogExtensionKind) || 'recorder'
        )
    }

    private _onScriptLoaded(startReason?: SessionStartReason) {
        if (!assignableWindow.__PosthogExtensions__?.initSessionRecording) {
            // TODO make this impossible
            throw Error('Called on script loaded before session recording is available')
        }
        if (!this._lazyLoadedSessionRecording) {
            this._lazyLoadedSessionRecording = assignableWindow.__PosthogExtensions__?.initSessionRecording(
                this._instance,
                this._instance.config
            )
        }

        this._lazyLoadedSessionRecording.start(startReason)
    }

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
        // TODO what if this gets called before lazy loading is done
        this._lazyLoadedSessionRecording?.overrideLinkedFlag()
    }

    /**
     * this ignores the sampling config and (if other conditions are met) causes capture to start
     *
     * It is not usual to call this directly,
     * instead call `posthog.startSessionRecording({sampling: true})`
     * */
    public overrideSampling() {
        // TODO what if this gets called before lazy loading is done
        this._lazyLoadedSessionRecording?.overrideSampling()
    }

    /**
     * this ignores the URL/Event trigger config and (if other conditions are met) causes capture to start
     *
     * It is not usual to call this directly,
     * instead call `posthog.startSessionRecording({trigger: 'url' | 'event'})`
     * */
    public overrideTrigger(triggerType: TriggerType) {
        // TODO what if this gets called before lazy loading is done
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
}
