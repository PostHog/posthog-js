import {
    ALIAS_ID_KEY,
    AUTOCAPTURE_DISABLED_SERVER_SIDE,
    CAMPAIGN_IDS_KEY,
    CAPTURE_RATE_LIMIT,
    CLIENT_SESSION_PROPS,
    CONVERSATIONS_LEGACY_TICKET_ID,
    CONVERSATIONS_LEGACY_USER_TRAITS,
    CONVERSATIONS_LEGACY_WIDGET_SESSION_ID,
    CONVERSATIONS_LEGACY_WIDGET_STATE,
    DEAD_CLICKS_ENABLED_SERVER_SIDE,
    ENABLE_PERSON_PROCESSING,
    ENABLED_FEATURE_FLAGS,
    ERROR_TRACKING_CAPTURE_EXTENSION_EXCEPTIONS,
    ERROR_TRACKING_SUPPRESSION_RULES,
    EVENT_TIMERS_KEY,
    EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE,
    FLAG_CALL_REPORTED,
    FLAG_CALL_REPORTED_SESSION_ID,
    HEATMAPS_ENABLED_SERVER_SIDE,
    INITIAL_CAMPAIGN_PARAMS,
    INITIAL_PERSON_INFO,
    INITIAL_REFERRER_INFO,
    PEOPLE_DISTINCT_ID_KEY,
    PERSISTENCE_ACTIVE_FEATURE_FLAGS,
    PERSISTENCE_EARLY_ACCESS_FEATURES,
    PERSISTENCE_FEATURE_FLAG_DETAILS,
    PERSISTENCE_FEATURE_FLAG_ERRORS,
    PERSISTENCE_FEATURE_FLAG_EVALUATED_AT,
    PERSISTENCE_FEATURE_FLAG_PAYLOADS,
    PERSISTENCE_FEATURE_FLAG_REQUEST_ID,
    PERSISTENCE_OVERRIDE_FEATURE_FLAGS,
    PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS,
    PRODUCT_TOURS,
    PRODUCT_TOURS_ACTIVATED,
    PRODUCT_TOURS_ENABLED_SERVER_SIDE,
    SDK_DEBUG_EXTENSIONS_INIT_METHOD,
    SDK_DEBUG_EXTENSIONS_INIT_TIME_MS,
    SDK_DEBUG_RECORDING_SCRIPT_NOT_LOADED,
    SDK_DEBUG_REPLAY_EVENT_TRIGGER_STATUS,
    SDK_DEBUG_REPLAY_LINKED_FLAG_TRIGGER_STATUS,
    SDK_DEBUG_REPLAY_MATCHED_RECORDING_TRIGGER_GROUPS,
    SDK_DEBUG_REPLAY_REMOTE_TRIGGER_MATCHING_CONFIG,
    SDK_DEBUG_REPLAY_TRIGGER_GROUPS_COUNT,
    SDK_DEBUG_REPLAY_URL_TRIGGER_STATUS,
    SESSION_ID,
    SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION,
    SESSION_RECORDING_START_REASON,
    SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP,
    SESSION_RECORDING_IS_SAMPLED,
    SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER,
    SESSION_RECORDING_OVERRIDE_LINKED_FLAG,
    SESSION_RECORDING_OVERRIDE_SAMPLING,
    SESSION_RECORDING_OVERRIDE_URL_TRIGGER,
    SESSION_RECORDING_PAST_MINIMUM_DURATION,
    SESSION_RECORDING_REMOTE_CONFIG,
    SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX,
    SESSION_RECORDING_TRIGGER_V2_GROUP_SAMPLING_PREFIX,
    SESSION_RECORDING_TRIGGER_V2_GROUP_URL_PREFIX,
    SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    STORED_GROUP_PROPERTIES_KEY,
    STORED_PERSON_PROPERTIES_KEY,
    SURVEYS,
    SURVEYS_ACTIVATED,
    USER_STATE,
    WEB_VITALS_ALLOWED_METRICS,
    WEB_VITALS_ENABLED_SERVER_SIDE,
} from './constants'
import { transformEnabledFeatureFlagsToEventProperties } from './persistence-key-transforms'
import type { Properties, Property } from './types'

export type PersistenceKeyExposure = 'event' | 'hidden' | 'derived'

interface DerivedPersistenceKeyPolicyContext {
    isFeatureFlagCacheStale: () => boolean
}

interface PersistenceKeyPolicyEntry {
    exposure: PersistenceKeyExposure
    transformToEventProperties?: (value: Property, context: DerivedPersistenceKeyPolicyContext) => Properties
}

