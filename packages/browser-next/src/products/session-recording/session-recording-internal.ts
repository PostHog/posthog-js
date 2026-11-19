import type { BrowserExtension } from '../../core/context/browser-client'

/**
 * Ingestion controls that `startSessionRecording()` treats as satisfied for the current session. They apply to the
 * project's sample rate, linked flag and triggers, not to the per-group decisions of a project that uses trigger groups.
 */
export interface SessionRecordingOverride {
    /** Record even when the session was sampled out. */
    sampling?: boolean
    /** Record even when the linked feature flag does not match. */
    linkedFlag?: boolean
    /** Record without waiting for a URL trigger. */
    urlTrigger?: boolean
    /** Record without waiting for an event trigger. */
    eventTrigger?: boolean
}

export interface SessionReplayUrlOptions {
    /** Add a `t` parameter that starts playback near the current time. */
    withTimestamp?: boolean
    /** Seconds to start playback before the current time. Defaults to 10. */
    timestampLookBack?: number
}

export interface SessionRecordingExtension extends BrowserExtension {
    /**
     * Starts or resumes session recording when the project enables it. Pass `true` to bypass sampling, the linked
     * flag and triggers for the current session, or an object to bypass some of them. Overrides do not apply to a
     * project that uses trigger groups, whose groups decide sampling, linked flags and triggers themselves.
     */
    startSessionRecording(override?: true | SessionRecordingOverride): void
    /** Stops session recording after sending buffered replay data. Recording resumes on `startSessionRecording()`. */
    stopSessionRecording(): void
    /** Whether the recorder is currently running. */
    sessionRecordingStarted(): boolean
    /** Link to the current session's replay in PostHog, or an empty string when there is no session. */
    getSessionReplayUrl(options?: SessionReplayUrlOptions): string
}
