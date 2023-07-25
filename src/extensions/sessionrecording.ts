import {
    CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE,
} from '../posthog-persistence'
import { PostHog } from '../posthog-core'
import { DecideResponse, ISessionRecording, Properties, recordOptions, rrwebRecord } from '../types'
import type { eventWithTime } from '@rrweb/types'
import Config from '../config'
import { logger, loadScript, _timestamp } from '../utils'

export class SessionRecordingPlaceholder implements ISessionRecording {
    protected decideResponse: DecideResponse | null = null
    protected captureStarted = false

    constructor(protected instance: PostHog) {}

    stopRecording() {}
    log(_message: string, _level: 'log' | 'warn' | 'error' = 'log') {}
    onRRwebEmit(_rawEvent: eventWithTime) {}

    startRecordingIfEnabled() {
        if (this.isRecordingEnabled()) {
            this.startCapture()
        }
    }

    started() {
        return this.captureStarted
    }

    isRecordingEnabled() {
        const enabled_server_side = !!this.instance.get_property(SESSION_RECORDING_ENABLED_SERVER_SIDE)
        const enabled_client_side = !this.instance.get_config('disable_session_recording')
        return enabled_server_side && enabled_client_side
    }

    isConsoleLogCaptureEnabled() {
        const enabled_server_side = !!this.instance.get_property(CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE)
        const enabled_client_side = this.instance.get_config('enable_recording_console_log')
        return enabled_client_side ?? enabled_server_side
    }

    getRecordingVersion() {
        const recordingVersion_server_side = this.instance.get_property(SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE)
        const recordingVersion_client_side = this.instance.get_config('session_recording')?.recorderVersion
        return recordingVersion_client_side || recordingVersion_server_side || 'v1'
    }

    afterDecideResponse(response: DecideResponse) {
        this.decideResponse = response
        if (this.instance.persistence) {
            this.instance.persistence.register({
                [SESSION_RECORDING_ENABLED_SERVER_SIDE]: !!response['sessionRecording'],
                [CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE]: response.sessionRecording?.consoleLogRecordingEnabled,
                [SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE]: response.sessionRecording?.recorderVersion,
            })
        }

        this.startRecordingIfEnabled()
    }

    protected startCapture() {
        // We load the recorder.js which includes any custom code we have with regards to session replay.

        if (this.captureStarted) {
            return
        }

        this.captureStarted = true

        if (typeof Object.assign === 'undefined') {
            // According to the rrweb docs, rrweb is not supported on IE11 and below:
            // "rrweb does not support IE11 and below because it uses the MutationObserver API which was supported by these browsers."
            // https://github.com/rrweb-io/rrweb/blob/master/guide.md#compatibility-note
            //
            // However, MutationObserver does exist on IE11, it just doesn't work well and does not detect all changes.
            // Instead, when we load "recorder.js", the first JS error is about "Object.assign" being undefined.
            // Thus instead of MutationObserver, we look for this function and block recording if it's undefined.
            return
        }

        // // We want to ensure the sessionManager is reset if necessary on load of the recorder
        // this.instance.sessionManager.checkAndGetSessionAndWindowId()

        const recorderJS = this.getRecordingVersion() === 'v2' ? 'recorder-v2.js' : 'recorder.js'

        // If recorder.js is already loaded (if array.full.js snippet is used or posthog-js/dist/recorder is
        // imported) or matches the requested recorder version, don't load script. Otherwise, remotely import
        // recorder.js from cdn since it hasn't been loaded.
        if (this.instance.__loaded_recorder_version !== this.getRecordingVersion()) {
            loadScript(
                this.instance.get_config('api_host') + `/static/${recorderJS}?v=${Config.LIB_VERSION}`,
                (err) => {
                    if (err) {
                        return logger.error(`Could not load ${recorderJS}`, err)
                    }

                    this._onScriptLoaded()
                }
            )
        } else {
            this._onScriptLoaded()
        }
    }

    private _onScriptLoaded() {
        // Load from the window and replace this object on the posthog instance.
    }
}
