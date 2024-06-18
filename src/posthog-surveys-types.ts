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
