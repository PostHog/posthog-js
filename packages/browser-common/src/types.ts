import type {
    CapturedNetworkRequest,
    CaptureResult,
    EventName,
    FeatureFlagDetail,
    JsonType,
    Properties,
    Property,
    SurveyRenderReason,
} from '@posthog/types'
import type {
    SurveyAppearance as CoreSurveyAppearance,
    SurveyQuestionTranslation,
    SurveyResponseValue as CoreSurveyResponseValue,
    SurveyTranslation,
    SurveyValidationRule,
} from '@posthog/core'

export type { CapturedNetworkRequest, CaptureResult, EventName, JsonType, Properties, Property, SurveyRenderReason }

export type PropertyMatchType = 'regex' | 'not_regex' | 'exact' | 'is_not' | 'icontains' | 'not_icontains'
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

export interface SurveyAppearance extends Omit<CoreSurveyAppearance, 'position' | 'widgetType'> {
    descriptionTextColor?: string
    ratingButtonHoverColor?: string
    whiteLabel?: boolean
    tabPosition?: SurveyTabPosition
    fontFamily?: string
    maxWidth?: string
    zIndex?: string
    disabledButtonOpacity?: string
    boxPadding?: string
    inputBackgroundColor?: string
    hideCancelButton?: boolean
    position?: SurveyPosition
    widgetType?: SurveyWidgetType
}

export type SurveyQuestion = BasicSurveyQuestion | LinkSurveyQuestion | RatingSurveyQuestion | MultipleSurveyQuestion
export type SurveyQuestionDescriptionContentType = 'html' | 'text'

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

export interface Survey {
    id: string
    name: string
    description?: string
    type: SurveyType
    translations?: Record<string, SurveyTranslation>
    feature_flag_keys?: { key: string; value?: string }[] | null
    linked_flag_key?: string | null
    targeting_flag_key?: string | null
    internal_targeting_flag_key?: string | null
    questions: SurveyQuestion[]
    appearance?: SurveyAppearance | null
    conditions?: {
        url?: string
        selector?: string
        seenSurveyWaitPeriodInDays?: number
        urlMatchType?: PropertyMatchType
        events?: { repeatedActivation?: boolean; values: SurveyEventWithFilters[] } | null
        cancelEvents?: { values: SurveyEventWithFilters[] } | null
        actions?: { values: SurveyActionType[] } | null
        deviceTypes?: string[]
        deviceTypesMatchType?: PropertyMatchType
        linkedFlagVariant?: string
    } | null
    start_date?: string | null
    end_date?: string | null
    current_iteration?: number | null
    current_iteration_start_date?: string | null
    schedule?: SurveySchedule | null
    enable_partial_responses?: boolean | null
}

export interface SurveyActionType {
    id: number
    name: string | null
    steps?: ActionStepType[]
}

export type ActionStepStringMatching = 'contains' | 'exact' | 'regex'

export interface ActionStepType {
    event?: string | null
    selector?: string | null
    selector_regex?: string | null
    tag_name?: string
    text?: string | null
    text_matching?: ActionStepStringMatching | null
    href?: string | null
    href_matching?: ActionStepStringMatching | null
    url?: string | null
    url_matching?: ActionStepStringMatching | null
    properties?: {
        key: string
        value?: string | number | boolean | (string | number | boolean)[] | null
        operator?: PropertyMatchType
        type?: string
    }[]
}

interface DisplaySurveyOptionsBase {
    ignoreConditions: boolean
    ignoreDelay: boolean
    displayType: DisplaySurveyType
    properties?: Properties
    initialResponses?: Record<number, CoreSurveyResponseValue>
}

export interface DisplaySurveyPopoverOptions extends DisplaySurveyOptionsBase {
    displayType: typeof DisplaySurveyType.Popover
    position?: SurveyPosition
    selector?: string
    skipShownEvent?: boolean
}

interface DisplaySurveyInlineOptions extends DisplaySurveyOptionsBase {
    displayType: typeof DisplaySurveyType.Inline
    selector: string
}

export type DisplaySurveyOptions = DisplaySurveyPopoverOptions | DisplaySurveyInlineOptions

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

export const DisplaySurveyType = {
    Popover: 'popover',
    Inline: 'inline',
} as const
export type DisplaySurveyType = (typeof DisplaySurveyType)[keyof typeof DisplaySurveyType]

export interface ProductTour {
    id: string
    name?: string
    conditions?: {
        events?: { values: SurveyEventWithFilters[] } | null
        cancelEvents?: { values: SurveyEventWithFilters[] } | null
        actions?: { values: SurveyActionType[] } | null
    } | null
}

export const ProductTourEventName = {
    SHOWN: 'product tour shown',
    DISMISSED: 'product tour dismissed',
    COMPLETED: 'product tour completed',
    STEP_SHOWN: 'product tour step shown',
    STEP_COMPLETED: 'product tour step completed',
    BUTTON_CLICKED: 'product tour button clicked',
    STEP_SELECTOR_FAILED: 'product tour step selector failed',
    BANNER_CONTAINER_SELECTOR_FAILED: 'product tour banner container selector failed',
    BANNER_ACTION_CLICKED: 'product tour banner action clicked',
} as const
export type ProductTourEventName = (typeof ProductTourEventName)[keyof typeof ProductTourEventName]

export interface PostHogConfigLike {
    name?: string
    api_host: string
    flags_api_host?: string | null
    ui_host?: string | null
    asset_host?: string | null
    override_display_language?: string | null
}

export type PostHogLike = any

export interface SessionRecordingTriggerPropertyFilter {
    key: string
    type: 'event' | 'person'
    operator?: 'exact' | 'is_not' | 'icontains' | 'not_icontains' | 'regex' | 'not_regex' | 'gt' | 'lt'
    value?: string | number | boolean | string[]
}

export type SessionStartReason = any
export type SessionRecordingStatus = any
export type TriggerType = any
export type TracingHeadersHostnames = string[] | boolean | undefined
export type TracingHeadersDistinctId = string | (() => string | undefined)

export type ConversationsRemoteConfig = any
export type UserProvidedTraits = any
export type GetMessagesResponse = any
export type GetTicketsOptions = any
export type GetTicketsResponse = any
export type MarkAsReadResponse = any
export type RestoreFromTokenResponse = any
export type RequestRestoreLinkResponse = any
export type SendMessageResponse = any

export type RemoteConfig = any
export type SiteAppLoader = any
export type DeadClicksAutoCaptureConfig = any
export type ExternalIntegrationKind = string

export type EventWithTime = any

export type FlagsResponse = RemoteConfig & {
    featureFlags?: Record<string, string | boolean>
    featureFlagPayloads?: Record<string, JsonType>
    flags?: Record<string, FeatureFlagDetail>
}
