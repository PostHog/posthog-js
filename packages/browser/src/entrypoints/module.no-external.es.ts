import './default-extensions'
import { init_as_module } from '../posthog-core'

export { PostHog } from '../posthog-core'
export * from '../types'
export {
    DisplaySurveyType,
    SurveyEventName,
    SurveyEventProperties,
    SurveyEventType,
    SurveyPosition,
    SurveyQuestionBranchingType,
    SurveyQuestionType,
    SurveySchedule,
    SurveyTabPosition,
    SurveyType,
    SurveyWidgetType,
} from '@posthog/browser-common'
export type {
    PropertyOperator,
    PropertyFilters,
    SurveyEventWithFilters,
    SurveyAppearance,
    SurveyQuestion,
    SurveyQuestionDescriptionContentType,
    BasicSurveyQuestion,
    LinkSurveyQuestion,
    RatingSurveyQuestion,
    MultipleSurveyQuestion,
    Survey,
    SurveyWithTypeAndAppearance,
    SurveyActionType,
    ActionStepStringMatching,
    ActionStepType,
    SurveyCallback,
    SurveyElement,
    SurveyRenderReason,
    DisplaySurveyPopoverOptions,
    DisplaySurveyOptions,
    SurveyConfig,
    SurveyResponseValue,
} from '@posthog/browser-common'
export * from '../posthog-product-tours-types'
export * from '../posthog-conversations-types'

/**
 * The default PostHog JavaScript Web SDK singleton instance.
 */
export const posthog = init_as_module()
export default posthog
