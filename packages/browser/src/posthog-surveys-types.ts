/**
 * Having Survey types in types.ts was confusing tsc
 * and generating an invalid module.d.ts
 * See https://github.com/PostHog/posthog-js/issues/698
 */

import type { Properties } from './types'
import type { SurveyResponseValue as CoreSurveyResponseValue } from '@posthog/core'
import {
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
    type Survey,
} from '@posthog/browser-common'

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
}

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
} from '@posthog/browser-common'

export type SurveyCallback = (surveys: Survey[], context?: { isLoaded: boolean; error?: string }) => void

export interface SurveyElement {
    text?: string
    $el_text?: string
    tag_name?: string
    href?: string
    attr_id?: string
    attr_class?: string[]
    nth_child?: number
    nth_of_type?: number
    attributes?: Record<string, any>
    event_id?: number
    order?: number
    group_id?: number
}

// Re-export from @posthog/types to avoid duplication
export type { SurveyRenderReason } from '@posthog/types'

interface DisplaySurveyOptionsBase {
    /**
     * Whether to bypass the survey's targeting and display conditions.
     * @default false
     */
    ignoreConditions: boolean

    /**
     * Whether to bypass the survey's configured popup delay.
     * @default false
     */
    ignoreDelay: boolean

    /**
     * How the survey should be displayed.
     * @default DisplaySurveyType.Popover
     */
    displayType: DisplaySurveyType

    /** Additional properties to include in all survey events (shown, sent, dismissed). */
    properties?: Properties

    /** Pre-filled responses by question index (0-based). Only supported for popover surveys. */
    initialResponses?: Record<number, SurveyResponseValue>
}

/** Options for displaying a survey as a popover. */
export interface DisplaySurveyPopoverOptions extends DisplaySurveyOptionsBase {
    displayType: typeof DisplaySurveyType.Popover
    /** Override the survey's configured position. */
    position?: SurveyPosition
    /** CSS selector for the element to position the survey next to (when position is NextToTrigger). */
    selector?: string
    /** When true, `survey shown` events will not be emitted automatically. */
    skipShownEvent?: boolean
}

interface DisplaySurveyInlineOptions extends DisplaySurveyOptionsBase {
    displayType: typeof DisplaySurveyType.Inline
    /** CSS selector for the element where the inline survey should render. */
    selector: string
}

/** Options for `posthog.displaySurvey()`. */
export type DisplaySurveyOptions = DisplaySurveyPopoverOptions | DisplaySurveyInlineOptions

export interface SurveyConfig {
    /**
     * Prefill survey responses from matching URL parameters.
     *
     * @default undefined
     */
    prefillFromUrl?: boolean
    /**
     * @deprecated No longer used. Surveys will automatically advance past
     * prefilled questions with skipSubmitButton enabled. If partial response
     * collection is enabled, partial responses for pre-filled questions will
     * be submitted automatically on page load.
     */
    autoSubmitIfComplete?: boolean
    /**
     * @deprecated No longer used. Pre-filled responses are now sent
     * immediately when partial responses are enabled, or all required
     * questions have been pre-filled.
     */
    autoSubmitDelay?: number
}

export type SurveyResponseValue = CoreSurveyResponseValue
