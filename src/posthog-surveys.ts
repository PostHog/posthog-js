import { PostHog } from './posthog-core'
import { SURVEYS } from './constants'
import {
    Survey,
    SurveyCallback,
    SurveyQuestionBranchingType,
    SurveyQuestionType,
    SurveyUrlMatchType,
} from './posthog-surveys-types'
import { isUrlMatchingRegex } from './utils/request-utils'
import { SurveyEventReceiver } from './utils/survey-event-receiver'
import { assignableWindow, document, window } from './utils/globals'
import { DecideResponse } from './types'
import { logger } from './utils/logger'
import { isNullish } from './utils/type-utils'
import { getSurveySeenStorageKeys } from './extensions/surveys/surveys-utils'

const LOGGER_PREFIX = '[Surveys]'

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

export class PostHogSurveys {
    private _decideServerResponse?: boolean
    public _surveyEventReceiver: SurveyEventReceiver | null
    private _surveyManager: any

    constructor(private readonly instance: PostHog) {
        // we set this to undefined here because we need the persistence storage for this type
        // but that's not initialized until loadIfEnabled is called.
        this._surveyEventReceiver = null
    }

    afterDecideResponse(response: DecideResponse) {
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
                    return logger.error(LOGGER_PREFIX, 'Could not load surveys script', err)
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
                transport: 'XHR',
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
                if (!survey.linked_flag_key && !survey.targeting_flag_key && !survey.internal_targeting_flag_key) {
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

                return (
                    linkedFlagCheck && targetingFlagCheck && internalTargetingFlagCheck && eventBasedTargetingFlagCheck
                )
            })

            return callback(targetingMatchedSurveys)
        }, forceReload)
    }

    getNextSurveyStep(survey: Survey, currentQuestionIndex: number, response: string | string[] | number | null) {
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

        logger.warn(LOGGER_PREFIX, 'Falling back to next question index due to unexpected branching type')
        return nextQuestionIndex
    }

    // this method is lazily loaded onto the window to avoid loading preact and other dependencies if surveys is not enabled
    private _canActivateRepeatedly(survey: Survey) {
        if (isNullish(assignableWindow.__PosthogExtensions__?.canActivateRepeatedly)) {
            logger.warn(LOGGER_PREFIX, 'canActivateRepeatedly is not defined, must init before calling')
            return false // TODO does it make sense to have a default here?
        }
        return assignableWindow.__PosthogExtensions__.canActivateRepeatedly(survey)
    }

    canRenderSurvey(surveyId: string) {
        if (isNullish(this._surveyManager)) {
            logger.warn(LOGGER_PREFIX, 'canActivateRepeatedly is not defined, must init before calling')
            return
        }
        this.getSurveys((surveys) => {
            const survey = surveys.filter((x) => x.id === surveyId)[0]
            this._surveyManager.canRenderSurvey(survey)
        })
    }

    renderSurvey(surveyId: string, selector: string) {
        if (isNullish(this._surveyManager)) {
            logger.warn(LOGGER_PREFIX, 'canActivateRepeatedly is not defined, must init before calling')
            return
        }
        this.getSurveys((surveys) => {
            const survey = surveys.filter((x) => x.id === surveyId)[0]
            this._surveyManager.renderSurvey(survey, document?.querySelector(selector))
        })
    }
}
