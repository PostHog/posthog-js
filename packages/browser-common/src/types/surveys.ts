import type {
    SurveyAppearance as CoreSurveyAppearance,
    SurveyQuestionTranslation,
    SurveyTranslation,
    SurveyValidationRule,
} from '@posthog/core'

export const SurveyEventType = {
    Activation: 'events',
    Cancellation: 'cancelEvents',
} as const
export type SurveyEventType = (typeof SurveyEventType)[keyof typeof SurveyEventType]

export const SurveyWidgetType = {
    Button: 'button',
    Tab: 'tab',
    Selector: 'selector',
} as const
export type SurveyWidgetType = (typeof SurveyWidgetType)[keyof typeof SurveyWidgetType]

export const SurveyPosition = {
    TopLeft: 'top_left',
    TopRight: 'top_right',
    TopCenter: 'top_center',
    MiddleLeft: 'middle_left',
    MiddleRight: 'middle_right',
    MiddleCenter: 'middle_center',
    Left: 'left',
    Center: 'center',
    Right: 'right',
    NextToTrigger: 'next_to_trigger',
} as const
export type SurveyPosition = (typeof SurveyPosition)[keyof typeof SurveyPosition]

export const SurveyTabPosition = {
    Top: 'top',
    Left: 'left',
    Right: 'right',
    Bottom: 'bottom',
} as const
export type SurveyTabPosition = (typeof SurveyTabPosition)[keyof typeof SurveyTabPosition]

export const SurveyType = {
    Popover: 'popover',
    API: 'api',
    Widget: 'widget',
    ExternalSurvey: 'external_survey',
} as const
export type SurveyType = (typeof SurveyType)[keyof typeof SurveyType]

export const SurveyQuestionType = {
    Open: 'open',
    MultipleChoice: 'multiple_choice',
    SingleChoice: 'single_choice',
    Rating: 'rating',
    Link: 'link',
} as const
export type SurveyQuestionType = (typeof SurveyQuestionType)[keyof typeof SurveyQuestionType]

export const SurveyQuestionBranchingType = {
    NextQuestion: 'next_question',
    End: 'end',
    ResponseBased: 'response_based',
    SpecificQuestion: 'specific_question',
} as const
export type SurveyQuestionBranchingType = (typeof SurveyQuestionBranchingType)[keyof typeof SurveyQuestionBranchingType]

export const SurveySchedule = {
    Once: 'once',
    Recurring: 'recurring',
    Always: 'always',
} as const
export type SurveySchedule = (typeof SurveySchedule)[keyof typeof SurveySchedule]

export const SurveyEventName = {
    SHOWN: 'survey shown',
    DISMISSED: 'survey dismissed',
    SENT: 'survey sent',
    ABANDONED: 'survey abandoned',
} as const
export type SurveyEventName = (typeof SurveyEventName)[keyof typeof SurveyEventName]

export const SurveyEventProperties = {
    SURVEY_ID: '$survey_id',
    SURVEY_NAME: '$survey_name',
    SURVEY_RESPONSE: '$survey_response',
    SURVEY_ITERATION: '$survey_iteration',
    SURVEY_ITERATION_START_DATE: '$survey_iteration_start_date',
    SURVEY_PARTIALLY_COMPLETED: '$survey_partially_completed',
    SURVEY_SUBMISSION_ID: '$survey_submission_id',
    SURVEY_QUESTIONS: '$survey_questions',
    SURVEY_COMPLETED: '$survey_completed',
    PRODUCT_TOUR_ID: '$product_tour_id',
    SURVEY_LAST_SEEN_DATE: '$survey_last_seen_date',
    SURVEY_LANGUAGE: '$survey_language',
} as const
export type SurveyEventProperties = (typeof SurveyEventProperties)[keyof typeof SurveyEventProperties]

export const DisplaySurveyType = {
    Popover: 'popover',
    Inline: 'inline',
} as const
export type DisplaySurveyType = (typeof DisplaySurveyType)[keyof typeof DisplaySurveyType]

export type PropertyMatchType = 'regex' | 'not_regex' | 'exact' | 'is_not' | 'icontains' | 'not_icontains'

/** Extended survey operator type with numeric comparisons. */
export type PropertyOperator = PropertyMatchType | 'gt' | 'lt'

export type PropertyFilters = {
    [propertyName: string]: {
        values: string[]
        operator: PropertyOperator
    }
}

export interface SurveyEventWithFilters {
    name: string
    propertyFilters?: PropertyFilters
}

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
