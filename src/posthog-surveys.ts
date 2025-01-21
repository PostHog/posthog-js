import { SURVEYS } from './constants'
import { getNextSurveyStep } from './extensions/surveys'
import { getSurveySeenStorageKeys } from './extensions/surveys/surveys-utils'
import { PostHog } from './posthog-core'
import { Survey, SurveyCallback, SurveyUrlMatchType } from './posthog-surveys-types'
import { RemoteConfig } from './types'
import { assignableWindow, document, window } from './utils/globals'
import { createLogger } from './utils/logger'
import { isUrlMatchingRegex } from './utils/request-utils'
import { SurveyEventReceiver } from './utils/survey-event-receiver'
import { isNullish } from './utils/type-utils'

const logger = createLogger('[Surveys]')

export const surveyUrlValidationMap: Record<SurveyUrlMatchType, (conditionsUrl: string) => boolean> = {
    icontains: (conditionsUrl) =>
        !!window && window.location.href.toLowerCase().indexOf(conditionsUrl.toLowerCase()) > -1,
    not_icontains: (conditionsUrl) =>
        !!window && window.location.href.toLowerCase().indexOf(conditionsUrl.toLowerCase()) === -1,
    regex: (conditionsUrl) => !!window && isUrlMatchingRegex(window.location.href, conditionsUrl),
    not_regex: (conditionsUrl) => !!window && !isUrlMatchingRegex(window.location.href, conditionsUrl),
    exact: (conditionsUrl) => window?.location.href === conditionsUrl,
    is_not: (conditionsUrl) => window?.location.href !== conditionsUrl,
}

export class PostHogSurveys {
    private _decideServerResponse?: boolean
    public _surveyEventReceiver: SurveyEventReceiver | null
    private _surveyManager: any

    constructor(private readonly instance: PostHog) {
        // we set this to undefined here because we need the persistence storage for this type
        // but that's not initialized until loadIfEnabled is called.
        this._surveyEventReceiver = null
    }

    onRemoteConfig(response: RemoteConfig) {
        this._decideServerResponse = !!response['surveys']
        this.loadIfEnabled()
    }

    reset(): void {
        localStorage.removeItem('lastSeenSurveyDate')
        const surveyKeys = getSurveySeenStorageKeys()
        surveyKeys.forEach((key) => localStorage.removeItem(key))
    }

    loadIfEnabled() {
        const surveysGenerator = assignableWindow?.__PosthogExtensions__?.generateSurveys

        if (!this.instance.config.disable_surveys && this._decideServerResponse && !surveysGenerator) {
            if (this._surveyEventReceiver == null) {
                this._surveyEventReceiver = new SurveyEventReceiver(this.instance)
            }

            assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this.instance, 'surveys', (err) => {
                if (err) {
                    return logger.error('Could not load surveys script', err)
                }

                this._surveyManager = assignableWindow.__PosthogExtensions__?.generateSurveys?.(this.instance)
            })
        }
    }

    getSurveys(callback: SurveyCallback, forceReload = false) {
        // In case we manage to load the surveys script, but config says not to load surveys
        // then we shouldn't return survey data
        if (this.instance.config.disable_surveys) {
            return callback([])
        }

        if (this._surveyEventReceiver == null) {
            this._surveyEventReceiver = new SurveyEventReceiver(this.instance)
        }

        const existingSurveys = this.instance.get_property(SURVEYS)

        if (!existingSurveys || forceReload) {
            this.instance._send_request({
                url: this.instance.requestRouter.endpointFor(
                    'api',
                    `/api/surveys/?token=${this.instance.config.token}`
                ),
                method: 'GET',
                callback: (response) => {
                    if (response.statusCode !== 200 || !response.json) {
                        return callback([])
                    }
                    const surveys = response.json.surveys || []

                    const eventOrActionBasedSurveys = surveys.filter(
                        (survey: Survey) =>
                            (survey.conditions?.events &&
                                survey.conditions?.events?.values &&
                                survey.conditions?.events?.values?.length > 0) ||
                            (survey.conditions?.actions &&
                                survey.conditions?.actions?.values &&
                                survey.conditions?.actions?.values?.length > 0)
                    )

                    if (eventOrActionBasedSurveys.length > 0) {
                        this._surveyEventReceiver?.register(eventOrActionBasedSurveys)
                    }

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

            // get all the surveys that have been activated so far with user actions.
            const activatedSurveys: string[] | undefined = this._surveyEventReceiver?.getSurveys()
            const targetingMatchedSurveys = conditionMatchedSurveys.filter((survey) => {
                if (
                    !survey.linked_flag_key &&
                    !survey.targeting_flag_key &&
                    !survey.internal_targeting_flag_key &&
                    !survey.feature_flag_keys?.length
                ) {
                    return true
                }
                const linkedFlagCheck = survey.linked_flag_key
                    ? this.instance.featureFlags.isFeatureEnabled(survey.linked_flag_key)
                    : true
                const targetingFlagCheck = survey.targeting_flag_key
                    ? this.instance.featureFlags.isFeatureEnabled(survey.targeting_flag_key)
                    : true

                const hasEvents =
                    survey.conditions?.events &&
                    survey.conditions?.events?.values &&
                    survey.conditions?.events?.values.length > 0

                const hasActions =
                    survey.conditions?.actions &&
                    survey.conditions?.actions?.values &&
                    survey.conditions?.actions?.values.length > 0
                const eventBasedTargetingFlagCheck =
                    hasEvents || hasActions ? activatedSurveys?.includes(survey.id) : true

                const overrideInternalTargetingFlagCheck = this._canActivateRepeatedly(survey)
                const internalTargetingFlagCheck =
                    survey.internal_targeting_flag_key && !overrideInternalTargetingFlagCheck
                        ? this.instance.featureFlags.isFeatureEnabled(survey.internal_targeting_flag_key)
                        : true
                const flagsCheck = this.checkFlags(survey)
                return (
                    linkedFlagCheck &&
                    targetingFlagCheck &&
                    internalTargetingFlagCheck &&
                    eventBasedTargetingFlagCheck &&
                    flagsCheck
                )
            })

            return callback(targetingMatchedSurveys)
        }, forceReload)
    }

    checkFlags(survey: Survey): boolean {
        if (!survey.feature_flag_keys?.length) {
            return true
        }

        return survey.feature_flag_keys.every(({ key, value }) => {
            if (!key || !value) {
                return true
            }
            return this.instance.featureFlags.isFeatureEnabled(value)
        })
    }
    getNextSurveyStep = getNextSurveyStep

    // this method is lazily loaded onto the window to avoid loading preact and other dependencies if surveys is not enabled
    private _canActivateRepeatedly(survey: Survey) {
        if (isNullish(assignableWindow.__PosthogExtensions__?.canActivateRepeatedly)) {
            logger.warn('init was not called')
            return false // TODO does it make sense to have a default here?
        }
        return assignableWindow.__PosthogExtensions__.canActivateRepeatedly(survey)
    }

    canRenderSurvey(surveyId: string) {
        if (isNullish(this._surveyManager)) {
            logger.warn('init was not called')
            return
        }
        this.getSurveys((surveys) => {
            const survey = surveys.filter((x) => x.id === surveyId)[0]
            this._surveyManager.canRenderSurvey(survey)
        })
    }

    renderSurvey(surveyId: string, selector: string) {
        if (isNullish(this._surveyManager)) {
            logger.warn('init was not called')
            return
        }
        this.getSurveys((surveys) => {
            const survey = surveys.filter((x) => x.id === surveyId)[0]
            this._surveyManager.renderSurvey(survey, document?.querySelector(selector))
        })
    }
}
