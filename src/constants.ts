/*
 * Constants
 */

/* PROPERTY KEYS */

// This key is deprecated, but we want to check for it to see whether aliasing is allowed.
export const PEOPLE_DISTINCT_ID_KEY = '$people_distinct_id'
export const DISTINCT_ID = 'distinct_id'
export const ALIAS_ID_KEY = '__alias'
export const CAMPAIGN_IDS_KEY = '__cmpns'
export const EVENT_TIMERS_KEY = '__timers'
export const AUTOCAPTURE_DISABLED_SERVER_SIDE = '$autocapture_disabled_server_side'
export const SESSION_RECORDING_ENABLED_SERVER_SIDE = '$session_recording_enabled_server_side'
export const CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE = '$console_log_recording_enabled_server_side'
export const SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE = '$session_recording_recorder_version_server_side' // follows rrweb versioning
export const SESSION_RECORDING_SAMPLE_RATE = '$session_recording_sample_rate'
export const SESSION_RECORDING_SAMPLING_EXCLUDED = '$session_recording_sampling_excluded'
export const SESSION_ID = '$sesid'
export const ENABLED_FEATURE_FLAGS = '$enabled_feature_flags'
export const PERSISTENCE_EARLY_ACCESS_FEATURES = '$early_access_features'
export const STORED_PERSON_PROPERTIES_KEY = '$stored_person_properties'
export const STORED_GROUP_PROPERTIES_KEY = '$stored_group_properties'
export const SURVEYS = '$surveys'
export const FLAG_CALL_REPORTED = '$flag_call_reported'
export const USER_STATE = '$user_state'
export const POSTHOG_QUOTA_LIMITED = '$posthog_quota_limited'

// These are propertties that are reserved and will not be automatically included in events
export const PERSISTENCE_RESERVED_PROPERTIES = [
    PEOPLE_DISTINCT_ID_KEY,
    ALIAS_ID_KEY,
    CAMPAIGN_IDS_KEY,
    EVENT_TIMERS_KEY,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_ID,
    ENABLED_FEATURE_FLAGS,
    USER_STATE,
    POSTHOG_QUOTA_LIMITED,
    PERSISTENCE_EARLY_ACCESS_FEATURES,
    STORED_GROUP_PROPERTIES_KEY,
    STORED_PERSON_PROPERTIES_KEY,
    SURVEYS,
    FLAG_CALL_REPORTED,
]
