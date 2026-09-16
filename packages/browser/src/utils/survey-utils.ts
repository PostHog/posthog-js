import { isFunction } from '@posthog/core'
import type { PostHog } from '../posthog-core'
export {
    doesSurveyActivateByEvent,
    getSurveyInteractionProperty,
    isSurveyIterationBased,
    SURVEY_LOGGER,
    SURVEY_CAPTURING_DISABLED,
    isSurveyRunning,
    doesSurveyActivateByAction,
    SURVEY_SEEN_PREFIX,
    SURVEY_IN_PROGRESS_PREFIX,
    SURVEY_ABANDONED_PREFIX,
    getSurveyStorageKey,
    getSurveySeenKey,
    getSurveyAbandonedKey,
    setSurveySeenOnLocalStorage,
    IN_APP_SURVEY_TYPES,
    DEFAULT_DISPLAY_SURVEY_OPTIONS,
} from '@posthog/browser-common/utils/survey-utils'

/**
 * `is_capturing()` was only added to the core in 1.260.0, and a newly deployed surveys bundle can
 * still be loaded by an older cached core, so calling it directly would throw on every display
 * poll. Fall back to that core's own consent gate: those versions have no cookieless mode, so
 * `!has_opted_out_capturing()` is what `is_capturing()` would return there anyway.
 */
export function isCapturingEnabled(posthog: Pick<PostHog, 'is_capturing' | 'has_opted_out_capturing'>): boolean {
    return isFunction(posthog.is_capturing) ? posthog.is_capturing() : !posthog.has_opted_out_capturing()
}
