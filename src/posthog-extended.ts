import {
    _copyAndTruncateStrings,
    _each,
    _eachArray,
    _extend,
    _includes,
    _register_event,
    _safewrap_class,
} from './utils'
import {
    SESSION_RECORDING_IS_SAMPLED,
} from './constants'
import { SessionRecording } from './extensions/replay/sessionrecording'
import { Toolbar } from './extensions/toolbar'
import { userOptedOut } from './gdpr-utils'
import { RequestRouter } from './utils/request-router'
import {
    PostHogConfig,
    Properties,
    RequestCallback,
    SessionIdChangedCallback,
    ToolbarParams,
} from './types'
import { SentryIntegration } from './extensions/sentry-integration'
import { createSegmentIntegration } from './extensions/segment-integration'
import { PostHogSurveys } from './posthog-surveys'
import { SurveyCallback } from './posthog-surveys-types'
import {
    _isArray,
    _isEmptyObject,
    _isEmptyString,
    _isFunction,
    _isNumber,
    _isObject,
    _isString,
    _isUndefined,
} from './utils/type-utils'
import { _info } from './utils/event-utils'
import { logger } from './utils/logger'
import { _isBlockedUA } from './utils/blocked-uas'
import { Autocapture } from './autocapture'
import { POSTHOG_INSTANCES, PostHogCore } from './posthog-core'


class DeprecatedWebPerformanceObserver {
    get _forceAllowLocalhost(): boolean {
        return this.__forceAllowLocalhost
    }

    set _forceAllowLocalhost(value: boolean) {
        logger.error(
            'WebPerformanceObserver is deprecated and has no impact on network capture. Use `_forceAllowLocalhostNetworkCapture` on `posthog.sessionRecording`'
        )
        this.__forceAllowLocalhost = value
    }

    private __forceAllowLocalhost: boolean = false
}

/**
 * PostHogExtended
 * 
 * Anything that is considered "extended" should be here. Core functionality is only around standard capture and feature flags logic
 * @constructor
 */
export class PostHogExtended extends PostHogCore {
    protected _Cls = PostHogExtended
    surveys: PostHogSurveys
    toolbar: Toolbar
    autocapture?: Autocapture
    sessionRecording?: SessionRecording
    webPerformance = new DeprecatedWebPerformanceObserver()

    SentryIntegration = SentryIntegration
    segmentIntegration: () => any

    /** DEPRECATED: We keep this to support existing usage but now one should just call .setPersonProperties */
    people: {
        set: (prop: string | Properties, to?: string, callback?: RequestCallback) => void
        set_once: (prop: string | Properties, to?: string, callback?: RequestCallback) => void
    }

    constructor() {
        super()
        this.segmentIntegration = () => createSegmentIntegration(this)
        this.toolbar = new Toolbar(this)
        this.surveys = new PostHogSurveys(this)
        this.requestRouter = new RequestRouter(this)

        // NOTE: See the property definition for deprecation notice
        this.people = {
            set: (prop: string | Properties, to?: string, callback?: RequestCallback) => {
                const setProps = _isString(prop) ? { [prop]: to } : prop
                this.setPersonProperties(setProps)
                callback?.({} as any)
            },
            set_once: (prop: string | Properties, to?: string, callback?: RequestCallback) => {
                const setProps = _isString(prop) ? { [prop]: to } : prop
                this.setPersonProperties(undefined, setProps)
                callback?.({} as any)
            },
        }
    }

    init(
        token: string,
        config?: any,
        name?: string
    ): PostHogCore | void {
        if (!name || name === "posthog") {
            // This means we are initializing the primary instance (i.e. this)
            return this._init(token, config, name)
        } else {
            const namedPosthog = POSTHOG_INSTANCES[name] ?? new PostHogExtended()
            namedPosthog._init(token, config, name)
            POSTHOG_INSTANCES[name] = namedPosthog
            // Add as a property to the primary instance (this isn't type-safe but its how it was always done)
            ;(POSTHOG_INSTANCES["posthog"] as any)[name] = namedPosthog

            return namedPosthog
        }
    }

    _init(token: string, config: Partial<PostHogConfig> = {}, name?: string): PostHogExtended {
        super._init(token, config, name)

        // TODO: Detect if the parent needed loading...
        this.sessionRecording = new SessionRecording(this)
        this.sessionRecording.startRecordingIfEnabled()
        this.autocapture = new Autocapture(this)
        this.toolbar.maybeLoadToolbar()

        return this
    }

