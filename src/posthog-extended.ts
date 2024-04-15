import {
    _copyAndTruncateStrings,
    _each,
    _eachArray,
    _extend,
    _includes,
    _register_event,
    _safewrap_class,
} from './utils'
import { userAgent } from './utils/globals'
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
import { SUPPORTS_REQUEST } from './request'
import { Autocapture } from './autocapture'
import { PostHogCore } from './posthog-core'

/*
SIMPLE STYLE GUIDE:

this.x === public function
this._x === internal - only use within this file
this.__x === private - only use within the class

Globals should be all caps
*/

/* posthog.init is called with `Partial<PostHogConfig>`
 * and we want to ensure that only valid keys are passed to the config object.
 * TypeScript does not enforce that the object passed does not have extra keys.
 * So someone can call with { bootstrap: { distinctId: '123'} }
 * which is not a valid key. They should have passed distinctID (upper case D).
 * That's a really tricky mistake to spot.
 * The OnlyValidKeys type ensures that only keys that are valid in the PostHogConfig type are allowed.
 */


/*
 * Dynamic... constants? Is that an oxymoron?
 */
// http://hacks.mozilla.org/2009/07/cross-site-xmlhttprequest-with-cors/
// https://developer.mozilla.org/en-US/docs/DOM/XMLHttpRequest#withCredentials

// IE<10 does not support cross-origin XHR's but script tags
// with defer won't block window.onload; ENQUEUE_REQUESTS
// should only be true for Opera<12
let ENQUEUE_REQUESTS = !SUPPORTS_REQUEST && userAgent?.indexOf('MSIE') === -1 && userAgent?.indexOf('Mozilla') === -1


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


    // posthog._init(token:string, config:object, name:string)
    //
    // This function sets up the current instance of the posthog
    // library.  The difference between this method and the init(...)
    // method is this one initializes the actual instance, whereas the
    // init(...) method sets up a new library and calls _init on it.
    //
    // Note that there are operations that can be asynchronous, so we
    // accept a callback that is called when all the asynchronous work
    // is done. Note that we do not use promises because we want to be
    // IE11 compatible. We could use polyfills, which would make the
    // code a bit cleaner, but will add some overhead.
    //
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
