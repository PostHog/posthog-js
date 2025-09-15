import { SESSION_RECORDING_ENABLED_SERVER_SIDE, SESSION_RECORDING_SCRIPT_CONFIG } from '../../constants'
import { PostHog } from '../../posthog-core'
import { Properties, RemoteConfig, SessionStartReason } from '../../types'
import { type eventWithTime } from '@rrweb/types'

import { isUndefined } from '@posthog/core'
import { createLogger } from '../../utils/logger'
import {
    assignableWindow,
    LazyLoadedSessionRecordingInterface,
    PostHogExtensionKind,
    window,
} from '../../utils/globals'
import { LAZY_LOADING, SessionRecordingStatus, TriggerType } from './triggerMatching'

const LOGGER_PREFIX = '[SessionRecording]'
const logger = createLogger(LOGGER_PREFIX)

/**
 * This only exists to let us test changes to sessionrecording.ts before rolling them out to everyone
 * it should not be depended on in other ways, since i'm going to delete it long before the end of September 2025
 */
export class SessionRecordingWrapper {
    _forceAllowLocalhostNetworkCapture: boolean = false

    private _lazyLoadedSessionRecording: LazyLoadedSessionRecordingInterface | undefined
    private _pendingRemoteConfig: RemoteConfig | undefined

    public get started(): boolean {
        return !!this._lazyLoadedSessionRecording?.isStarted
    }

    /**
     * defaults to buffering mode until a flags response is received
     * once a flags response is received status can be disabled, active or sampled
     */
    get status(): SessionRecordingStatus {
        return this._lazyLoadedSessionRecording?.status || LAZY_LOADING
    }

    constructor(private readonly _instance: PostHog) {
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
        const isDisabled = this._instance.config.disable_session_recording || this._instance.consent.isOptedOut()
        return window && enabled_server_side && enabled_client_side && !isDisabled
    }

    startIfEnabledOrStop(startReason?: SessionStartReason) {
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

        // If recorder.js is already loaded (if array.full.js snippet is used or posthog-js/dist/recorder is
        // imported), don't load the script. Otherwise, remotely import recorder.js from cdn since it hasn't been loaded.
        if (
            !assignableWindow?.__PosthogExtensions__?.rrweb?.record ||
            !assignableWindow.__PosthogExtensions__?.initSessionRecording
        ) {
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
    }

    stopRecording() {
        this._lazyLoadedSessionRecording?.stop()
    }

    onRemoteConfig(response: RemoteConfig) {
        this._pendingRemoteConfig = response

        const persistence = this._instance.persistence
        if (persistence) {
            persistence.register({
                [SESSION_RECORDING_ENABLED_SERVER_SIDE]: !!response.sessionRecording,
                [SESSION_RECORDING_SCRIPT_CONFIG]: response.sessionRecording?.scriptConfig,
            })
        }

        if (!this._lazyLoadedSessionRecording) {
            this._lazyLoadAndStart()
        } else {
            this._lazyLoadedSessionRecording.onRemoteConfig(response)
            this._pendingRemoteConfig = undefined
        }
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
        return (
            (this._instance?.persistence?.get_property(SESSION_RECORDING_SCRIPT_CONFIG)
                ?.script as PostHogExtensionKind) || 'lazy-recorder'
        )
    }

    private _onScriptLoaded(startReason?: SessionStartReason) {
        if (!assignableWindow.__PosthogExtensions__?.initSessionRecording) {
            throw Error('Called on script loaded before session recording is available')
        }

        if (!this._lazyLoadedSessionRecording) {
            this._lazyLoadedSessionRecording = assignableWindow.__PosthogExtensions__?.initSessionRecording(
                this._instance
            )
            ;(this._lazyLoadedSessionRecording as any)._forceAllowLocalhostNetworkCapture =
                this._forceAllowLocalhostNetworkCapture

            // If we have a pending remote config, apply it now
            if (this._pendingRemoteConfig) {
                this._lazyLoadedSessionRecording.onRemoteConfig(this._pendingRemoteConfig)
                // Clear the pending config after applying it
                this._pendingRemoteConfig = undefined
            }
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
