/*
 * Constants
 */

/* PROPERTY KEYS */

// This key is deprecated, but we want to check for it to see whether aliasing is allowed.
export const PEOPLE_DISTINCT_ID_KEY = '$people_distinct_id'
export const DISTINCT_ID = 'distinct_id'
export const DEVICE_ID = '$device_id'
export const DEVICE_MODEL = '$device_model'
export const ALIAS_ID_KEY = '__alias'
export const CAMPAIGN_IDS_KEY = '__cmpns'
export const FACEBOOK_CLICK_ID = '$fbc'
export const PERSISTENCE_FACEBOOK_CLICK_ID = '$fbc_persistence'
export const FACEBOOK_BROWSER_ID = '$fbp'
export const PERSISTENCE_FACEBOOK_BROWSER_ID = '$fbp_persistence'
export const EVENT_TIMERS_KEY = '__timers'
export { AUTOCAPTURE_DISABLED_SERVER_SIDE } from '@posthog/browser-common/constants'
export const HEATMAPS_ENABLED_SERVER_SIDE = '$heatmaps_enabled_server_side'
export const EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE = '$exception_capture_enabled_server_side'
export const ERROR_TRACKING_SUPPRESSION_RULES = '$error_tracking_suppression_rules'
export const ERROR_TRACKING_CAPTURE_EXTENSION_EXCEPTIONS = '$error_tracking_capture_extension_exceptions'
export const WEB_VITALS_ENABLED_SERVER_SIDE = '$web_vitals_enabled_server_side'
export const DEAD_CLICKS_ENABLED_SERVER_SIDE = '$dead_clicks_enabled_server_side'
export const PRODUCT_TOURS_ENABLED_SERVER_SIDE = '$product_tours_enabled_server_side'
export const LOGS_CAPTURE_ENABLED_SERVER_SIDE = '$logs_capture_enabled_server_side'
export const WEB_VITALS_ALLOWED_METRICS = '$web_vitals_allowed_metrics'
export { SESSION_RECORDING_REMOTE_CONFIG } from '@posthog/browser-common/replay/constants'
export { RECORDING_REMOTE_CONFIG_TTL_MS } from '@posthog/browser-common/replay/constants'
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
export { SESSION_RECORDING_SAMPLE_RATE } from '@posthog/browser-common/replay/constants'
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_MINIMUM_DURATION = '$replay_minimum_duration'
// @deprecated can be removed along with eager loaded replay
export const SESSION_RECORDING_SCRIPT_CONFIG = '$replay_script_config'
export { SESSION_RECORDING_OVERRIDE_SAMPLING } from '@posthog/browser-common/replay/constants'
export { SESSION_RECORDING_OVERRIDE_LINKED_FLAG } from '@posthog/browser-common/replay/constants'
export { SESSION_RECORDING_OVERRIDE_URL_TRIGGER } from '@posthog/browser-common/replay/constants'
export { SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER } from '@posthog/browser-common/replay/constants'
export const SESSION_ID = '$sesid'
export { SESSION_RECORDING_IS_SAMPLED } from '@posthog/browser-common/replay/constants'
export { SESSION_RECORDING_PAST_MINIMUM_DURATION } from '@posthog/browser-common/replay/constants'
export { SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION } from '@posthog/browser-common/replay/constants'
export { SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION } from '@posthog/browser-common/replay/constants'
// V2 Trigger Groups: Per-group persistence key prefixes (suffix with group ID)
export { SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX } from '@posthog/browser-common/replay/constants'
export { SESSION_RECORDING_TRIGGER_V2_GROUP_URL_PREFIX } from '@posthog/browser-common/replay/constants'
export { SESSION_RECORDING_TRIGGER_V2_GROUP_SAMPLING_PREFIX } from '@posthog/browser-common/replay/constants'
export { SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP } from '@posthog/browser-common/replay/constants'
export { SESSION_RECORDING_FLUSHED_SIZE } from '@posthog/browser-common/replay/constants'
export const GROUPS = '$groups'
export const PRODUCT_TOURS = 'ph_product_tours'
export const PRODUCT_TOURS_ACTIVATED = '$product_tours_activated'
export const PRODUCT_TOURS_ACTIVATED_SESSION = '$product_tours_activated_session'
export const CONVERSATIONS = '$conversations'
export const CONVERSATIONS_LEGACY_WIDGET_SESSION_ID = '$conversations_widget_session_id'
export const CONVERSATIONS_LEGACY_TICKET_ID = '$conversations_ticket_id'
export const CONVERSATIONS_LEGACY_WIDGET_STATE = '$conversations_widget_state'
export const CONVERSATIONS_LEGACY_USER_TRAITS = '$conversations_user_traits'
export const USER_STATE = '$user_state'
export const CLIENT_SESSION_PROPS = '$client_session_props'
export const CAPTURE_RATE_LIMIT = '$capture_rate_limit'

