/*
 * Constants
 */

/* PROPERTY KEYS */

// minification is important so we do a little code golf with repeated strings
// even x + y is smaller than `${x}{y}`
const $ = '$'
const SESSION = 'session'
const RECORDING = 'recording'
const SESSION_RECORDING = $ + SESSION + '_' + RECORDING
const ENABLED_SERVER_SIDE = '_enabled_server_side'
const INITIAL = $ + 'initial_'
const STORED = $ + 'stored_'
const ERROR_TRACKING = 'error_tracking'
const WEB_VITALS = 'web_vitals'
const PROPERTIES = '_properties'
const REPLAY = 'replay'
const COOKIELESS = 'cookieless'
const FLAG = 'flag'
const FEATURE_FLAG = 'feature_' + FLAG
const TRIGGER_ACTIVATED = '_trigger_activated_'

// This key is deprecated, but we want to check for it to see whether aliasing is allowed.
export const PEOPLE_DISTINCT_ID_KEY = $ + 'people_distinct_id'
export const DISTINCT_ID = 'distinct_id'
export const ALIAS_ID_KEY = '__alias'
export const CAMPAIGN_IDS_KEY = '__cmpns'
export const EVENT_TIMERS_KEY = '__timers'
export const AUTOCAPTURE_DISABLED_SERVER_SIDE = $ + 'autocapture_disabled_server_side'
export const HEATMAPS_ENABLED_SERVER_SIDE = $ + 'heatmaps' + ENABLED_SERVER_SIDE
export const EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE = $ + 'exception_capture' + ENABLED_SERVER_SIDE
export const ERROR_TRACKING_SUPPRESSION_RULES = $ + ERROR_TRACKING + '_suppression_rules'
export const ERROR_TRACKING_CAPTURE_EXTENSION_EXCEPTIONS = $ + ERROR_TRACKING + '_capture_extension_exceptions'
export const WEB_VITALS_ENABLED_SERVER_SIDE = $ + WEB_VITALS + ENABLED_SERVER_SIDE
export const DEAD_CLICKS_ENABLED_SERVER_SIDE = $ + 'dead_clicks' + ENABLED_SERVER_SIDE
export const WEB_VITALS_ALLOWED_METRICS = $ + WEB_VITALS + '_allowed_metrics'
export const SESSION_RECORDING_REMOTE_CONFIG = SESSION_RECORDING + '_remote_config'
export const SESSION_RECORDING_FLUSHED_SIZE = SESSION_RECORDING + '_flushed'
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_ENABLED_SERVER_SIDE = SESSION_RECORDING + ENABLED_SERVER_SIDE
// @deprecated can be removed along with eager loaded replay
export const CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE = $ + 'console_log_' + RECORDING + ENABLED_SERVER_SIDE
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_NETWORK_PAYLOAD_CAPTURE = SESSION_RECORDING + '_network_payload_capture'
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_MASKING = SESSION_RECORDING + '_masking'
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_CANVAS_RECORDING = SESSION_RECORDING + '_canvas_' + RECORDING
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_SAMPLE_RATE = $ + REPLAY + '_sample_rate'
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_MINIMUM_DURATION = $ + REPLAY + '_minimum_duration'
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_SCRIPT_CONFIG = $ + REPLAY + '_script_config'
export const SESSION_ID = $ + 'sesid'
export const SESSION_RECORDING_IS_SAMPLED = SESSION + '_is_sampled'
export const SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION = SESSION_RECORDING + '_url' + TRIGGER_ACTIVATED + SESSION
export const SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION =
    SESSION_RECORDING + '_event' + TRIGGER_ACTIVATED + SESSION
export const ENABLED_FEATURE_FLAGS = $ + 'enabled_' + FEATURE_FLAG + 's'
export const PERSISTENCE_EARLY_ACCESS_FEATURES = $ + 'early_access_features'
export const PERSISTENCE_FEATURE_FLAG_DETAILS = $ + FEATURE_FLAG + '_details'
export const STORED_PERSON_PROPERTIES_KEY = STORED + 'person' + PROPERTIES
export const STORED_GROUP_PROPERTIES_KEY = STORED + 'group' + PROPERTIES
export const SURVEYS = $ + 'surveys'
export const SURVEYS_ACTIVATED = SURVEYS + '_activated'
export const FLAG_CALL_REPORTED = $ + FLAG + '_call_reported'
export const USER_STATE = $ + 'user_state'
export const CLIENT_SESSION_PROPS = $ + 'client_' + SESSION + '_props'
export const CAPTURE_RATE_LIMIT = $ + 'capture_rate_limit'

/** @deprecated Delete this when INITIAL_PERSON_INFO has been around for long enough to ignore backwards compat */
export const INITIAL_CAMPAIGN_PARAMS = INITIAL + 'campaign_params'
/** @deprecated Delete this when INITIAL_PERSON_INFO has been around for long enough to ignore backwards compat */
export const INITIAL_REFERRER_INFO = INITIAL + 'referrer_info'
export const INITIAL_PERSON_INFO = INITIAL + 'person_info'
export const ENABLE_PERSON_PROCESSING = '$epp'
export const TOOLBAR_ID = '__POSTHOG_TOOLBAR__'
export const TOOLBAR_CONTAINER_CLASS = 'toolbar-global-fade-container'

/**
 * PREVIEW - MAY CHANGE WITHOUT WARNING - DO NOT USE IN PRODUCTION
 * Sentinel value for distinct id, device id, session id. Signals that the server should generate the value
 * */
export const COOKIELESS_SENTINEL_VALUE = $ + 'posthog_' + COOKIELESS
export const COOKIELESS_MODE_FLAG_PROPERTY = $ + COOKIELESS + '_mode'

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
