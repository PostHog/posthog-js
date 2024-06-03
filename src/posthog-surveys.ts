import { PostHog } from './posthog-core'
import { SURVEYS } from './constants'
import { SurveyCallback, SurveyUrlMatchType } from './posthog-surveys-types'
import { isUrlMatchingRegex } from './utils/request-utils'
import { SurveyEventReceiver } from './utils/survey-event-receiver'
import { assignableWindow, document, window } from './utils/globals'
import { DecideResponse } from './types'
import { loadScript } from './utils'
import { logger } from './utils/logger'
import { isUndefined } from './utils/type-utils'

export const surveyUrlValidationMap: Record<SurveyUrlMatchType, (conditionsUrl: string) => boolean> = {
    icontains: (conditionsUrl) =>
        !!window && window.location.href.toLowerCase().indexOf(conditionsUrl.toLowerCase()) > -1,
    regex: (conditionsUrl) => !!window && isUrlMatchingRegex(window.location.href, conditionsUrl),
    exact: (conditionsUrl) => window?.location.href === conditionsUrl,
}

export class PostHogSurveys {
    instance: PostHog
    private _decideServerResponse?: boolean

    constructor(instance: PostHog) {
        this.instance = instance
    }

    afterDecideResponse(response: DecideResponse) {
        this._decideServerResponse = !!response['surveys']
        this.loadIfEnabled()
    }

    loadIfEnabled() {
        const surveysGenerator = assignableWindow?.extendPostHogWithSurveys

        if (!this.instance.config.disable_surveys && this._decideServerResponse && !surveysGenerator) {
            loadScript(this.instance.requestRouter.endpointFor('assets', '/static/surveys.js'), (err) => {
                if (err) {
                    return logger.error(`Could not load surveys script`, err)
                }

                assignableWindow.extendPostHogWithSurveys(this.instance)
            })
        }
    }

    getSurveys(callback: SurveyCallback, forceReload = false) {
        // In case we manage to load the surveys script, but config says not to load surveys
        // then we shouldn't return survey data
        if (this.instance.config.disable_surveys) {
            return callback([])
        }
        const existingSurveys = this.instance.get_property(SURVEYS)
        if (!existingSurveys || forceReload) {
            this.instance._send_request({
                url: this.instance.requestRouter.endpointFor(
                    'api',
                    `/api/surveys/?token=${this.instance.config.token}`
                ),
                method: 'GET',
                transport: 'XHR',
                callback: (response) => {
                    if (response.statusCode !== 200 || !response.json) {
                        return callback([])
                    }
                    const surveys = response.json.surveys || []
                    this.instance.persistence?.register({ [SURVEYS]: surveys })
                    return callback(surveys)
                },
            })
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
                    ? document?.querySelector(survey.conditions.selector)
                    : true
                return urlCheck && selectorCheck
            })

            const eventBasedSurveys = conditionMatchedSurveys.filter((survey) => {
                return survey.events && survey.events.length > 0
            })

            const eventsReceiver = new SurveyEventReceiver()
            // get all the surveys that have been activated so far with user actions.
            const activatedSurveys: string[] = eventsReceiver.getSurveys()
            // start watching for surveys that are eventBased now.
            eventsReceiver.register(eventBasedSurveys)
            if (eventBasedSurveys.length > 0 && !isUndefined(this.instance._addCaptureHook)) {
                this.instance._addCaptureHook(eventsReceiver.on)
            }

            const targetingMatchedSurveys = conditionMatchedSurveys.filter((survey) => {
                if (!survey.linked_flag_key && !survey.targeting_flag_key && !survey.internal_targeting_flag_key) {
                    return true
                }
                const linkedFlagCheck = survey.linked_flag_key
                    ? this.instance.featureFlags.isFeatureEnabled(survey.linked_flag_key)
                    : true
                const targetingFlagCheck = survey.targeting_flag_key
                    ? this.instance.featureFlags.isFeatureEnabled(survey.targeting_flag_key)
                    : true

                const internalTargetingFlagCheck = survey.internal_targeting_flag_key
                    ? this.instance.featureFlags.isFeatureEnabled(survey.internal_targeting_flag_key)
                    : true

                const hasEvents = survey.events && survey.events.length > 0
                const eventBasedTargetingFlagCheck = hasEvents ? activatedSurveys.includes(survey.id) : true
                if (eventBasedTargetingFlagCheck) {
                    // TODO: think more of surveys that can be shown repeatedly on the same event.
                    // an example is someone clicking a button and we want to show a survey every time
                    // not just once.
                    // unRegister will remove the survey from being watched.
                    // The following mechanisms prevent us from showing the survey twice to the same user.
                    // 1.`seenSurvey_{id}` check in local storage in the surveys.tsx file.
                    // 2. internalTargetingFlagCheck will be false if a user has already seen a survey
                    // need to override it here if a user can see the same survey multiple times.
                    eventsReceiver.deRegister(survey)
                }

                return (
                    linkedFlagCheck && targetingFlagCheck && internalTargetingFlagCheck && eventBasedTargetingFlagCheck
                )
            })

            return callback(targetingMatchedSurveys)
        }, forceReload)
    }
}
