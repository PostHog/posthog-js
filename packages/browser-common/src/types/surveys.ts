import type {
    SurveyWidgetType,
    SurveyPosition,
    SurveyTabPosition,
    SurveyType,
    SurveyQuestionType,
    SurveyQuestionBranchingType,
    SurveySchedule,
    DisplaySurveyType,
} from '../survey-constants'
export type {
    SurveyEventType,
    SurveyWidgetType,
    SurveyPosition,
    SurveyTabPosition,
    SurveyType,
    SurveyQuestionType,
    SurveyQuestionBranchingType,
    SurveySchedule,
    SurveyEventName,
    SurveyEventProperties,
    DisplaySurveyType,
} from '../survey-constants'
import type { Properties } from '@posthog/types'
import type { SurveyResponseValue as CoreSurveyResponseValue } from '@posthog/core'
import type {
    PropertyMatchType,
    SurveyAppearance as CoreSurveyAppearance,
    SurveyEventWithFilters,
    SurveyQuestionTranslation,
    SurveyTranslation,
    SurveyValidationRule,
} from '@posthog/core'

export type { PropertyFilters, PropertyMatchType, PropertyOperator, SurveyEventWithFilters } from '@posthog/core'

export type SurveyQuestionDescriptionContentType = 'html' | 'text'

/** Browser survey appearance, including browser-only placement and rendering options. */
export interface SurveyAppearance extends Omit<CoreSurveyAppearance, 'position' | 'widgetType'> {
    /** @deprecated Not currently used. */
    descriptionTextColor?: string
    ratingButtonHoverColor?: string
    whiteLabel?: boolean
    tabPosition?: SurveyTabPosition
    fontFamily?: string
    maxWidth?: string
    zIndex?: string
    disabledButtonOpacity?: string
    boxPadding?: string
    /** @deprecated Use `inputBackground` instead. */
    inputBackgroundColor?: string
    hideCancelButton?: boolean
    disableAutofocus?: boolean
    position?: SurveyPosition
    widgetType?: SurveyWidgetType
}

export type SurveyQuestion = BasicSurveyQuestion | LinkSurveyQuestion | RatingSurveyQuestion | MultipleSurveyQuestion

interface SurveyQuestionBase {
    question: string
    id?: string
    description?: string | null
    descriptionContentType?: SurveyQuestionDescriptionContentType
    optional?: boolean
    buttonText?: string
    branching?: NextQuestionBranching | EndBranching | ResponseBasedBranching | SpecificQuestionBranching
    validation?: SurveyValidationRule[]
    translations?: Record<string, SurveyQuestionTranslation>
}

export interface BasicSurveyQuestion extends SurveyQuestionBase {
    type: typeof SurveyQuestionType.Open
}

export interface LinkSurveyQuestion extends SurveyQuestionBase {
    type: typeof SurveyQuestionType.Link
    link?: string | null
}

export interface RatingSurveyQuestion extends SurveyQuestionBase {
    type: typeof SurveyQuestionType.Rating
    display: 'number' | 'emoji'
    scale: 2 | 3 | 5 | 7 | 10
    lowerBoundLabel: string
    upperBoundLabel: string
    skipSubmitButton?: boolean
}

export interface MultipleSurveyQuestion extends SurveyQuestionBase {
    type: typeof SurveyQuestionType.SingleChoice | typeof SurveyQuestionType.MultipleChoice
    choices: string[]
    hasOpenChoice?: boolean
    shuffleOptions?: boolean
    skipSubmitButton?: boolean
}

interface NextQuestionBranching {
    type: typeof SurveyQuestionBranchingType.NextQuestion
}

interface EndBranching {
    type: typeof SurveyQuestionBranchingType.End
}

interface ResponseBasedBranching {
    type: typeof SurveyQuestionBranchingType.ResponseBased
    responseValues: Record<string, any>
}

interface SpecificQuestionBranching {
    type: typeof SurveyQuestionBranchingType.SpecificQuestion
    index: number
}

/** A survey definition returned as part of browser remote config. */
export interface Survey {
    // Sync this with the backend's SurveyAPISerializer.
    id: string
    name: string
    description?: string
    type: SurveyType
    translations?: Record<string, SurveyTranslation>
    feature_flag_keys:
        | {
              key: string
              value?: string
          }[]
        | null
    linked_flag_key: string | null
    targeting_flag_key: string | null
    internal_targeting_flag_key: string | null
    questions: SurveyQuestion[]
    appearance: SurveyAppearance | null
    conditions: {
        url?: string
        selector?: string
        seenSurveyWaitPeriodInDays?: number
        urlMatchType?: PropertyMatchType
        events: {
            repeatedActivation?: boolean
            values: SurveyEventWithFilters[]
        } | null
        cancelEvents: {
            values: SurveyEventWithFilters[]
        } | null
        actions: {
            values: SurveyActionType[]
        } | null
        deviceTypes?: string[]
        deviceTypesMatchType?: PropertyMatchType
        linkedFlagVariant?: string
    } | null
    start_date: string | null
    end_date: string | null
    current_iteration: number | null
    current_iteration_start_date: string | null
    schedule?: SurveySchedule | null
    enable_partial_responses?: boolean | null
}

export type SurveyWithTypeAndAppearance = Pick<Survey, 'id' | 'type' | 'appearance'>

export interface SurveyActionType {
    id: number
    name: string | null
    steps?: ActionStepType[]
}

/** Sync with plugin-server/src/types.ts. */
export type ActionStepStringMatching = 'contains' | 'exact' | 'regex'

export interface ActionStepType {
    event?: string | null
    selector?: string | null
    /** Pre-compiled regex pattern for matching selector against `$elements_chain`. */
    selector_regex?: string | null
    /** @deprecated Only `selector` should be used now. */
    tag_name?: string
    text?: string | null
    /** @default StringMatching.Exact */
    text_matching?: ActionStepStringMatching | null
    href?: string | null
    /** @default StringMatching.Exact */
    href_matching?: ActionStepStringMatching | null
    url?: string | null
    /** @default StringMatching.Contains */
    url_matching?: ActionStepStringMatching | null
    /** Property filters for action step matching. */
    properties?: {
        key: string
        value?: string | number | boolean | (string | number | boolean)[] | null
        operator?: PropertyMatchType
        type?: string
    }[]
}

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