    /*
     * Register an event listener that runs whenever the session id or window id change.
     * If there is already a session id, the listener is called immediately in addition to being called on future changes.
     *
     * Can be used, for example, to sync the PostHog session id with a backend session.
     *
     * ### Usage:
     *
     *     posthog.onSessionId(function(sessionId, windowId) { // do something })
     *
     * @param {Function} [callback] The callback function will be called once a session id is present or when it or the window id are updated.
     * @returns {Function} A function that can be called to unsubscribe the listener. E.g. Used by useEffect when the component unmounts.
     */
    onSessionId(callback: SessionIdChangedCallback): () => void {
        return this.sessionManager?.onSessionId(callback) ?? (() => {})
    }

    /** Get list of all surveys. */
    getSurveys(callback: SurveyCallback, forceReload = false): void {
        this.surveys.getSurveys(callback, forceReload)
    }

    /** Get surveys that should be enabled for the current user. */
    getActiveMatchingSurveys(callback: SurveyCallback, forceReload = false): void {
        this.surveys.getActiveMatchingSurveys(callback, forceReload)
    }

    /**
     * Returns the Replay url for the current session.
     *
     * @param options Options for the url
     * @param options.withTimestamp Whether to include the timestamp in the url (defaults to false)
     * @param options.timestampLookBack How many seconds to look back for the timestamp (defaults to 10)
     */
    get_session_replay_url(options?: { withTimestamp?: boolean; timestampLookBack?: number }): string {
        if (!this.sessionManager) {
            return ''
        }
        const { sessionId, sessionStartTimestamp } = this.sessionManager.checkAndGetSessionAndWindowId(true)
        let url = this.requestRouter.endpointFor('ui', `/project/${this.config.token}/replay/${sessionId}`)
        if (options?.withTimestamp && sessionStartTimestamp) {
            const LOOK_BACK = options.timestampLookBack ?? 10
            if (!sessionStartTimestamp) {
                return url
            }
            const recordingStartTime = Math.max(
                Math.floor((new Date().getTime() - sessionStartTimestamp) / 1000) - LOOK_BACK,
                0
            )
            url += `?t=${recordingStartTime}`
        }

        return url
    }

    // Override
    set_config(config: Partial<PostHogConfig>): void {
        const oldConfig = { ...this.config }

        super.set_config(config)

        if (_isObject(config)) {
            if (this.sessionRecording && !_isUndefined(config.disable_session_recording)) {
                const disable_session_recording_has_changed =
                    oldConfig.disable_session_recording !== config.disable_session_recording
                // if opting back in, this config might not have changed
                const try_enable_after_opt_in =
                    !userOptedOut(this) && !config.disable_session_recording && !this.sessionRecording.started

                if (disable_session_recording_has_changed || try_enable_after_opt_in) {
                    if (config.disable_session_recording) {
                        this.sessionRecording.stopRecording()
                    } else {
                        this.sessionRecording.startRecordingIfEnabled()
                    }
                }
            }
        }
    }

    /**
     * turns session recording on, and updates the config option
     * disable_session_recording to false
     * @param override.sampling - optional boolean to override the default sampling behavior - ensures the next session recording to start will not be skipped by sampling config.
     */
    startSessionRecording(override?: { sampling?: boolean }): void {
        if (override?.sampling) {
            // allow the session id check to rotate session id if necessary
            const ids = this.sessionManager?.checkAndGetSessionAndWindowId()
            this.persistence?.register({
                // short-circuits the `makeSamplingDecision` function in the session recording module
                [SESSION_RECORDING_IS_SAMPLED]: true,
            })
            logger.info('Session recording started with sampling override for session: ', ids?.sessionId)
        }
        this.set_config({ disable_session_recording: false })
    }

    /**
     * turns session recording off, and updates the config option
     * disable_session_recording to true
     */
    stopSessionRecording(): void {
        this.set_config({ disable_session_recording: true })
    }

    /**
     * returns a boolean indicating whether session recording
     * is currently running
     */
    sessionRecordingStarted(): boolean {
        return !!this.sessionRecording?.started
    }

    /**
     * returns a boolean indicating whether the toolbar loaded
     * @param toolbarParams
     */

    loadToolbar(params: ToolbarParams): boolean {
        return this.toolbar.loadToolbar(params)
    }
}
