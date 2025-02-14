import { SURVEYS } from './constants'
import { getSurveySeenStorageKeys } from './extensions/surveys/surveys-utils'
import { PostHog } from './posthog-core'
import {
    Survey,
    SurveyCallback,
    SurveyMatchType,
    SurveyQuestionBranchingType,
    SurveyQuestionType,
} from './posthog-surveys-types'
import { RemoteConfig } from './types'
import { Info } from './utils/event-utils'
import { assignableWindow, document, userAgent, window } from './utils/globals'
import { createLogger } from './utils/logger'
import { isMatchingRegex } from './utils/string-utils'
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

function getRatingBucketForResponseValue(responseValue: number, scale: number) {
    if (scale === 3) {
        if (responseValue < 1 || responseValue > 3) {
            throw new Error('The response must be in range 1-3')
        }

        return responseValue === 1 ? 'negative' : responseValue === 2 ? 'neutral' : 'positive'
    } else if (scale === 5) {
        if (responseValue < 1 || responseValue > 5) {
            throw new Error('The response must be in range 1-5')
        }

        return responseValue <= 2 ? 'negative' : responseValue === 3 ? 'neutral' : 'positive'
    } else if (scale === 7) {
        if (responseValue < 1 || responseValue > 7) {
            throw new Error('The response must be in range 1-7')
        }

        return responseValue <= 3 ? 'negative' : responseValue === 4 ? 'neutral' : 'positive'
    } else if (scale === 10) {
        if (responseValue < 0 || responseValue > 10) {
            throw new Error('The response must be in range 0-10')
        }

        return responseValue <= 6 ? 'detractors' : responseValue <= 8 ? 'passives' : 'promoters'
    }

    throw new Error('The scale must be one of: 3, 5, 7, 10')
}

export function getNextSurveyStep(
    survey: Survey,
    currentQuestionIndex: number,
    response: string | string[] | number | null
) {
    const question = survey.questions[currentQuestionIndex]
    const nextQuestionIndex = currentQuestionIndex + 1

    if (!question.branching?.type) {
        if (currentQuestionIndex === survey.questions.length - 1) {
            return SurveyQuestionBranchingType.End
        }

        return nextQuestionIndex
    }

    if (question.branching.type === SurveyQuestionBranchingType.End) {
        return SurveyQuestionBranchingType.End
    } else if (question.branching.type === SurveyQuestionBranchingType.SpecificQuestion) {
        if (Number.isInteger(question.branching.index)) {
            return question.branching.index
        }
    } else if (question.branching.type === SurveyQuestionBranchingType.ResponseBased) {
        // Single choice
        if (question.type === SurveyQuestionType.SingleChoice) {
            // :KLUDGE: for now, look up the choiceIndex based on the response
            // TODO: once QuestionTypes.MultipleChoiceQuestion is refactored, pass the selected choiceIndex into this method
            const selectedChoiceIndex = question.choices.indexOf(`${response}`)

            if (question.branching?.responseValues?.hasOwnProperty(selectedChoiceIndex)) {
                const nextStep = question.branching.responseValues[selectedChoiceIndex]

                // Specific question
                if (Number.isInteger(nextStep)) {
                    return nextStep
                }

                if (nextStep === SurveyQuestionBranchingType.End) {
                    return SurveyQuestionBranchingType.End
                }

                return nextQuestionIndex
            }
        } else if (question.type === SurveyQuestionType.Rating) {
            if (typeof response !== 'number' || !Number.isInteger(response)) {
                throw new Error('The response type must be an integer')
            }

            const ratingBucket = getRatingBucketForResponseValue(response, question.scale)

            if (question.branching?.responseValues?.hasOwnProperty(ratingBucket)) {
                const nextStep = question.branching.responseValues[ratingBucket]

                // Specific question
                if (Number.isInteger(nextStep)) {
                    return nextStep
                }

                if (nextStep === SurveyQuestionBranchingType.End) {
                    return SurveyQuestionBranchingType.End
                }

                return nextQuestionIndex
            }
        }

        return nextQuestionIndex
    }

    logger.warn('Falling back to next question index due to unexpected branching type')
    return nextQuestionIndex
}

function defaultMatchType(matchType?: SurveyMatchType): SurveyMatchType {
    return matchType ?? 'icontains'
}

// use urlMatchType to validate url condition, fallback to contains for backwards compatibility
export function doesSurveyUrlMatch(survey: Survey): boolean {
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

        const generateSurveys = phExtensions.generateSurveys

        if (!this._decideServerResponse) {
            logger.warn('Decide not loaded yet. Not loading surveys.')
            return
        }

        if (this._surveyEventReceiver == null) {
            this._surveyEventReceiver = new SurveyEventReceiver(this.instance)
        }

        if (!generateSurveys) {
            const loadExternalDependency = phExtensions.loadExternalDependency

            if (loadExternalDependency) {
                loadExternalDependency(this.instance, 'surveys', (err) => {
                    if (err) {
                        logger.error('Could not load surveys script', err)
                        return
                    }

                    this._surveyManager = phExtensions.generateSurveys?.(this.instance)
                })
            } else {
                logger.error('PostHog loadExternalDependency extension not found. Cannot load remote config.')
            }
        } else {
            this._surveyManager = generateSurveys(this.instance)
        }
    }

    getSurveys(callback: SurveyCallback, forceReload = false) {
        // In case we manage to load the surveys script, but config says not to load surveys
        // then we shouldn't return survey data
        if (this.instance.config.disable_surveys) {
            logger.info('Disabled. Not loading surveys.')

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
