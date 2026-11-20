import type { SessionRecordingOptions as PostHogSessionRecordingOptions } from '@posthog/types'
import type { SESSION_RECORDING_REMOTE_CONFIG } from '@posthog/browser-common/replay/replay-constants'

/** Where the remote replay configuration is persisted. Initialization reads it to decide whether to load replay. */
export const SESSION_RECORDING_CONFIG_KEY: typeof SESSION_RECORDING_REMOTE_CONFIG = '$session_recording_remote_config'

/** Recorder privacy and fidelity options shared with posthog-js `session_recording`. */
export type SessionRecordingRecorderOptions = Pick<
    PostHogSessionRecordingOptions,
    | 'blockClass'
    | 'blockSelector'
    | 'ignoreClass'
    | 'maskTextClass'
    | 'maskTextSelector'
    | 'maskTextFn'
    | 'maskAllInputs'
    | 'maskInputOptions'
    | 'maskInputFn'
    | 'maskAllElementAttributes'
    | 'maskAttributeFn'
    | 'slimDOMOptions'
    | 'collectFonts'
    | 'inlineStylesheet'
    | 'recordCrossOriginIframes'
    | 'attributeFilter'
    | 'sampling'
    | 'recordHeaders'
    | 'recordBody'
    | 'maskCapturedNetworkRequestFn'
>

export interface SessionRecordingOptions extends SessionRecordingRecorderOptions {
    /** Load session recording without recording until `startSessionRecording()` runs. Defaults to false. */
    disableSessionRecording?: boolean
    /** Record console logs in replays. Overrides the project setting when set. */
    captureConsoleLogs?: boolean
    /** Record network timing in replays. `false` overrides the project setting. */
    capturePerformance?: boolean
    /**
     * Fraction of sessions to record, between 0 and 1. Overrides the project sample rate when set, but not the sample
     * rates of a project that uses trigger groups.
     */
    sampleRate?: number
    /** Interval between full snapshots while recording, in milliseconds. Defaults to five minutes; 0 disables them. */
    fullSnapshotIntervalMs?: number
    /**
     * Inactivity after which the recording is marked idle and stops sending, in milliseconds. Defaults to five
     * minutes. Recording resumes under the same session when the user interacts again before the session expires.
     */
    sessionIdleThresholdMs?: number
}

export type SessionRecordingConfiguration = false | SessionRecordingOptions

/** Snapshot mutable configuration while retaining callable masking hooks. */
export const snapshotSessionRecordingOptions = (options: SessionRecordingOptions = {}): SessionRecordingOptions => ({
    ...options,
    ...(options.maskInputOptions ? { maskInputOptions: { ...options.maskInputOptions } } : {}),
    ...(options.sampling ? { sampling: { ...options.sampling } } : {}),
    ...(Array.isArray(options.attributeFilter) ? { attributeFilter: [...options.attributeFilter] } : {}),
    ...(options.slimDOMOptions && typeof options.slimDOMOptions === 'object'
        ? { slimDOMOptions: { ...options.slimDOMOptions } }
        : {}),
})
