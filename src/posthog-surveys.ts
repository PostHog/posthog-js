import { PostHog } from './posthog-core'
import { SURVEYS } from './posthog-persistence'
import { SurveyCallback } from 'types'

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
                if (survey.conditions?.url && !survey.conditions.selector) {
                    return window.location.href.indexOf(survey.conditions.url) > -1
                }
                if (survey.conditions?.selector && !survey.conditions.url) {
                    return document.querySelector(survey.conditions.selector)
                }
                if (survey.conditions?.url && survey.conditions?.selector) {
                    return (
                        window.location.href.indexOf(survey.conditions.url) > -1 &&
                        document.querySelector(survey.conditions.selector)
                    )
                }
                return false
            })
            const targetingMatchedSurveys = conditionMatchedSurveys.filter((survey) => {
                if (!survey.linked_flag_key && !survey.targeting_flag_key) {
                    return true
                }
                if (survey.linked_flag_key && !survey.targeting_flag_key) {
                    return this.instance.featureFlags.isFeatureEnabled(survey.linked_flag_key)
                }
                if (survey.targeting_flag_key && !survey.linked_flag_key) {
                    return this.instance.featureFlags.isFeatureEnabled(survey.targeting_flag_key)
                }
                if (survey.linked_flag_key && survey.targeting_flag_key) {
                    return (
                        this.instance.featureFlags.isFeatureEnabled(survey.linked_flag_key) &&
                        this.instance.featureFlags.isFeatureEnabled(survey.targeting_flag_key)
                    )
                }
                return false
            })

            return callback(targetingMatchedSurveys)
        }, forceReload)
    }
}