export const PERSISTENCE_KEY_POLICY: Record<string, PersistenceKeyPolicyEntry> = {
    [PEOPLE_DISTINCT_ID_KEY]: { exposure: 'hidden' },
    [ALIAS_ID_KEY]: { exposure: 'hidden' },
    [CAMPAIGN_IDS_KEY]: { exposure: 'hidden' },
    [EVENT_TIMERS_KEY]: { exposure: 'hidden' },
    [AUTOCAPTURE_DISABLED_SERVER_SIDE]: { exposure: 'hidden' },
    [HEATMAPS_ENABLED_SERVER_SIDE]: { exposure: 'hidden' },
    [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: { exposure: 'hidden' },
    [ERROR_TRACKING_SUPPRESSION_RULES]: { exposure: 'hidden' },
    [ERROR_TRACKING_CAPTURE_EXTENSION_EXCEPTIONS]: { exposure: 'hidden' },
    [WEB_VITALS_ENABLED_SERVER_SIDE]: { exposure: 'hidden' },
    [DEAD_CLICKS_ENABLED_SERVER_SIDE]: { exposure: 'hidden' },
    [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: { exposure: 'hidden' },
    [WEB_VITALS_ALLOWED_METRICS]: { exposure: 'hidden' },
    [SESSION_RECORDING_REMOTE_CONFIG]: { exposure: 'hidden' },
    [SESSION_RECORDING_ENABLED_SERVER_SIDE]: { exposure: 'hidden' },
    [SESSION_ID]: { exposure: 'hidden' },
    [SESSION_RECORDING_IS_SAMPLED]: { exposure: 'hidden' },
    [SESSION_RECORDING_PAST_MINIMUM_DURATION]: { exposure: 'hidden' },
    [SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION]: { exposure: 'hidden' },
    [SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION]: { exposure: 'hidden' },
    [SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP]: { exposure: 'hidden' },
    [ENABLED_FEATURE_FLAGS]: {
        exposure: 'derived',
        transformToEventProperties: transformEnabledFeatureFlagsToEventProperties,
    },
    [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: { exposure: 'hidden' },
    [PERSISTENCE_EARLY_ACCESS_FEATURES]: { exposure: 'hidden' },
    [PERSISTENCE_FEATURE_FLAG_DETAILS]: { exposure: 'hidden' },
    [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: { exposure: 'event' },
    [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: { exposure: 'hidden' },
    [PERSISTENCE_OVERRIDE_FEATURE_FLAGS]: { exposure: 'hidden' },
    [PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS]: { exposure: 'hidden' },
    [STORED_PERSON_PROPERTIES_KEY]: { exposure: 'hidden' },
    [STORED_GROUP_PROPERTIES_KEY]: { exposure: 'hidden' },
    [SURVEYS]: { exposure: 'hidden' },
    [SURVEYS_ACTIVATED]: { exposure: 'event' },
    [PRODUCT_TOURS]: { exposure: 'hidden' },
    [PRODUCT_TOURS_ACTIVATED]: { exposure: 'hidden' },
    [CONVERSATIONS_LEGACY_WIDGET_SESSION_ID]: { exposure: 'hidden' },
    [CONVERSATIONS_LEGACY_TICKET_ID]: { exposure: 'hidden' },
    [CONVERSATIONS_LEGACY_WIDGET_STATE]: { exposure: 'hidden' },
    [CONVERSATIONS_LEGACY_USER_TRAITS]: { exposure: 'hidden' },
    [FLAG_CALL_REPORTED]: { exposure: 'hidden' },
    [FLAG_CALL_REPORTED_SESSION_ID]: { exposure: 'hidden' },
    [PERSISTENCE_FEATURE_FLAG_ERRORS]: { exposure: 'hidden' },
    [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: { exposure: 'hidden' },
    [USER_STATE]: { exposure: 'hidden' },
    [CLIENT_SESSION_PROPS]: { exposure: 'hidden' },
    [CAPTURE_RATE_LIMIT]: { exposure: 'hidden' },
    [INITIAL_CAMPAIGN_PARAMS]: { exposure: 'hidden' },
    [INITIAL_REFERRER_INFO]: { exposure: 'hidden' },
    [INITIAL_PERSON_INFO]: { exposure: 'hidden' },
    [ENABLE_PERSON_PROCESSING]: { exposure: 'hidden' },
    [SESSION_RECORDING_OVERRIDE_SAMPLING]: { exposure: 'hidden' },
    [SESSION_RECORDING_OVERRIDE_LINKED_FLAG]: { exposure: 'hidden' },
    [SESSION_RECORDING_OVERRIDE_URL_TRIGGER]: { exposure: 'hidden' },
    [SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER]: { exposure: 'hidden' },
    [SDK_DEBUG_EXTENSIONS_INIT_METHOD]: { exposure: 'event' },
    [SDK_DEBUG_EXTENSIONS_INIT_TIME_MS]: { exposure: 'event' },
    [SDK_DEBUG_RECORDING_SCRIPT_NOT_LOADED]: { exposure: 'event' },
    [SDK_DEBUG_REPLAY_EVENT_TRIGGER_STATUS]: { exposure: 'event' },
    [SDK_DEBUG_REPLAY_LINKED_FLAG_TRIGGER_STATUS]: { exposure: 'event' },
    [SDK_DEBUG_REPLAY_MATCHED_RECORDING_TRIGGER_GROUPS]: { exposure: 'event' },
    [SDK_DEBUG_REPLAY_REMOTE_TRIGGER_MATCHING_CONFIG]: { exposure: 'event' },
    [SDK_DEBUG_REPLAY_TRIGGER_GROUPS_COUNT]: { exposure: 'event' },
    [SDK_DEBUG_REPLAY_URL_TRIGGER_STATUS]: { exposure: 'event' },
    [SESSION_RECORDING_START_REASON]: { exposure: 'event' },
}

export const PERSISTENCE_KEY_PREFIX_POLICY: Array<[string, PersistenceKeyPolicyEntry]> = [
    [SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX, { exposure: 'hidden' }],
    [SESSION_RECORDING_TRIGGER_V2_GROUP_URL_PREFIX, { exposure: 'hidden' }],
    [SESSION_RECORDING_TRIGGER_V2_GROUP_SAMPLING_PREFIX, { exposure: 'hidden' }],
]

export const getPersistenceKeyPolicy = (key: string): PersistenceKeyPolicyEntry | undefined => {
    const exactMatch = PERSISTENCE_KEY_POLICY[key]
    if (exactMatch) {
        return exactMatch
    }

    for (const [prefix, policy] of PERSISTENCE_KEY_PREFIX_POLICY) {
        if (key.startsWith(prefix)) {
            return policy
        }
    }

    return undefined
}
