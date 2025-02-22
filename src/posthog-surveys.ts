import { SURVEYS } from './constants'
import { getSurveySeenStorageKeys } from './extensions/surveys/surveys-utils'
import { PostHog } from './posthog-core'
import { Survey, SurveyCallback, SurveyMatchType } from './posthog-surveys-types'
import { RemoteConfig } from './types'
import { Info } from './utils/event-utils'
import { assignableWindow, document, userAgent, window } from './utils/globals'
import { createLogger } from './utils/logger'
import { isMatchingRegex } from './utils/regex-utils'
import { SurveyEventReceiver } from './utils/survey-event-receiver'
import { isNullish } from './utils/type-utils'

const logger = createLogger('[Surveys]')

export const surveyValidationMap: Record<SurveyMatchType, (targets: string[], value: string) => boolean> = {
    icontains: (targets, value) => targets.some((target) => value.toLowerCase().includes(target.toLowerCase())),

    not_icontains: (targets, value) => targets.every((target) => !value.toLowerCase().includes(target.toLowerCase())),

    regex: (targets, value) => targets.some((target) => isMatchingRegex(value, target)),

    not_regex: (targets, value) => targets.every((target) => !isMatchingRegex(value, target)),

    exact: (targets, value) => targets.some((target) => value === target),

    is_not: (targets, value) => targets.every((target) => value !== target),
}

function defaultMatchType(matchType?: SurveyMatchType): SurveyMatchType {
    return matchType ?? 'icontains'
}

// use urlMatchType to validate url condition, fallback to contains for backwards compatibility
export function doesSurveyUrlMatch(survey: Pick<Survey, 'conditions'>): boolean {
    if (!survey.conditions?.url) {
        return true
    }
    // if we dont know the url, assume it is not a match
    const href = window?.location?.href
    if (!href) {
        return false
    }

    const targets = [survey.conditions.url]
    return surveyValidationMap[defaultMatchType(survey.conditions?.urlMatchType)](targets, href)
}

export function doesSurveyDeviceTypesMatch(survey: Survey): boolean {
    if (!survey.conditions?.deviceTypes || survey.conditions?.deviceTypes.length === 0) {
        return true
    }
    // if we dont know the device type, assume it is not a match
    if (!userAgent) {
        return false
    }

    const deviceType = Info.deviceType(userAgent)
    return surveyValidationMap[defaultMatchType(survey.conditions?.deviceTypesMatchType)](
        survey.conditions.deviceTypes,
        deviceType
    )
}

export class PostHogSurveys {
    private _decideServerResponse?: boolean
    public _surveyEventReceiver: SurveyEventReceiver | null
    private _surveyManager: any
    private _isFetchingSurveys: boolean = false
    private _isInitializingSurveys: boolean = false

    constructor(private readonly instance: PostHog) {
        // we set this to undefined here because we need the persistence storage for this type
        // but that's not initialized until loadIfEnabled is called.
        this._surveyEventReceiver = null
    }

    onRemoteConfig(response: RemoteConfig) {
        this._decideServerResponse = !!response['surveys']
        logger.info(`decideServerResponse set to ${this._decideServerResponse}`)

        this.loadIfEnabled()
    }

    reset(): void {
        localStorage.removeItem('lastSeenSurveyDate')
        const surveyKeys = getSurveySeenStorageKeys()
        surveyKeys.forEach((key) => localStorage.removeItem(key))
    }

