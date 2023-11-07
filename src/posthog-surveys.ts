import { PostHog } from './posthog-core'
import { SURVEYS } from './constants'
import { SurveyCallback, SurveyUrlMatchType } from './posthog-surveys-types'
import { _isUrlMatchingRegex } from './utils/request-utils'

export const surveyUrlValidationMap: Record<SurveyUrlMatchType, (conditionsUrl: string) => boolean> = {
    icontains: (conditionsUrl) => window.location.href.toLowerCase().indexOf(conditionsUrl.toLowerCase()) > -1,
    regex: (conditionsUrl) => _isUrlMatchingRegex(window.location.href, conditionsUrl),
    exact: (conditionsUrl) => window.location.href === conditionsUrl,
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
                `${this.instance.config.api_host}/api/surveys/?token=${this.instance.config.token}`,
                {},
                { method: 'GET' },
                (response) => {
                    const surveys = response.surveys || []
                    this.instance.persistence?.register({ [SURVEYS]: surveys })
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

                // use urlMatchType to validate url condition, fallback to contains for backwards compatibility
                const urlCheck = survey.conditions?.url
                    ? surveyUrlValidationMap[survey.conditions?.urlMatchType ?? 'icontains'](survey.conditions.url)
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
