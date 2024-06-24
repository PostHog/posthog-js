/**
 * Having Survey types in types.ts was confusing tsc
 * and generating an invalid module.d.ts
 * See https://github.com/PostHog/posthog-js/issues/698
 */

export interface SurveyAppearance {
    // keep in sync with frontend/src/types.ts -> SurveyAppearance
    backgroundColor?: string
    submitButtonColor?: string
    // text color is deprecated, use auto contrast text color instead
    textColor?: string
    // deprecate submit button text eventually
    submitButtonText?: string
    descriptionTextColor?: string
    ratingButtonColor?: string
    ratingButtonActiveColor?: string
    ratingButtonHoverColor?: string
    whiteLabel?: boolean
    autoDisappear?: boolean
    displayThankYouMessage?: boolean
    thankYouMessageHeader?: string
    thankYouMessageDescription?: string
    thankYouMessageDescriptionContentType?: SurveyQuestionDescriptionContentType
    borderColor?: string
    position?: 'left' | 'right' | 'center'
    placeholder?: string
    // widget options
    widgetType?: 'button' | 'tab' | 'selector'
    widgetSelector?: string
    widgetLabel?: string
    widgetColor?: string
    // questionable: Not in frontend/src/types.ts -> SurveyAppearance, but used in site app
    maxWidth?: string
    zIndex?: string
    shuffleQuestions?: boolean
}

export enum SurveyType {
    Popover = 'popover',
    API = 'api',
    Widget = 'widget',
}

export type SurveyQuestion = BasicSurveyQuestion | LinkSurveyQuestion | RatingSurveyQuestion | MultipleSurveyQuestion

export type SurveyQuestionDescriptionContentType = 'html' | 'text'

interface SurveyQuestionBase {
    question: string
    description?: string | null
    descriptionContentType?: SurveyQuestionDescriptionContentType
    optional?: boolean
    buttonText?: string
    originalQuestionIndex: number
    branching?:
        | NextQuestionBranching
        | ConfirmationMessageBranching
        | ResponseBasedBranching
        | SpecificQuestionBranching
}

export interface BasicSurveyQuestion extends SurveyQuestionBase {
    type: SurveyQuestionType.Open
}

export interface LinkSurveyQuestion extends SurveyQuestionBase {
    type: SurveyQuestionType.Link
    link?: string | null
}

export interface RatingSurveyQuestion extends SurveyQuestionBase {
    type: SurveyQuestionType.Rating
    display: 'number' | 'emoji'
    scale: number
    lowerBoundLabel: string
    upperBoundLabel: string
}

export interface MultipleSurveyQuestion extends SurveyQuestionBase {
    type: SurveyQuestionType.SingleChoice | SurveyQuestionType.MultipleChoice
    choices: string[]
    hasOpenChoice?: boolean
    shuffleOptions?: boolean
}

export enum SurveyQuestionType {
    Open = 'open',
    MultipleChoice = 'multiple_choice',
    SingleChoice = 'single_choice',
    Rating = 'rating',
    Link = 'link',
}

export enum SurveyQuestionBranchingType {
    NextQuestion = 'next_question',
    ConfirmationMessage = 'confirmation_message',
    ResponseBased = 'response_based',
    SpecificQuestion = 'specific_question',
}

interface NextQuestionBranching {
    type: SurveyQuestionBranchingType.NextQuestion
}

interface ConfirmationMessageBranching {
    type: SurveyQuestionBranchingType.ConfirmationMessage
}

interface ResponseBasedBranching {
    type: SurveyQuestionBranchingType.ResponseBased
    responseValues: Record<string, any>
}

interface SpecificQuestionBranching {
    type: SurveyQuestionBranchingType.SpecificQuestion
    index: number
}

export interface SurveyResponse {
    surveys: Survey[]
}

export type SurveyCallback = (surveys: Survey[]) => void

export type SurveyUrlMatchType = 'regex' | 'not_regex' | 'exact' | 'is_not' | 'icontains' | 'not_icontains'

