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
    thankYouMessageCloseButtonText?: string
    borderColor?: string
    position?: 'left' | 'right' | 'center'
    placeholder?: string
    shuffleQuestions?: boolean
    surveyPopupDelaySeconds?: number
    // widget options
    widgetType?: 'button' | 'tab' | 'selector'
    widgetSelector?: string
    widgetLabel?: string
    widgetColor?: string
    // questionable: Not in frontend/src/types.ts -> SurveyAppearance, but used in site app
    maxWidth?: string
    zIndex?: string
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
    branching?: NextQuestionBranching | EndBranching | ResponseBasedBranching | SpecificQuestionBranching
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
    End = 'end',
    ResponseBased = 'response_based',
    SpecificQuestion = 'specific_question',
}

interface NextQuestionBranching {
    type: SurveyQuestionBranchingType.NextQuestion
}

interface EndBranching {
    type: SurveyQuestionBranchingType.End
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
        events: {
            repeatedActivation?: boolean
            values: {
                name: string
            }[]
        } | null
        actions: {
            values: ActionType[]
        } | null
    } | null
    start_date: string | null
    end_date: string | null
    current_iteration: number | null
    current_iteration_start_date: string | null
}

export interface ActionType {
    count?: number
    created_at: string
    deleted?: boolean
    id: number
    name: string | null
    steps?: ActionStepType[]
    tags?: string[]
    is_action?: true
    action_id?: number // alias of id to make it compatible with event definitions uuid
}

/** Sync with plugin-server/src/types.ts */
export type ActionStepStringMatching = 'contains' | 'exact' | 'regex'

export interface ActionStepType {
    event?: string | null
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
