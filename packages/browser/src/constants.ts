/*
 * Constants
 */

/* PROPERTY KEYS */

// This key is deprecated, but we want to check for it to see whether aliasing is allowed.
export const PEOPLE_DISTINCT_ID_KEY = '$people_distinct_id'
export const DISTINCT_ID = 'distinct_id'
export const DEVICE_ID = '$device_id'
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
export const PRODUCT_TOURS_ENABLED_SERVER_SIDE = '$product_tours_enabled_server_side'
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
export const SESSION_RECORDING_OVERRIDE_SAMPLING = '$replay_override_sampling'
export const SESSION_RECORDING_OVERRIDE_LINKED_FLAG = '$replay_override_linked_flag'
export const SESSION_RECORDING_OVERRIDE_URL_TRIGGER = '$replay_override_url_trigger'
export const SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER = '$replay_override_event_trigger'
export const SESSION_ID = '$sesid'
export const SESSION_RECORDING_IS_SAMPLED = '$session_is_sampled'
export const SESSION_RECORDING_PAST_MINIMUM_DURATION = '$session_past_minimum_duration'
export const SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION = '$session_recording_url_trigger_activated_session'
export const SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION = '$session_recording_event_trigger_activated_session'
// V2 Trigger Groups: Per-group persistence key prefixes (suffix with group ID)
export const SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX = '$posthog_sr_group_event_trigger_'
export const SESSION_RECORDING_TRIGGER_V2_GROUP_URL_PREFIX = '$posthog_sr_group_url_trigger_'
export const SESSION_RECORDING_TRIGGER_V2_GROUP_SAMPLING_PREFIX = '$posthog_sr_group_sampling_'
export const SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP = '$debug_first_full_snapshot_timestamp'
export const ENABLED_FEATURE_FLAGS = '$enabled_feature_flags'
export const PERSISTENCE_ACTIVE_FEATURE_FLAGS = '$active_feature_flags'
export const PERSISTENCE_EARLY_ACCESS_FEATURES = '$early_access_features'
export const PERSISTENCE_FEATURE_FLAG_DETAILS = '$feature_flag_details'
export const PERSISTENCE_FEATURE_FLAG_PAYLOADS = '$feature_flag_payloads'
export const PERSISTENCE_FEATURE_FLAG_REQUEST_ID = '$feature_flag_request_id'
export const PERSISTENCE_OVERRIDE_FEATURE_FLAGS = '$override_feature_flags'
export const PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS = '$override_feature_flag_payloads'
export const STORED_PERSON_PROPERTIES_KEY = '$stored_person_properties'
export const STORED_GROUP_PROPERTIES_KEY = '$stored_group_properties'
export const SURVEYS = '$surveys'
export const SURVEYS_ACTIVATED = '$surveys_activated'
export const PRODUCT_TOURS = 'ph_product_tours'
export const PRODUCT_TOURS_ACTIVATED = '$product_tours_activated'
export const CONVERSATIONS = '$conversations'
export const CONVERSATIONS_LEGACY_WIDGET_SESSION_ID = '$conversations_widget_session_id'
export const CONVERSATIONS_LEGACY_TICKET_ID = '$conversations_ticket_id'
export const CONVERSATIONS_LEGACY_WIDGET_STATE = '$conversations_widget_state'
export const CONVERSATIONS_LEGACY_USER_TRAITS = '$conversations_user_traits'
export const FLAG_CALL_REPORTED = '$flag_call_reported'
export const FLAG_CALL_REPORTED_SESSION_ID = '$flag_call_reported_session_id'
export const PERSISTENCE_FEATURE_FLAG_ERRORS = '$feature_flag_errors'
export const PERSISTENCE_FEATURE_FLAG_EVALUATED_AT = '$feature_flag_evaluated_at'
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

export const SDK_DEBUG_EXTENSIONS_INIT_METHOD = '$sdk_debug_extensions_init_method'
export const SDK_DEBUG_EXTENSIONS_INIT_TIME_MS = '$sdk_debug_extensions_init_time_ms'
export const SDK_DEBUG_RECORDING_SCRIPT_NOT_LOADED = '$sdk_debug_recording_script_not_loaded'
export const SDK_DEBUG_REPLAY_EVENT_TRIGGER_STATUS = '$sdk_debug_replay_event_trigger_status'
export const SDK_DEBUG_REPLAY_LINKED_FLAG_TRIGGER_STATUS = '$sdk_debug_replay_linked_flag_trigger_status'
export const SDK_DEBUG_REPLAY_MATCHED_RECORDING_TRIGGER_GROUPS = '$sdk_debug_replay_matched_recording_trigger_groups'
export const SDK_DEBUG_REPLAY_REMOTE_TRIGGER_MATCHING_CONFIG = '$sdk_debug_replay_remote_trigger_matching_config'
export const SDK_DEBUG_REPLAY_TRIGGER_GROUPS_COUNT = '$sdk_debug_replay_trigger_groups_count'
export const SDK_DEBUG_REPLAY_URL_TRIGGER_STATUS = '$sdk_debug_replay_url_trigger_status'
export const SESSION_RECORDING_START_REASON = '$session_recording_start_reason'

export const SURVEYS_REQUEST_TIMEOUT_MS = 10000
export const LOAD_EXT_NOT_FOUND = 'PostHog loadExternalDependency extension not found.'

/* EVENT NAMES - interned to reduce bundle size */
/* COOKIELESS MODE VALUES */
export const COOKIELESS_ON_REJECT = 'on_reject' as const
export const COOKIELESS_ALWAYS = 'always' as const

/* USER STATE VALUES */
export const USER_STATE_ANONYMOUS = 'anonymous'
export const USER_STATE_IDENTIFIED = 'identified'

/* PERSON PROFILE MODES */
export const PERSON_PROFILES_IDENTIFIED_ONLY = 'identified_only' as const

/* DOM EVENT NAMES - interned to reduce bundle size */
export const DOM_EVENT_VISIBILITYCHANGE = 'visibilitychange'
export const DOM_EVENT_BEFOREUNLOAD = 'beforeunload'

export const EVENT_PAGEVIEW = '$pageview'
export const EVENT_PAGELEAVE = '$pageleave'
export const EVENT_IDENTIFY = '$identify'
export const EVENT_GROUPIDENTIFY = '$groupidentify'

/* Z-INDEX HIERARCHY: tours > surveys > support */
export const Z_INDEX_TOURS = 2147483646
export const Z_INDEX_SURVEYS = 2147483645
export const Z_INDEX_CONVERSATIONS = 2147483644