    loadIfEnabled() {
        if (this._surveyManager) {
            // Surveys already loaded.
            return
        }

        if (this._isInitializingSurveys) {
            logger.info('Already initializing surveys, skipping...')
            return
        }

        const disableSurveys = this.instance.config.disable_surveys

        if (disableSurveys) {
            logger.info('Disabled. Not loading surveys.')
            return
        }

        const phExtensions = assignableWindow?.__PosthogExtensions__

        if (!phExtensions) {
            logger.error('PostHog Extensions not found.')
            return
        }

        if (!this._decideServerResponse) {
            logger.warn('Decide not loaded yet. Not loading surveys.')
            return
        }

        this._isInitializingSurveys = true

        try {
            const generateSurveys = phExtensions.generateSurveys

            if (!generateSurveys) {
                const loadExternalDependency = phExtensions.loadExternalDependency

                if (loadExternalDependency) {
                    loadExternalDependency(this.instance, 'surveys', (err) => {
                        if (err || !phExtensions.generateSurveys) {
                            logger.error('Could not load surveys script', err)
                            this._isInitializingSurveys = false
                            return
                        }

                        this._surveyManager = phExtensions.generateSurveys(this.instance)
                        this._isInitializingSurveys = false
                        this._surveyEventReceiver = new SurveyEventReceiver(this.instance)
                        logger.info('Surveys loaded successfully')
                    })
                } else {
                    logger.error('PostHog loadExternalDependency extension not found. Cannot load remote config.')
                    this._isInitializingSurveys = false
                }
            } else {
                this._surveyManager = generateSurveys(this.instance)
                this._isInitializingSurveys = false
                this._surveyEventReceiver = new SurveyEventReceiver(this.instance)
                logger.info('Surveys loaded successfully')
            }
        } catch (e) {
            logger.error('Error initializing surveys', e)
            this._isInitializingSurveys = false
            throw e
        }
    }

    getSurveys(callback: SurveyCallback, forceReload = false) {
        // In case we manage to load the surveys script, but config says not to load surveys
        // then we shouldn't return survey data
        if (this.instance.config.disable_surveys) {
            logger.info('Disabled. Not loading surveys.')
            return callback([])
        }

        const existingSurveys = this.instance.get_property(SURVEYS)

        if (!existingSurveys || forceReload) {
            // Prevent concurrent API calls
            if (this._isFetchingSurveys) {
                return callback([])
            }

            try {
                this._isFetchingSurveys = true
                this.instance._send_request({
                    url: this.instance.requestRouter.endpointFor(
                        'api',
                        `/api/surveys/?token=${this.instance.config.token}`
                    ),
                    method: 'GET',
                    timeout: this.instance.config.surveys_request_timeout_ms,
                    callback: (response) => {
                        this._isFetchingSurveys = false
                        const statusCode = response.statusCode
                        if (statusCode !== 200 || !response.json) {
                            logger.error(`Surveys API could not be loaded, status: ${statusCode}`)
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
            } catch (e) {
                this._isFetchingSurveys = false
                throw e
            }
        } else {
            return callback(existingSurveys)
        }
    }

    private isSurveyFeatureFlagEnabled(flagKey: string | null) {
        if (!flagKey) {
            return true
        }
        return this.instance.featureFlags.isFeatureEnabled(flagKey)
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

                const urlCheck = doesSurveyUrlMatch(survey)
                const selectorCheck = survey.conditions?.selector
                    ? document?.querySelector(survey.conditions.selector)
                    : true
                const deviceTypeCheck = doesSurveyDeviceTypesMatch(survey)
                return urlCheck && selectorCheck && deviceTypeCheck
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
                const linkedFlagCheck = this.isSurveyFeatureFlagEnabled(survey.linked_flag_key)
                const targetingFlagCheck = this.isSurveyFeatureFlagEnabled(survey.targeting_flag_key)

                const hasEvents = (survey.conditions?.events?.values?.length ?? 0) > 0
                const hasActions = (survey.conditions?.actions?.values?.length ?? 0) > 0

                const eventBasedTargetingFlagCheck =
                    hasEvents || hasActions ? activatedSurveys?.includes(survey.id) : true

                const overrideInternalTargetingFlagCheck = this._canActivateRepeatedly(survey)
                const internalTargetingFlagCheck =
                    overrideInternalTargetingFlagCheck ||
                    this.isSurveyFeatureFlagEnabled(survey.internal_targeting_flag_key)

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
