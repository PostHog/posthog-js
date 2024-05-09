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
}

export enum SurveyType {
    Popover = 'popover',
    API = 'api',
    Widget = 'widget',
}

export type SurveyQuestion = BasicSurveyQuestion | LinkSurveyQuestion | RatingSurveyQuestion | MultipleSurveyQuestion

interface SurveyQuestionBase {
    question: string
    description?: string | null
    optional?: boolean
    buttonText?: string
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

export interface SurveyResponse {
    surveys: Survey[]
}

export type SurveyCallback = (surveys: Survey[]) => void

export type SurveyUrlMatchType = 'regex' | 'exact' | 'icontains'

export interface Survey {
    // Sync this with the backend's SurveyAPISerializer!
    id: string
    name: string
    description: string
    type: SurveyType
    linked_flag_key: string | null
    targeting_flag_key: string | null
    questions: SurveyQuestion[]
    appearance: SurveyAppearance | null
    conditions: {
        url?: string
        selector?: string
        seenSurveyWaitPeriodInDays?: number
        urlMatchType?: SurveyUrlMatchType
    } | null
    start_date: string | null
    end_date: string | null
}

// Use the Fisher-yates algorithm to shuffle this array of choices
// https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
const shuffle = (array: string[]) => {
    return array
        .map((a) => ({ sort: Math.random(), value: a }))
        .sort((a, b) => a.sort - b.sort)
        .map((a) => a.value)
}

export function getDisplayOrderChoices(question: MultipleSurveyQuestion): string[] {
    if (!question.shuffleOptions) {
        return question.choices
    }

    let displayOrderChoices = question.choices
    if (question.hasOpenChoice) {
        displayOrderChoices = displayOrderChoices.filter((choice) => choice == 'Other' && question.hasOpenChoice)
    }

    displayOrderChoices = shuffle(displayOrderChoices)

    if (question.hasOpenChoice) {
        displayOrderChoices.push('Other')
    }

    return displayOrderChoices
}
