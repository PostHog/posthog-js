/*
 * Event Constants - used to identify builtin events
 * Useful to reduce bundle size by not having to output the entire string for each event
 */

export const PAGEVIEW_EVENT = '$pageview'
export const PAGELEAVE_EVENT = '$pageleave'
export const SCREEN_EVENT = '$screen'

export const AUTOCAPTURE_EVENT = '$autocapture'
export const COPY_AUTOCAPTURE_EVENT = '$copy_autocapture'
export const HEATMAP_EVENT = '$$heatmap'
export const EXCEPTION_EVENT = '$exception'
export const WEB_VITALS_EVENT = '$web_vitals'
export const DEAD_CLICK_EVENT = '$dead_click'
export const SNAPSHOT_EVENT = '$snapshot'
export const RAGECLICK_EVENT = '$rageclick'

export const SET_EVENT = '$set'
export const IDENTIFY_EVENT = '$identify'
export const GROUP_IDENTIFY_EVENT = '$groupidentify'
export const CREATE_ALIAS_EVENT = '$create_alias'

export const OPT_IN_EVENT = '$opt_in'

export const AI_FEEDBACK_EVENT = '$ai_feedback'
export const AI_METRIC_EVENT = '$ai_metric'

export const FEATURE_FLAG_CALLED_EVENT = '$feature_flag_called'
export const FEATURE_ENROLLMENT_UPDATE_EVENT = '$feature_enrollment_update'

export const RATE_LIMIT_EVENT = '$$client_ingestion_warning'

// These don't match the dollar + underscore naming convention,
// but we need to keep them as they're used in the wild
export const SURVEY_SHOWN_EVENT = 'survey shown'
export const SURVEY_SENT_EVENT = 'survey sent'
export const SURVEY_DISMISSED_EVENT = 'survey dismissed'