export interface Survey {
    // Sync this with the backend's SurveyAPISerializer!
    id: string
    name: string
    description: string
    type: SurveyType
    linked_flag_key: string | null
    targeting_flag_key: string | null
    internal_targeting_flag_key: string | null
    questions: SurveyQuestion[]
    appearance: SurveyAppearance | null
    conditions: {
        url?: string
        selector?: string
        seenSurveyWaitPeriodInDays?: number
        urlMatchType?: SurveyUrlMatchType
        actions: ActionType[] | null
        events: {
            values: {
                name: string
            }[]
        } | null
    } | null
    start_date: string | null
    end_date: string | null
    current_iteration: number | null
    current_iteration_start_date: string | null
}

export enum PropertyFilterType {
    /** Event metadata and fields on the clickhouse events table */
    Meta = 'meta',
    /** Event properties */
    Event = 'event',
    /** Person properties */
    Person = 'person',
    Element = 'element',
    /** Event property with "$feature/" prepended */
    Feature = 'feature',
    Session = 'session',
    Cohort = 'cohort',
    Recording = 'recording',
    Group = 'group',
    HogQL = 'hogql',
    DataWarehouse = 'data_warehouse',
    DataWarehousePersonProperty = 'data_warehouse_person_property',
}
export enum PropertyOperator {
    Exact = 'exact',
    IsNot = 'is_not',
    IContains = 'icontains',
    NotIContains = 'not_icontains',
    Regex = 'regex',
    NotRegex = 'not_regex',
    GreaterThan = 'gt',
    GreaterThanOrEqual = 'gte',
    LessThan = 'lt',
    LessThanOrEqual = 'lte',
    IsSet = 'is_set',
    IsNotSet = 'is_not_set',
    IsDateExact = 'is_date_exact',
    IsDateBefore = 'is_date_before',
    IsDateAfter = 'is_date_after',
    Between = 'between',
    NotBetween = 'not_between',
    Minimum = 'min',
    Maximum = 'max',
}

export type PropertyFilterValue = string | number | (string | number)[] | null

/** Sync with plugin-server/src/types.ts */
interface BasePropertyFilter {
    key: string
    value?: PropertyFilterValue
    label?: string
    type?: PropertyFilterType
}

/** Sync with plugin-server/src/types.ts */
export interface EventPropertyFilter extends BasePropertyFilter {
    type: PropertyFilterType.Event
    /** @default 'exact' */
    operator: PropertyOperator
}

/** Sync with plugin-server/src/types.ts */
export interface PersonPropertyFilter extends BasePropertyFilter {
    type: PropertyFilterType.Person
    operator: PropertyOperator
}

/** Sync with plugin-server/src/types.ts */
export interface ElementPropertyFilter extends BasePropertyFilter {
    type: PropertyFilterType.Element
    key: 'tag_name' | 'text' | 'href' | 'selector'
    operator: PropertyOperator
}
export type AnyPropertyFilter = EventPropertyFilter | PersonPropertyFilter | ElementPropertyFilter

export interface ActionType {
    count?: number
    created_at: string
    deleted?: boolean
    id: number
    is_calculating?: boolean
    last_calculated_at?: string
    last_updated_at?: string // alias for last_calculated_at to achieve event and action parity
    name: string | null
    description?: string
    post_to_slack?: boolean
    slack_message_format?: string
    steps?: ActionStepType[]
    tags?: string[]
    verified?: boolean
    is_action?: true
    action_id?: number // alias of id to make it compatible with event definitions uuid
    bytecode?: any[]
    bytecode_error?: string
}

/** Sync with plugin-server/src/types.ts */
export type ActionStepStringMatching = 'contains' | 'exact' | 'regex'

export interface ActionStepType {
    event?: string | null
    properties?: AnyPropertyFilter[]
    selector?: string | null
    /** @deprecated Only `selector` should be used now. */
    tag_name?: string
    text?: string | null
    /** @default StringMatching.Exact */
    text_matching?: ActionStepStringMatching | null
    href?: string | null
    /** @default ActionStepStringMatching.Exact */
    href_matching?: ActionStepStringMatching | null
    url?: string | null
    /** @default StringMatching.Contains */
    url_matching?: ActionStepStringMatching | null
}

export interface ElementType {
    attr_class?: string[]
    attr_id?: string
    attributes: Record<string, string>
    href?: string
    nth_child?: number
    nth_of_type?: number
    order?: number
    tag_name: string
    text?: string
}