/** @deprecated Delete this when INITIAL_PERSON_INFO has been around for long enough to ignore backwards compat */
export const INITIAL_CAMPAIGN_PARAMS = '$initial_campaign_params'
/** @deprecated Delete this when INITIAL_PERSON_INFO has been around for long enough to ignore backwards compat */
export const INITIAL_REFERRER_INFO = '$initial_referrer_info'
export const INITIAL_PERSON_INFO = '$initial_person_info'
export const ENABLE_PERSON_PROCESSING = '$epp'

/**
 * PREVIEW - MAY CHANGE WITHOUT WARNING - DO NOT USE IN PRODUCTION
 * Sentinel value for distinct id, device id, session id. Signals that the server should generate the value
 * */
export const COOKIELESS_SENTINEL_VALUE = '$posthog_cookieless'
export const COOKIELESS_MODE_FLAG_PROPERTY = '$cookieless_mode'

export const WEB_EXPERIMENTS = '$web_experiments'

export const SDK_DEBUG_EXTENSIONS_INIT_METHOD = '$sdk_debug_extensions_init_method'
export const SDK_DEBUG_EXTENSIONS_INIT_TIME_MS = '$sdk_debug_extensions_init_time_ms'
export { SDK_DEBUG_RECORDING_SCRIPT_NOT_LOADED } from '@posthog/browser-common/replay/constants'
export { SDK_DEBUG_REPLAY_STALE_CONFIG } from '@posthog/browser-common/replay/constants'
export { SDK_DEBUG_REPLAY_EVENT_TRIGGER_STATUS } from '@posthog/browser-common/replay/constants'
export { SDK_DEBUG_REPLAY_LINKED_FLAG_TRIGGER_STATUS } from '@posthog/browser-common/replay/constants'
export { SDK_DEBUG_REPLAY_MATCHED_RECORDING_TRIGGER_GROUPS } from '@posthog/browser-common/replay/constants'
export { SDK_DEBUG_REPLAY_PENDING_TRIGGER_CONDITIONS } from '@posthog/browser-common/replay/constants'
export { SDK_DEBUG_REPLAY_REMOTE_TRIGGER_MATCHING_CONFIG } from '@posthog/browser-common/replay/constants'
export { SDK_DEBUG_REPLAY_TRIGGER_GROUPS_COUNT } from '@posthog/browser-common/replay/constants'
export { SDK_DEBUG_REPLAY_URL_TRIGGER_STATUS } from '@posthog/browser-common/replay/constants'
export { SDK_DEBUG_REPLAY_RRWEB_ATTACHED } from '@posthog/browser-common/replay/constants'
export { SDK_DEBUG_REPLAY_RRWEB_START_ATTEMPTED } from '@posthog/browser-common/replay/constants'
export { SESSION_RECORDING_START_REASON } from '@posthog/browser-common/replay/constants'

export const SURVEYS_REQUEST_TIMEOUT_MS = 10000
export {
    SURVEYS,
    SURVEYS_ACTIVATED,
    SURVEYS_ACTIVATED_SESSION,
    SURVEYS_ACTIVATED_TIMESTAMPS,
    SURVEYS_LOADED_AT,
    SURVEYS_CACHE_TTL_MS,
    SURVEYS_REFRESH_BACKOFF_MS,
    LOAD_EXT_NOT_FOUND,
} from '@posthog/browser-common/surveys-config'

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
export const DOM_EVENT_BEFOREUNLOAD = 'beforeunload'

export const EVENT_PAGEVIEW = '$pageview'
export const EVENT_PAGELEAVE = '$pageleave'
export const EVENT_IDENTIFY = '$identify'
export const EVENT_GROUPIDENTIFY = '$groupidentify'

/* Z-INDEX HIERARCHY: tours > surveys > support */
export const Z_INDEX_TOURS = 2147483646
export const Z_INDEX_SURVEYS = 2147483645
export const Z_INDEX_CONVERSATIONS = 2147483644

export {
    PERSISTENCE_EARLY_ACCESS_FEATURES,
    PERSISTENCE_ACTIVE_FEATURE_FLAGS,
    PERSISTENCE_FEATURE_FLAG_DETAILS,
    PERSISTENCE_FEATURE_FLAG_ERRORS,
    PERSISTENCE_FEATURE_FLAG_EVALUATED_AT,
    PERSISTENCE_FEATURE_FLAG_REQUEST_ID,
    PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS,
    ENABLED_FEATURE_FLAGS,
    STORED_GROUP_PROPERTIES_KEY,
    STORED_PERSON_PROPERTIES_KEY,
    FLAG_CALL_REPORTED,
    FLAG_CALL_REPORTED_SESSION_ID,
    PERSISTENCE_FEATURE_FLAG_PAYLOADS,
    PERSISTENCE_OVERRIDE_FEATURE_FLAGS,
    PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS,
    DOM_EVENT_VISIBILITYCHANGE,
} from '@posthog/browser-common/constants'
