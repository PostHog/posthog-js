/** Persistence and debug-property keys shared by the browser SDKs' session replay implementations. */
export const SESSION_RECORDING_REMOTE_CONFIG = '$session_recording_remote_config'
export const RECORDING_REMOTE_CONFIG_TTL_MS = 1000 * 60 * 60
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_SAMPLE_RATE = '$replay_sample_rate'
export const SESSION_RECORDING_OVERRIDE_SAMPLING = '$replay_override_sampling'
export const SESSION_RECORDING_OVERRIDE_LINKED_FLAG = '$replay_override_linked_flag'
export const SESSION_RECORDING_OVERRIDE_URL_TRIGGER = '$replay_override_url_trigger'
export const SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER = '$replay_override_event_trigger'
export const SESSION_RECORDING_IS_SAMPLED = '$session_is_sampled'
export const SESSION_RECORDING_PAST_MINIMUM_DURATION = '$session_past_minimum_duration'
export const SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION = '$session_recording_url_trigger_activated_session'
export const SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION = '$session_recording_event_trigger_activated_session'
// V2 Trigger Groups: Per-group persistence key prefixes (suffix with group ID)
export const SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX = '$posthog_sr_group_event_trigger_'
export const SESSION_RECORDING_TRIGGER_V2_GROUP_URL_PREFIX = '$posthog_sr_group_url_trigger_'
export const SESSION_RECORDING_TRIGGER_V2_GROUP_SAMPLING_PREFIX = '$posthog_sr_group_sampling_'
export const SDK_DEBUG_REPLAY_EVENT_TRIGGER_STATUS = '$sdk_debug_replay_event_trigger_status'
export const SDK_DEBUG_REPLAY_LINKED_FLAG_TRIGGER_STATUS = '$sdk_debug_replay_linked_flag_trigger_status'
export const SDK_DEBUG_REPLAY_MATCHED_RECORDING_TRIGGER_GROUPS = '$sdk_debug_replay_matched_recording_trigger_groups'
export const SDK_DEBUG_REPLAY_PENDING_TRIGGER_CONDITIONS = '$sdk_debug_replay_pending_trigger_conditions'
export const SDK_DEBUG_REPLAY_REMOTE_TRIGGER_MATCHING_CONFIG = '$sdk_debug_replay_remote_trigger_matching_config'
export const SDK_DEBUG_REPLAY_TRIGGER_GROUPS_COUNT = '$sdk_debug_replay_trigger_groups_count'
export const SDK_DEBUG_REPLAY_URL_TRIGGER_STATUS = '$sdk_debug_replay_url_trigger_status'
export const SESSION_RECORDING_START_REASON = '$session_recording_start_reason'
// sessionStorage key for replay data parked while a recording waits to start; the eager and lazy code both need it
export const PENDING_BUFFER_STORAGE_SUFFIX = '_replay_pending_buffer'

export function getReplayPendingBufferKey(config: { persistence_name?: string; token: string }): string {
    return (
        'ph' +
        PENDING_BUFFER_STORAGE_SUFFIX +
        '_' +
        JSON.stringify([config.persistence_name || config.token, config.token])
    )
}

// session recording statuses, reported as `$recording_status`
export const DISABLED = 'disabled'
export const SAMPLED = 'sampled'
export const ACTIVE = 'active'
export const BUFFERING = 'buffering'
export const PAUSED = 'paused'
export const LAZY_LOADING = 'lazy_loading'
export const AWAITING_CONFIG = 'awaiting_config'
export const MISSING_CONFIG = 'missing_config'
export const RRWEB_ERROR = 'rrweb_error'
