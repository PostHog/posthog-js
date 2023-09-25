import { PostHog } from './posthog-core'
import { SURVEYS } from './constants'
import { SurveyCallback } from 'posthog-surveys-types'
import { _isValidRegex } from './utils'

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
                    this.instance.persistence?.register({ [SURVEYS]: surveys })
                    return callback(surveys)
                }
            )
        } else {
            return callback(existingSurveys)
        }
    }

    getMatchingUrl(url?: string): boolean {
        if (!url) return true

        // If the url string starts and ends with / it is meant to be a regular expression
        if (url.startsWith('/') && url.endsWith('/')) {
            const regexPattern = url.slice(1, -1)
            if (_isValidRegex(regexPattern)) {
                return new RegExp(regexPattern).test(window.location.href)
            }
        }
        // If the url string has a wildcard, convert to a regular expression
        if (url.includes('*')) {
            return new RegExp(url.replace(/\./g, '\\.').replace(/\*/g, '.*')).test(window.location.href)
        }
        return window.location.href.indexOf(url) > -1
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
                const urlCheck = this.getMatchingUrl(survey.conditions?.url)
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
