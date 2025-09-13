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
export const HEATMAPS_ENABLED_SERVER_SIDE = '$heatmaps_enabled_server_side'
export const EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE = '$exception_capture_enabled_server_side'
export const ERROR_TRACKING_SUPPRESSION_RULES = '$error_tracking_suppression_rules'
export const ERROR_TRACKING_CAPTURE_EXTENSION_EXCEPTIONS = '$error_tracking_capture_extension_exceptions'
export const WEB_VITALS_ENABLED_SERVER_SIDE = '$web_vitals_enabled_server_side'
export const DEAD_CLICKS_ENABLED_SERVER_SIDE = '$dead_clicks_enabled_server_side'
export const WEB_VITALS_ALLOWED_METRICS = '$web_vitals_allowed_metrics'
export const SESSION_RECORDING_REMOTE_CONFIG = '$session_recording_remote_config'
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_ENABLED_SERVER_SIDE = '$session_recording_enabled_server_side'
// @deprecated can be removed along with eager loaded replay
export const CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE = '$console_log_recording_enabled_server_side'
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_NETWORK_PAYLOAD_CAPTURE = '$session_recording_network_payload_capture'
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_MASKING = '$session_recording_masking'
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_CANVAS_RECORDING = '$session_recording_canvas_recording'
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_SAMPLE_RATE = '$replay_sample_rate'
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_MINIMUM_DURATION = '$replay_minimum_duration'
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_SCRIPT_CONFIG = '$replay_script_config'
export const SESSION_ID = '$sesid'
export const SESSION_RECORDING_IS_SAMPLED = '$session_is_sampled'
export const SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION = '$session_recording_url_trigger_activated_session'
export const SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION = '$session_recording_event_trigger_activated_session'
export const ENABLED_FEATURE_FLAGS = '$enabled_feature_flags'
export const PERSISTENCE_EARLY_ACCESS_FEATURES = '$early_access_features'
export const PERSISTENCE_FEATURE_FLAG_DETAILS = '$feature_flag_details'
export const STORED_PERSON_PROPERTIES_KEY = '$stored_person_properties'
export const STORED_GROUP_PROPERTIES_KEY = '$stored_group_properties'
export const SURVEYS = '$surveys'
export const SURVEYS_ACTIVATED = '$surveys_activated'
export const FLAG_CALL_REPORTED = '$flag_call_reported'
export const USER_STATE = '$user_state'
export const CLIENT_SESSION_PROPS = '$client_session_props'
export const CAPTURE_RATE_LIMIT = '$capture_rate_limit'

/** @deprecated Delete this when INITIAL_PERSON_INFO has been around for long enough to ignore backwards compat */
export const INITIAL_CAMPAIGN_PARAMS = '$initial_campaign_params'
/** @deprecated Delete this when INITIAL_PERSON_INFO has been around for long enough to ignore backwards compat */
export const INITIAL_REFERRER_INFO = '$initial_referrer_info'
export const INITIAL_PERSON_INFO = '$initial_person_info'
export const ENABLE_PERSON_PROCESSING = '$epp'
export const TOOLBAR_ID = '__POSTHOG_TOOLBAR__'
export const TOOLBAR_CONTAINER_CLASS = 'toolbar-global-fade-container'

/**
 * PREVIEW - MAY CHANGE WITHOUT WARNING - DO NOT USE IN PRODUCTION
 * Sentinel value for distinct id, device id, session id. Signals that the server should generate the value
 * */
export const COOKIELESS_SENTINEL_VALUE = '$posthog_cookieless'
export const COOKIELESS_MODE_FLAG_PROPERTY = '$cookieless_mode'

export const WEB_EXPERIMENTS = '$web_experiments'

// These are properties that are reserved and will not be automatically included in events
export const PERSISTENCE_RESERVED_PROPERTIES = [
    PEOPLE_DISTINCT_ID_KEY,
    ALIAS_ID_KEY,
    CAMPAIGN_IDS_KEY,
    EVENT_TIMERS_KEY,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    HEATMAPS_ENABLED_SERVER_SIDE,
    SESSION_ID,
    ENABLED_FEATURE_FLAGS,
    ERROR_TRACKING_SUPPRESSION_RULES,
    USER_STATE,
    PERSISTENCE_EARLY_ACCESS_FEATURES,
    PERSISTENCE_FEATURE_FLAG_DETAILS,
    STORED_GROUP_PROPERTIES_KEY,
    STORED_PERSON_PROPERTIES_KEY,
    SURVEYS,
    FLAG_CALL_REPORTED,
    CLIENT_SESSION_PROPS,
    CAPTURE_RATE_LIMIT,
    INITIAL_CAMPAIGN_PARAMS,
    INITIAL_REFERRER_INFO,
    ENABLE_PERSON_PROCESSING,
    INITIAL_PERSON_INFO,
]

export const SURVEYS_REQUEST_TIMEOUT_MS = 10000
