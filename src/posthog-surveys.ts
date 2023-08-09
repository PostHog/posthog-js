import { PostHog } from './posthog-core'
import { SURVEYS } from './constants'

/**
 * Having Survey types in types.ts was confusing tsc
 * and generating an invalid module.d.ts
 * See https://github.com/PostHog/posthog-js/issues/698
 */
export interface SurveyAppearance {
    background_color?: string
    button_color?: string
    text_color?: string
}

export enum SurveyType {
    Popover = 'Popover',
    Button = 'Button',
    Email = 'Email',
    FullScreen = 'Fullscreen',
}

export interface SurveyQuestion {
    type: SurveyQuestionType
    question: string
    required?: boolean
    link?: boolean
    choices?: string[]
}

export enum SurveyQuestionType {
    Open = 'open',
    MultipleChoiceSingle = 'multiple_single',
    MultipleChoiceMulti = 'multiple_multi',
    NPS = 'nps',
    Rating = 'rating',
    Link = 'link',
}

export interface SurveyResponse {
    surveys: Survey[]
}

export type SurveyCallback = (surveys: Survey[]) => void

export interface Survey {
    // Sync this with the backend's SurveySerializer!
    name: string
    description: string
    type: SurveyType
    linked_flag_key?: string | null
    targeting_flag_key?: string | null
    questions: SurveyQuestion[]
    appearance?: SurveyAppearance | null
    conditions?: { url?: string; selector?: string } | null
    start_date?: string | null
    end_date?: string | null
}

export class PostHogSurveys {
    instance: PostHog

    constructor(instance: PostHog) {
        this.instance = instance
    }

    getSurveys(callback: SurveyCallback, forceReload = false) {
        const existingSurveys = this.instance.get_property(SURVEYS)
        if (!existingSurveys || forceReload) {
            this.instance._send_request(
                `${this.instance.get_config('api_host')}/api/surveys/?token=${this.instance.get_config('token')}`,
                {},
                { method: 'GET' },
                (response) => {
                    const surveys = response.surveys
                    this.instance.persistence.register({ [SURVEYS]: surveys })
                    return callback(surveys)
                }
            )
        } else {
            return callback(existingSurveys)
        }
    }

    getActiveMatchingSurveys(callback: SurveyCallback, forceReload = false) {
        this.getSurveys((surveys) => {
            const activeSurveys = surveys.filter((survey) => {
                return !!(survey.start_date && !survey.end_date)
            })
            const conditionMatchedSurveys = activeSurveys.filter((survey) => {
                if (!survey.conditions) {
                    return true
                }
                const urlCheck = survey.conditions?.url
                    ? window.location.href.indexOf(survey.conditions.url) > -1
                    : true
                const selectorCheck = survey.conditions?.selector
                    ? document.querySelector(survey.conditions.selector)
                    : true
                return urlCheck && selectorCheck
            })
            const targetingMatchedSurveys = conditionMatchedSurveys.filter((survey) => {
                if (!survey.linked_flag_key && !survey.targeting_flag_key) {
                    return true
                }
                const linkedFlagCheck = survey.linked_flag_key
                    ? this.instance.featureFlags.isFeatureEnabled(survey.linked_flag_key)
                    : true
                const targetingFlagCheck = survey.targeting_flag_key
                    ? this.instance.featureFlags.isFeatureEnabled(survey.targeting_flag_key)
                    : true
                return linkedFlagCheck && targetingFlagCheck
            })

            return callback(targetingMatchedSurveys)
        }, forceReload)
    }
}
