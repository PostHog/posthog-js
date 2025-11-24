import * as Preact from 'preact'
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { PostHog } from '../posthog-core'
import {
    Survey,
    SurveyCallback,
    SurveyEventName,
    SurveyEventProperties,
    SurveyPosition,
    SurveyQuestion,
    SurveyQuestionBranchingType,
    SurveyQuestionType,
    SurveySchedule,
    SurveyTabPosition,
    SurveyType,
    SurveyWidgetType,
    SurveyWithTypeAndAppearance,
} from '../posthog-surveys-types'
import { addEventListener } from '../utils'
import { document as _document, window as _window } from '../utils/globals'
import {
    doesSurveyActivateByAction,
    doesSurveyActivateByEvent,
    IN_APP_SURVEY_TYPES,
    isSurveyRunning,
    SURVEY_LOGGER as logger,
} from '../utils/survey-utils'
import { isNull, isUndefined } from '@posthog/core'
import { uuidv7 } from '../uuidv7'
import { ConfirmationMessage } from './surveys/components/ConfirmationMessage'
import { Cancel } from './surveys/components/QuestionHeader'
import {
    CommonQuestionProps,
    LinkQuestion,
    MultipleChoiceQuestion,
    OpenTextQuestion,
    RatingQuestion,
} from './surveys/components/QuestionTypes'
import {
    canActivateRepeatedly,
    retrieveSurveyShadow,
    defaultSurveyAppearance,
    dismissedSurveyEvent,
    doesSurveyDeviceTypesMatch,
    doesSurveyMatchSelector,
    doesSurveyUrlMatch,
    getDisplayOrderQuestions,
    getInProgressSurveyState,
    getSurveyContainerClass,
    getSurveyResponseKey,
    getSurveySeen,
    hasWaitPeriodPassed,
    isSurveyInProgress,
    sendSurveyEvent,
    setInProgressSurveyState,
    SurveyContext,
    getSurveyStylesheet,
    addSurveyCSSVariablesToElement,
} from './surveys/surveys-extension-utils'
import {
    extractPrefillParamsFromUrl,
    convertPrefillToResponses,
    allRequiredQuestionsFilled,
} from '../utils/survey-url-prefill'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const window = _window as Window & typeof globalThis
const document = _document as Document

const DISPATCH_FEEDBACK_WIDGET_EVENT = 'ph:show_survey_widget'
const WIDGET_LISTENER_ATTRIBUTE = 'PHWidgetSurveyClickListener'

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
            let selectedChoiceIndex = question.choices.indexOf(`${response}`)

            if (selectedChoiceIndex === -1 && question.hasOpenChoice) {
                // if the response is not found in the choices, it must be the open choice,
                // which is always the last choice
                selectedChoiceIndex = question.choices.length - 1
            }

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

const SURVEY_NEXT_TO_TRIGGER_PARAMS = {
    ESTIMATED_MIN_HEIGHT: 250,
    HORIZONTAL_PADDING: 20,
    TRIGGER_SPACING: 12,
} as const

function getNextToTriggerPosition(target: HTMLElement, surveyWidth: number): React.CSSProperties | null {
    try {
        const buttonRect = target.getBoundingClientRect()
        const viewportHeight = window.innerHeight
        const viewportWidth = window.innerWidth
        const estimatedMinSurveyHeight = SURVEY_NEXT_TO_TRIGGER_PARAMS.ESTIMATED_MIN_HEIGHT
        const buttonCenterX = buttonRect.left + buttonRect.width / 2
        let left = buttonCenterX - surveyWidth / 2
        const horizontalPadding = SURVEY_NEXT_TO_TRIGGER_PARAMS.HORIZONTAL_PADDING
        if (left + surveyWidth > viewportWidth - horizontalPadding) {
            left = viewportWidth - surveyWidth - horizontalPadding
        }
        if (left < horizontalPadding) {
            left = horizontalPadding
        }
        const spacing = SURVEY_NEXT_TO_TRIGGER_PARAMS.TRIGGER_SPACING
        const spaceBelow = viewportHeight - buttonRect.bottom
        const spaceAbove = buttonRect.top
        const showAbove = spaceBelow < estimatedMinSurveyHeight && spaceAbove > spaceBelow

        return {
            position: 'fixed',
            top: showAbove ? 'auto' : `${buttonRect.bottom + spacing}px`,
            left: `${left}px`,
            right: 'auto',
            bottom: showAbove ? `${viewportHeight - buttonRect.top + spacing}px` : 'auto',
            zIndex: defaultSurveyAppearance.zIndex,
        } satisfies React.CSSProperties
    } catch (error) {
        logger.warn('Failed to calculate trigger position:', error)
        return null
    }
}

// Keep in sync with posthog/constants.py on main repo
const SURVEY_TARGETING_FLAG_PREFIX = 'survey-targeting-'

export class SurveyManager {
    private _posthog: PostHog
    private _surveyInFocus: string | null
    private _surveyTimeouts: Map<string, NodeJS.Timeout> = new Map()
    private _autoSubmitTimeout?: NodeJS.Timeout
    private _widgetSelectorListeners: Map<string, { element: Element; listener: EventListener; survey: Survey }> =
        new Map()
    private _prefillHandledSurveys: Set<string> = new Set()

    constructor(posthog: PostHog) {
        this._posthog = posthog
        // This is used to track the survey that is currently in focus. We only show one survey at a time.
        this._surveyInFocus = null
    }

    private _clearSurveyTimeout(surveyId: string) {
        const timeout = this._surveyTimeouts.get(surveyId)
        if (timeout) {
            clearTimeout(timeout)
            this._surveyTimeouts.delete(surveyId)
        }
    }

    public handlePopoverSurvey = (survey: Survey): void => {
        this._clearSurveyTimeout(survey.id)
        this._addSurveyToFocus(survey)
        const delaySeconds = survey.appearance?.surveyPopupDelaySeconds || 0
        const { shadow } = retrieveSurveyShadow(survey, this._posthog)
        if (delaySeconds <= 0) {
            return Preact.render(
                <SurveyPopup
                    posthog={this._posthog}
                    survey={survey}
                    removeSurveyFromFocus={this._removeSurveyFromFocus}
                />,
                shadow
            )
        }
        const timeoutId = setTimeout(() => {
            if (!doesSurveyUrlMatch(survey)) {
                return this._removeSurveyFromFocus(survey)
            }
            // rendering with surveyPopupDelaySeconds = 0 because we're already handling the timeout here
            Preact.render(
                <SurveyPopup
                    posthog={this._posthog}
                    survey={{ ...survey, appearance: { ...survey.appearance, surveyPopupDelaySeconds: 0 } }}
                    removeSurveyFromFocus={this._removeSurveyFromFocus}
                />,
                shadow
            )
        }, delaySeconds * 1000)
        this._surveyTimeouts.set(survey.id, timeoutId)
    }

    private _handleWidget = (survey: Survey): void => {
        // Ensure widget container exists if it doesn't
        const { shadow, isNewlyCreated } = retrieveSurveyShadow(survey, this._posthog)

        // If the widget is already rendered, do nothing. Otherwise the widget will be re-rendered every second
        if (!isNewlyCreated) {
            return
        }

        Preact.render(<FeedbackWidget posthog={this._posthog} survey={survey} key={survey.id} />, shadow)
    }

    private _removeWidgetSelectorListener = (survey: Pick<Survey, 'id' | 'type' | 'appearance'>): void => {
        this._removeSurveyFromDom(survey)
        const existing = this._widgetSelectorListeners.get(survey.id)
        if (existing) {
            existing.element.removeEventListener('click', existing.listener)
            existing.element.removeAttribute(WIDGET_LISTENER_ATTRIBUTE)
            this._widgetSelectorListeners.delete(survey.id)
            logger.info(`Removed click listener for survey ${survey.id}`)
        }
    }

    private _manageWidgetSelectorListener = (survey: Survey, selector: string): void => {
        const currentElement = document.querySelector(selector)
        const existingListenerData = this._widgetSelectorListeners.get(survey.id)

        if (!currentElement) {
            if (existingListenerData) {
                this._removeWidgetSelectorListener(survey)
            }
            return
        }

        this._handleWidget(survey)

        if (existingListenerData) {
            // Listener exists, check if element changed
            if (currentElement !== existingListenerData.element) {
                logger.info(`Selector element changed for survey ${survey.id}. Re-attaching listener.`)
                this._removeWidgetSelectorListener(survey)
                // Continue to attach listener to the new element below
            } else {
                // Element is the same, listener already attached, do nothing
                return
            }
        }

        // Element found, and no listener attached (or it was just removed from old element)
        if (!currentElement.hasAttribute(WIDGET_LISTENER_ATTRIBUTE)) {
            const listener = (event: Event) => {
                event.stopPropagation() // Prevent bubbling

                const positionStyles =
                    survey.appearance?.position === SurveyPosition.NextToTrigger
                        ? getNextToTriggerPosition(
                              event.currentTarget as HTMLElement,
                              parseInt(survey.appearance?.maxWidth || defaultSurveyAppearance.maxWidth)
                          )
                        : {}

                window.dispatchEvent(
                    new CustomEvent(DISPATCH_FEEDBACK_WIDGET_EVENT, {
                        detail: { surveyId: survey.id, position: positionStyles },
                    })
                )
            }

            addEventListener(currentElement, 'click', listener)
            currentElement.setAttribute(WIDGET_LISTENER_ATTRIBUTE, 'true')
            this._widgetSelectorListeners.set(survey.id, { element: currentElement, listener, survey })
            logger.info(`Attached click listener for feedback button survey ${survey.id}`)
        }
    }

    /**
     * Sorts surveys by their appearance delay in ascending order. If a survey does not have an appearance delay,
     * it is considered to have a delay of 0.
     * @param surveys
     * @returns The surveys sorted by their appearance delay
     */
    private _sortSurveysByAppearanceDelay(surveys: Survey[]): Survey[] {
        return surveys.sort((a, b) => {
            const isSurveyInProgressA = isSurveyInProgress(a)
            const isSurveyInProgressB = isSurveyInProgress(b)
            if (isSurveyInProgressA && !isSurveyInProgressB) {
                return -1 // a comes before b (in progress surveys first)
            }
            if (!isSurveyInProgressA && isSurveyInProgressB) {
                return 1 // a comes after b (in progress surveys first)
            }
            const aIsAlways = a.schedule === SurveySchedule.Always
            const bIsAlways = b.schedule === SurveySchedule.Always

            if (aIsAlways && !bIsAlways) {
                return 1 // a comes after b
            }
            if (!aIsAlways && bIsAlways) {
                return -1 // a comes before b
            }
            // If both are Always or neither is Always, sort by delay
            return (a.appearance?.surveyPopupDelaySeconds || 0) - (b.appearance?.surveyPopupDelaySeconds || 0)
        })
    }

    public renderPopover = (survey: Survey): void => {
        const { shadow } = retrieveSurveyShadow(survey, this._posthog)
        Preact.render(
            <SurveyPopup posthog={this._posthog} survey={survey} removeSurveyFromFocus={this._removeSurveyFromFocus} />,
            shadow
        )
    }

    public renderSurvey = (survey: Survey, selector: Element): void => {
        if (this._posthog.config?.surveys?.prefillFromUrl) {
            this._handleUrlPrefill(survey)
        }

        Preact.render(
            <SurveyPopup
                posthog={this._posthog}
                survey={survey}
                removeSurveyFromFocus={this._removeSurveyFromFocus}
                isPopup={false}
            />,
            selector
        )
    }

    private _handleUrlPrefill(survey: Survey): void {
        // Only handle prefill once per survey session to avoid overwriting in-progress responses
        if (this._prefillHandledSurveys.has(survey.id)) {
            return
        }

        try {
            const { params, autoSubmit } = extractPrefillParamsFromUrl(window.location.search)

            if (Object.keys(params).length === 0) {
                return
            }

            logger.info('[Survey Prefill] Detected URL prefill parameters')

            const responses = convertPrefillToResponses(survey, params)

            if (Object.keys(responses).length === 0) {
                logger.warn('[Survey Prefill] No valid responses after conversion')
                return
            }

            const submissionId = uuidv7()

            setInProgressSurveyState(survey, {
                surveySubmissionId: submissionId,
                responses: responses,
                lastQuestionIndex: 0,
            })

            logger.info('[Survey Prefill] Stored prefilled responses in localStorage')

            const shouldAutoSubmit =
                autoSubmit &&
                this._posthog.config.surveys?.autoSubmitIfComplete &&
                allRequiredQuestionsFilled(survey, responses)

            if (shouldAutoSubmit) {
                this._scheduleAutoSubmit(survey, responses, submissionId)
            }

            // Mark this survey as having been prefilled
            this._prefillHandledSurveys.add(survey.id)
        } catch (error) {
            logger.error('[Survey Prefill] Error handling URL prefill:', error)
        }
    }

    private _scheduleAutoSubmit(survey: Survey, responses: Record<string, any>, submissionId: string): void {
        const delay = this._posthog.config.surveys?.autoSubmitDelay ?? 800

        logger.info('[Survey Prefill] Auto-submit scheduled')

        this._autoSubmitTimeout = setTimeout(() => {
            logger.info('[Survey Prefill] Auto-submitting survey')

            sendSurveyEvent({
                responses,
                survey,
                surveySubmissionId: submissionId,
                posthog: this._posthog,
                isSurveyCompleted: true,
            })
        }, delay)
    }

    private _isSurveyFeatureFlagEnabled(flagKey: string | null, flagVariant: string | undefined = undefined) {
        if (!flagKey) {
            return true
        }
        const isFeatureEnabled = !!this._posthog.featureFlags.isFeatureEnabled(flagKey, {
            send_event: !flagKey.startsWith(SURVEY_TARGETING_FLAG_PREFIX),
        })
        let flagVariantCheck = true
        if (flagVariant) {
            const flagVariantValue = this._posthog.featureFlags.getFeatureFlag(flagKey, { send_event: false })
            flagVariantCheck = flagVariantValue === flagVariant || flagVariant === 'any'
        }
        return isFeatureEnabled && flagVariantCheck
    }

    private _isSurveyConditionMatched(survey: Survey): boolean {
        if (!survey.conditions) {
            return true
        }
        return doesSurveyUrlMatch(survey) && doesSurveyDeviceTypesMatch(survey) && doesSurveyMatchSelector(survey)
    }

    private _internalFlagCheckSatisfied(survey: Survey): boolean {
        return (
            canActivateRepeatedly(survey) ||
            this._isSurveyFeatureFlagEnabled(survey.internal_targeting_flag_key) ||
            isSurveyInProgress(survey)
        )
    }

    public checkSurveyEligibility(survey: Survey): { eligible: boolean; reason?: string } {
        const eligibility = { eligible: true, reason: undefined as string | undefined }

        if (!isSurveyRunning(survey)) {
            eligibility.eligible = false
            eligibility.reason = `Survey is not running. It was completed on ${survey.end_date}`
            return eligibility
        }

        if (!IN_APP_SURVEY_TYPES.includes(survey.type)) {
            eligibility.eligible = false
            eligibility.reason = `Surveys of type ${survey.type} are never eligible to be shown in the app`
            return eligibility
        }

        const linkedFlagVariant = survey.conditions?.linkedFlagVariant
        if (!this._isSurveyFeatureFlagEnabled(survey.linked_flag_key, linkedFlagVariant)) {
            eligibility.eligible = false
            if (!linkedFlagVariant) {
                eligibility.reason = `Survey linked feature flag is not enabled`
            } else {
                eligibility.reason = `Survey linked feature flag is not enabled for variant ${linkedFlagVariant}`
            }
            return eligibility
        }

        if (!this._isSurveyFeatureFlagEnabled(survey.targeting_flag_key)) {
            eligibility.eligible = false
            eligibility.reason = `Survey targeting feature flag is not enabled`
            return eligibility
        }

        if (!this._internalFlagCheckSatisfied(survey)) {
            eligibility.eligible = false
            eligibility.reason =
                'Survey internal targeting flag is not enabled and survey cannot activate repeatedly and survey is not in progress'
            return eligibility
        }

        if (!hasWaitPeriodPassed(survey.conditions?.seenSurveyWaitPeriodInDays)) {
            eligibility.eligible = false
            eligibility.reason = `Survey wait period has not passed`
            return eligibility
        }

        if (getSurveySeen(survey)) {
            eligibility.eligible = false
            eligibility.reason = `Survey has already been seen and it can't be activated again`
            return eligibility
        }

        return eligibility
    }

    /**
     * Surveys can be activated by events or actions. This method checks if the survey has events and actions,
     * and if so, it checks if the survey has been activated.
     * @param survey
     */
    private _hasActionOrEventTriggeredSurvey(survey: Survey): boolean {
        if (!doesSurveyActivateByEvent(survey) && !doesSurveyActivateByAction(survey)) {
            // If survey doesn't depend on events/actions, it's considered "triggered" by default
            return true
        }
        const surveysActivatedByEventsOrActions: string[] | undefined =
            this._posthog.surveys._surveyEventReceiver?.getSurveys()
        return !!surveysActivatedByEventsOrActions?.includes(survey.id)
    }

    private _checkFlags(survey: Survey): boolean {
        if (!survey.feature_flag_keys?.length) {
            return true
        }

        return survey.feature_flag_keys.every(({ key, value }) => {
            if (!key || !value) {
                return true
            }
            return this._isSurveyFeatureFlagEnabled(value)
        })
    }

    public getActiveMatchingSurveys = (callback: SurveyCallback, forceReload = false): void => {
        this._posthog?.surveys.getSurveys((surveys) => {
            const targetingMatchedSurveys = surveys.filter((survey) => {
                const eligibility = this.checkSurveyEligibility(survey)
                return (
                    eligibility.eligible &&
                    this._isSurveyConditionMatched(survey) &&
                    this._hasActionOrEventTriggeredSurvey(survey) &&
                    this._checkFlags(survey)
                )
            })

            callback(targetingMatchedSurveys)
        }, forceReload)
    }

    public callSurveysAndEvaluateDisplayLogic = (forceReload: boolean = false): void => {
        this.getActiveMatchingSurveys((surveys) => {
            const inAppSurveysWithDisplayLogic = surveys.filter(
                (survey) => survey.type === SurveyType.Popover || survey.type === SurveyType.Widget
            )

            // Create a queue of surveys sorted by their appearance delay.  We will evaluate the display logic
            // for each survey in the queue in order, and only display one survey at a time.
            const inAppSurveysQueue = this._sortSurveysByAppearanceDelay(inAppSurveysWithDisplayLogic)

            // Keep track of surveys processed this cycle to remove listeners for inactive ones
            const activeSelectorSurveys = new Set<string>()

            inAppSurveysQueue.forEach((survey) => {
                // Widget Type Logic
                if (survey.type === SurveyType.Widget) {
                    if (survey.appearance?.widgetType === SurveyWidgetType.Tab) {
                        this._handleWidget(survey)
                        return
                    }

                    // For selector widget types, we need to manage the listener attachment/detachment dynamically
                    if (
                        survey.appearance?.widgetType === SurveyWidgetType.Selector &&
                        survey.appearance?.widgetSelector
                    ) {
                        activeSelectorSurveys.add(survey.id)
                        this._manageWidgetSelectorListener(survey, survey.appearance?.widgetSelector)
                    }
                }

                // Popover Type Logic (only one shown at a time)
                if (isNull(this._surveyInFocus) && survey.type === SurveyType.Popover) {
                    this.handlePopoverSurvey(survey)
                }
            })

            // Clean up listeners for surveys that are no longer active or matched
            this._widgetSelectorListeners.forEach(({ survey }) => {
                if (!activeSelectorSurveys.has(survey.id)) {
                    this._removeWidgetSelectorListener(survey)
                }
            })
        }, forceReload)
    }

    private _addSurveyToFocus = (survey: Pick<Survey, 'id'>): void => {
        if (!isNull(this._surveyInFocus)) {
            logger.error(`Survey ${this._surveyInFocus} already in focus. Cannot add survey ${survey.id}.`)
        }
        this._surveyInFocus = survey.id
    }

    private _removeSurveyFromDom(survey: Pick<Survey, 'id' | 'type' | 'appearance'>): void {
        try {
            const shadowContainer = document.querySelector(getSurveyContainerClass(survey, true))
            if (shadowContainer?.shadowRoot) {
                Preact.render(null, shadowContainer.shadowRoot)
            }
            shadowContainer?.remove()
        } catch (error) {
            logger.warn(`Failed to remove survey ${survey.id} from DOM:`, error)
        }
    }

    private _removeSurveyFromFocus = (survey: SurveyWithTypeAndAppearance): void => {
        if (this._surveyInFocus !== survey.id) {
            logger.error(`Survey ${survey.id} is not in focus. Cannot remove survey ${survey.id}.`)
        }
        this._clearSurveyTimeout(survey.id)
        this._clearAutoSubmitTimeout()
        this._surveyInFocus = null
        this._removeSurveyFromDom(survey)
    }

    private _clearAutoSubmitTimeout(): void {
        if (this._autoSubmitTimeout) {
            clearTimeout(this._autoSubmitTimeout)
            this._autoSubmitTimeout = undefined
        }
    }

    // Expose internal state and methods for testing
    public getTestAPI() {
        return {
            addSurveyToFocus: this._addSurveyToFocus,
            removeSurveyFromFocus: this._removeSurveyFromFocus,
            surveyInFocus: this._surveyInFocus,
            surveyTimeouts: this._surveyTimeouts,
            handleWidget: this._handleWidget,
            handlePopoverSurvey: this.handlePopoverSurvey,
            manageWidgetSelectorListener: this._manageWidgetSelectorListener,
            sortSurveysByAppearanceDelay: this._sortSurveysByAppearanceDelay,
            checkFlags: this._checkFlags.bind(this),
            isSurveyFeatureFlagEnabled: this._isSurveyFeatureFlagEnabled.bind(this),
        }
    }
}

const DEFAULT_PREVIEW_POSITION_STYLES: React.CSSProperties = {
    position: 'relative',
    left: 'unset',
    right: 'unset',
    top: 'unset',
    bottom: 'unset',
    transform: 'unset',
}

export const renderSurveysPreview = ({
    survey,
    parentElement,
    previewPageIndex,
    forceDisableHtml,
    onPreviewSubmit,
    positionStyles = DEFAULT_PREVIEW_POSITION_STYLES,
}: {
    survey: Survey
    parentElement: HTMLElement
    previewPageIndex: number
    forceDisableHtml?: boolean
    onPreviewSubmit?: (res: string | string[] | number | null) => void
    posthog?: PostHog
    positionStyles?: React.CSSProperties
}) => {
    const currentStyle = parentElement.querySelector('style[data-ph-survey-style]')
    if (currentStyle) {
        currentStyle.remove()
    }
    const stylesheet = getSurveyStylesheet()
    if (stylesheet) {
        parentElement.appendChild(stylesheet)
        addSurveyCSSVariablesToElement(parentElement, survey.type, survey.appearance)
    }
    Preact.render(
        <SurveyPopup
            survey={survey}
            forceDisableHtml={forceDisableHtml}
            style={positionStyles}
            onPreviewSubmit={onPreviewSubmit}
            previewPageIndex={previewPageIndex}
            removeSurveyFromFocus={() => {}}
        />,
        parentElement
    )
}

export const renderFeedbackWidgetPreview = ({
    survey,
    root,
    forceDisableHtml,
}: {
    survey: Survey
    root: HTMLElement
    forceDisableHtml?: boolean
}) => {
    const stylesheet = getSurveyStylesheet()
    if (stylesheet) {
        root.appendChild(stylesheet)
        addSurveyCSSVariablesToElement(root, survey.type, survey.appearance)
    }

    Preact.render(<FeedbackWidget forceDisableHtml={forceDisableHtml} survey={survey} readOnly={true} />, root)
}

// This is the main exported function
export function generateSurveys(posthog: PostHog, isSurveysEnabled: boolean | undefined) {
    // NOTE: Important to ensure we never try and run surveys without a window environment
    if (!document || !window) {
        return
    }

    const surveyManager = new SurveyManager(posthog)
    if (posthog.config.disable_surveys_automatic_display) {
        logger.info('Surveys automatic display is disabled. Skipping call surveys and evaluate display logic.')
        return surveyManager
    }

    // NOTE: The `generateSurveys` function used to accept just a single parameter, without any `isSurveysEnabled` parameter.
    // To keep compatibility with old clients, we'll consider `undefined` the same as `true`
    if (isSurveysEnabled === false) {
        logger.info('There are no surveys to load or Surveys is disabled in the project settings.')
        return surveyManager
    }

    surveyManager.callSurveysAndEvaluateDisplayLogic(true)

    let intervalId: number | undefined

    const startInterval = () => {
        if (!isUndefined(intervalId)) {
            return
        }
        intervalId = setInterval(() => {
            surveyManager.callSurveysAndEvaluateDisplayLogic(false)
        }, 1000) as unknown as number
    }

    const stopInterval = () => {
        if (!isUndefined(intervalId)) {
            clearInterval(intervalId)
            intervalId = undefined
        }
    }

    startInterval()

    addEventListener(document, 'visibilitychange', () => {
        if (document.hidden) {
            stopInterval()
        } else {
            surveyManager.callSurveysAndEvaluateDisplayLogic(false)
            startInterval()
        }
    })

    return surveyManager
}

type UseHideSurveyOnURLChangeProps = {
    survey: Pick<Survey, 'id' | 'conditions' | 'type' | 'appearance'>
    removeSurveyFromFocus?: (survey: SurveyWithTypeAndAppearance) => void
    setSurveyVisible: (visible: boolean) => void
    isPreviewMode?: boolean
}

/**
 * This hook handles URL-based survey visibility after the initial mount.
 * The initial URL check is handled by the `getActiveMatchingSurveys` method in  the `PostHogSurveys` class,
 * which ensures the URL matches before displaying a survey for the first time.
 * That is the method that is called every second to see if there's a matching survey.
 *
 * This separation of concerns means:
 * 1. Initial URL matching is done by `getActiveMatchingSurveys` before displaying the survey
 * 2. Subsequent URL changes are handled here to hide the survey as the user navigates
 */
export function useHideSurveyOnURLChange({
    survey,
    removeSurveyFromFocus = () => {},
    setSurveyVisible,
    isPreviewMode = false,
}: UseHideSurveyOnURLChangeProps) {
    useEffect(() => {
        if (isPreviewMode || !survey.conditions?.url) {
            return
        }

        const checkUrlMatch = () => {
            const isSurveyTypeWidget = survey.type === SurveyType.Widget
            const doesSurveyMatchUrlCondition = doesSurveyUrlMatch(survey)
            const isSurveyWidgetTypeTab = survey.appearance?.widgetType === SurveyWidgetType.Tab && isSurveyTypeWidget

            if (doesSurveyMatchUrlCondition) {
                if (isSurveyWidgetTypeTab) {
                    logger.info(`Showing survey ${survey.id} because it is a feedback button tab and URL matches`)
                    setSurveyVisible(true)
                }
                return
            }

            logger.info(`Hiding survey ${survey.id} because URL does not match`)
            setSurveyVisible(false)
            return removeSurveyFromFocus(survey)
        }

        // Listen for browser back/forward browser history changes
        addEventListener(window, 'popstate', checkUrlMatch)
        // Listen for hash changes, for SPA frameworks that use hash-based routing
        // The hashchange event is fired when the fragment identifier of the URL has changed (the part of the URL beginning with and following the # symbol).
        addEventListener(window, 'hashchange', checkUrlMatch)

        // Listen for SPA navigation
        const originalPushState = window.history.pushState
        const originalReplaceState = window.history.replaceState

        window.history.pushState = function (...args) {
            originalPushState.apply(this, args)
            checkUrlMatch()
        }

        window.history.replaceState = function (...args) {
            originalReplaceState.apply(this, args)
            checkUrlMatch()
        }

        return () => {
            window.removeEventListener('popstate', checkUrlMatch)
            window.removeEventListener('hashchange', checkUrlMatch)
            window.history.pushState = originalPushState
            window.history.replaceState = originalReplaceState
        }
    }, [isPreviewMode, survey, removeSurveyFromFocus, setSurveyVisible])
}

export function usePopupVisibility(
    survey: Survey,
    posthog: PostHog | undefined,
    millisecondDelay: number,
    isPreviewMode: boolean,
    removeSurveyFromFocus: (survey: SurveyWithTypeAndAppearance) => void,
    isPopup: boolean,
    surveyContainerRef?: React.RefObject<HTMLDivElement>
) {
    const [isPopupVisible, setIsPopupVisible] = useState(
        isPreviewMode || millisecondDelay === 0 || survey.type === SurveyType.ExternalSurvey
    )
    const [isSurveySent, setIsSurveySent] = useState(false)

    const hidePopupWithViewTransition = () => {
        const removeDOMAndHidePopup = () => {
            if (isPopup) {
                removeSurveyFromFocus(survey)
            }
            setIsPopupVisible(false)
        }

        if (!document.startViewTransition) {
            removeDOMAndHidePopup()
            return
        }

        const transition = document.startViewTransition(() => {
            surveyContainerRef?.current?.remove()
        })

        transition.finished.then(() => {
            setTimeout(() => {
                removeDOMAndHidePopup()
            }, 100)
        })
    }

    const handleSurveyClosed = (event: CustomEvent) => {
        if (event.detail.surveyId !== survey.id) {
            return
        }
        hidePopupWithViewTransition()
    }

    useEffect(() => {
        if (!posthog) {
            logger.error('usePopupVisibility hook called without a PostHog instance.')
            return
        }
        if (isPreviewMode) {
            return
        }

        const handleSurveySent = (event: CustomEvent) => {
            if (event.detail.surveyId !== survey.id) {
                return
            }
            if (!survey.appearance?.displayThankYouMessage) {
                return hidePopupWithViewTransition()
            }
            setIsSurveySent(true)
            if (survey.appearance?.autoDisappear) {
                setTimeout(() => {
                    hidePopupWithViewTransition()
                }, 5000)
            }
        }

        const showSurvey = () => {
            // check if the url is still matching, necessary for delayed surveys, as the URL may have changed
            if (!doesSurveyUrlMatch(survey)) {
                return
            }
            setIsPopupVisible(true)
            window.dispatchEvent(new Event('PHSurveyShown'))
            posthog.capture(SurveyEventName.SHOWN, {
                [SurveyEventProperties.SURVEY_NAME]: survey.name,
                [SurveyEventProperties.SURVEY_ID]: survey.id,
                [SurveyEventProperties.SURVEY_ITERATION]: survey.current_iteration,
                [SurveyEventProperties.SURVEY_ITERATION_START_DATE]: survey.current_iteration_start_date,
                sessionRecordingUrl: posthog.get_session_replay_url?.(),
            })
            localStorage.setItem('lastSeenSurveyDate', new Date().toISOString())
        }

        addEventListener(window, 'PHSurveyClosed', handleSurveyClosed as EventListener)
        addEventListener(window, 'PHSurveySent', handleSurveySent as EventListener)

        if (millisecondDelay > 0) {
            // This path is only used for direct usage of SurveyPopup,
            // not for surveys managed by SurveyManager
            const timeoutId = setTimeout(showSurvey, millisecondDelay)
            return () => {
                clearTimeout(timeoutId)
                window.removeEventListener('PHSurveyClosed', handleSurveyClosed as EventListener)
                window.removeEventListener('PHSurveySent', handleSurveySent as EventListener)
            }
        } else {
            // This is the path used for surveys managed by SurveyManager
            showSurvey()
            return () => {
                window.removeEventListener('PHSurveyClosed', handleSurveyClosed as EventListener)
                window.removeEventListener('PHSurveySent', handleSurveySent as EventListener)
            }
        }
    }, [])

    useHideSurveyOnURLChange({
        survey,
        removeSurveyFromFocus,
        setSurveyVisible: setIsPopupVisible,
        isPreviewMode,
    })

    return { isPopupVisible, isSurveySent, setIsPopupVisible, hidePopupWithViewTransition }
}

interface SurveyPopupProps {
    survey: Survey
    forceDisableHtml?: boolean
    posthog?: PostHog
    style?: React.CSSProperties
    previewPageIndex?: number | undefined
    removeSurveyFromFocus?: (survey: SurveyWithTypeAndAppearance) => void
    isPopup?: boolean
    onPreviewSubmit?: (res: string | string[] | number | null) => void
    onPopupSurveyDismissed?: () => void
    onCloseConfirmationMessage?: () => void
}

function getPopoverPosition(
    type: SurveyType,
    position: SurveyPosition = SurveyPosition.Right,
    surveyWidgetType?: SurveyWidgetType
) {
    if (type === SurveyType.ExternalSurvey) {
        return {}
    }

    switch (position) {
        case SurveyPosition.TopLeft:
            return { top: '0', left: '0', transform: 'translate(30px, 30px)' }
        case SurveyPosition.TopRight:
            return { top: '0', right: '0', transform: 'translate(-30px, 30px)' }
        case SurveyPosition.TopCenter:
            return { top: '0', left: '50%', transform: 'translate(-50%, 30px)' }
        case SurveyPosition.MiddleLeft:
            return { top: '50%', left: '0', transform: 'translate(30px, -50%)' }
        case SurveyPosition.MiddleRight:
            return { top: '50%', right: '0', transform: 'translate(-30px, -50%)' }
        case SurveyPosition.MiddleCenter:
            return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
        case SurveyPosition.Left:
            return { left: '30px' }
        case SurveyPosition.Center:
            return {
                left: '50%',
                transform: 'translateX(-50%)',
            }
        default:
        case SurveyPosition.Right:
            return { right: type === SurveyType.Widget && surveyWidgetType === SurveyWidgetType.Tab ? '60px' : '30px' }
    }
}

function getTabPositionStyles(position: SurveyTabPosition = SurveyTabPosition.Right): React.CSSProperties {
    switch (position) {
        case SurveyTabPosition.Top:
            return { top: '0', left: '50%', transform: 'translateX(-50%)' }
        case SurveyTabPosition.Left:
            return { top: '50%', left: '0', transform: 'rotate(90deg) translateY(-100%)', transformOrigin: 'left top' }
        case SurveyTabPosition.Bottom: // bottom center
            return { bottom: '0', left: '50%', transform: 'translateX(-50%)' }
        default:
        case SurveyTabPosition.Right:
            // not perfectly centered vertically, to avoid a "breaking" change
            return {
                top: '50%',
                right: '0',
                transform: 'rotate(-90deg) translateY(-100%)',
                transformOrigin: 'right top',
            }
    }
}

export function SurveyPopup({
    survey,
    forceDisableHtml,
    posthog,
    style = {},
    previewPageIndex,
    removeSurveyFromFocus = () => {},
    isPopup = true,
    onPreviewSubmit = () => {},
    onPopupSurveyDismissed = () => {},
    onCloseConfirmationMessage = () => {},
}: SurveyPopupProps) {
    const surveyContainerRef = useRef<HTMLDivElement>(null)
    const isPreviewMode = Number.isInteger(previewPageIndex)
    // NB: The client-side code passes the millisecondDelay in seconds, but setTimeout expects milliseconds, so we multiply by 1000
    const surveyPopupDelayMilliseconds = survey.appearance?.surveyPopupDelaySeconds
        ? survey.appearance.surveyPopupDelaySeconds * 1000
        : 0
    const { isPopupVisible, isSurveySent, hidePopupWithViewTransition } = usePopupVisibility(
        survey,
        posthog,
        surveyPopupDelayMilliseconds,
        isPreviewMode,
        removeSurveyFromFocus,
        isPopup,
        surveyContainerRef
    )

    const shouldShowConfirmation = isSurveySent || previewPageIndex === survey.questions.length
    const surveyContextValue = useMemo(() => {
        const getInProgressSurvey = getInProgressSurveyState(survey)
        return {
            isPreviewMode,
            previewPageIndex: previewPageIndex,
            onPopupSurveyDismissed: () => {
                dismissedSurveyEvent(survey, posthog, isPreviewMode)
                onPopupSurveyDismissed()
            },
            isPopup: isPopup || false,
            surveySubmissionId: getInProgressSurvey?.surveySubmissionId || uuidv7(),
            onPreviewSubmit,
            posthog,
        }
    }, [isPreviewMode, previewPageIndex, isPopup, posthog, survey, onPopupSurveyDismissed, onPreviewSubmit])

    if (!isPopupVisible) {
        return null
    }

    return (
        <SurveyContext.Provider value={surveyContextValue}>
            <div
                className="ph-survey"
                style={{
                    ...getPopoverPosition(survey.type, survey.appearance?.position, survey.appearance?.widgetType),
                    ...style,
                }}
                ref={surveyContainerRef}
            >
                {!shouldShowConfirmation ? (
                    <Questions survey={survey} forceDisableHtml={!!forceDisableHtml} posthog={posthog} />
                ) : (
                    <ConfirmationMessage
                        header={survey.appearance?.thankYouMessageHeader || 'Thank you!'}
                        description={survey.appearance?.thankYouMessageDescription || ''}
                        forceDisableHtml={!!forceDisableHtml}
                        contentType={survey.appearance?.thankYouMessageDescriptionContentType}
                        appearance={survey.appearance || defaultSurveyAppearance}
                        onClose={() => {
                            hidePopupWithViewTransition()
                            onCloseConfirmationMessage()
                        }}
                    />
                )}
            </div>
        </SurveyContext.Provider>
    )
}

export function Questions({
    survey,
    forceDisableHtml,
    posthog,
}: {
    survey: Survey
    forceDisableHtml: boolean
    posthog?: PostHog
}) {
    // Initialize responses from localStorage or empty object
    const [questionsResponses, setQuestionsResponses] = useState(() => {
        const inProgressSurveyData = getInProgressSurveyState(survey)
        if (inProgressSurveyData?.responses) {
            logger.info('Survey is already in progress, filling in initial responses')
        }
        return inProgressSurveyData?.responses || {}
    })
    const { previewPageIndex, onPopupSurveyDismissed, isPopup, onPreviewSubmit, surveySubmissionId, isPreviewMode } =
        useContext(SurveyContext)
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(() => {
        const inProgressSurveyData = getInProgressSurveyState(survey)
        return previewPageIndex || inProgressSurveyData?.lastQuestionIndex || 0
    })
    const surveyQuestions = useMemo(() => getDisplayOrderQuestions(survey), [survey])

    // Sync preview state
    useEffect(() => {
        if (isPreviewMode && !isUndefined(previewPageIndex)) {
            setCurrentQuestionIndex(previewPageIndex)
        }
    }, [previewPageIndex, isPreviewMode])

    const onNextButtonClick = ({
        res,
        displayQuestionIndex,
        questionId,
    }: {
        res: string | string[] | number | null
        displayQuestionIndex: number
        questionId?: string
    }) => {
        if (!posthog) {
            logger.error('onNextButtonClick called without a PostHog instance.')
            return
        }

        if (!questionId) {
            logger.error('onNextButtonClick called without a questionId.')
            return
        }

        const responseKey = getSurveyResponseKey(questionId)

        const newResponses = { ...questionsResponses, [responseKey]: res }
        setQuestionsResponses(newResponses)

        const nextStep = getNextSurveyStep(survey, displayQuestionIndex, res)
        const isSurveyCompleted = nextStep === SurveyQuestionBranchingType.End

        if (!isSurveyCompleted) {
            setCurrentQuestionIndex(nextStep)
            setInProgressSurveyState(survey, {
                surveySubmissionId: surveySubmissionId,
                responses: newResponses,
                lastQuestionIndex: nextStep,
            })
        }

        // If partial responses are enabled, send the survey sent event with with the responses,
        // otherwise only send the event when the survey is completed
        if (survey.enable_partial_responses || isSurveyCompleted) {
            sendSurveyEvent({
                responses: newResponses,
                survey,
                surveySubmissionId,
                isSurveyCompleted,
                posthog,
            })
        }
    }

    const currentQuestion = surveyQuestions.at(currentQuestionIndex)

    if (!currentQuestion) {
        return null
    }

    return (
        <form className="survey-form" name="surveyForm">
            {isPopup && (
                <Cancel
                    onClick={() => {
                        onPopupSurveyDismissed()
                    }}
                />
            )}
            <div className="survey-box">
                {getQuestionComponent({
                    question: currentQuestion,
                    forceDisableHtml,
                    displayQuestionIndex: currentQuestionIndex,
                    appearance: survey.appearance || defaultSurveyAppearance,
                    onSubmit: (res) =>
                        onNextButtonClick({
                            res,
                            displayQuestionIndex: currentQuestionIndex,
                            questionId: currentQuestion.id,
                        }),
                    onPreviewSubmit,
                    initialValue: currentQuestion.id
                        ? questionsResponses[getSurveyResponseKey(currentQuestion.id)]
                        : undefined,
                })}
            </div>
        </form>
    )
}

export function FeedbackWidget({
    survey,
    forceDisableHtml,
    posthog,
    readOnly,
}: {
    survey: Survey
    forceDisableHtml?: boolean
    posthog?: PostHog
    readOnly?: boolean
}): JSX.Element | null {
    const [isFeedbackButtonVisible, setIsFeedbackButtonVisible] = useState(true)
    const [showSurvey, setShowSurvey] = useState(false)
    const [styleOverrides, setStyleOverrides] = useState<React.CSSProperties>({})

    const toggleSurvey = () => {
        setShowSurvey(!showSurvey)
    }

    useEffect(() => {
        if (!posthog) {
            logger.error('FeedbackWidget called without a PostHog instance.')
            return
        }
        if (readOnly) {
            return
        }

        if (survey.appearance?.widgetType === 'tab') {
            setStyleOverrides({
                top: '50%',
                bottom: 'auto',
            })
        }
        const handleShowSurvey = (event: Event) => {
            const customEvent = event as CustomEvent
            // Check if the event is for this specific survey instance
            if (customEvent.detail?.surveyId === survey.id) {
                logger.info(`Received show event for feedback button survey ${survey.id}`)
                setStyleOverrides(customEvent.detail.position || {})
                toggleSurvey()
            }
        }

        addEventListener(window, DISPATCH_FEEDBACK_WIDGET_EVENT, handleShowSurvey)

        // Cleanup listener on component unmount
        return () => {
            window.removeEventListener(DISPATCH_FEEDBACK_WIDGET_EVENT, handleShowSurvey)
        }
    }, [
        posthog,
        readOnly,
        survey.id,
        survey.appearance?.widgetType,
        survey.appearance?.widgetSelector,
        survey.appearance?.borderColor,
    ])

    useHideSurveyOnURLChange({
        survey,
        setSurveyVisible: setIsFeedbackButtonVisible,
    })

    if (!isFeedbackButtonVisible) {
        return null
    }

    const resetShowSurvey = () => {
        // hide the feedback button after answering or closing the survey if it's not always show
        if (survey.schedule !== SurveySchedule.Always) {
            setIsFeedbackButtonVisible(false)
        }
        // important so our view transition has time to run
        setTimeout(() => {
            setShowSurvey(false)
        }, 200)
    }

    return (
        <Preact.Fragment>
            {survey.appearance?.widgetType === 'tab' && (
                <button
                    className={`ph-survey-widget-tab ${survey.appearance?.tabPosition === SurveyTabPosition.Top ? 'widget-tab-top' : ''}`}
                    onClick={toggleSurvey}
                    disabled={readOnly}
                    style={getTabPositionStyles(survey.appearance?.tabPosition)}
                >
                    {survey.appearance?.widgetLabel || ''}
                </button>
            )}
            {showSurvey && (
                <SurveyPopup
                    posthog={posthog}
                    survey={survey}
                    forceDisableHtml={forceDisableHtml}
                    style={styleOverrides}
                    onPopupSurveyDismissed={resetShowSurvey}
                    onCloseConfirmationMessage={resetShowSurvey}
                />
            )}
        </Preact.Fragment>
    )
}

interface GetQuestionComponentProps extends CommonQuestionProps {
    question: SurveyQuestion
    displayQuestionIndex: number
}

const getQuestionComponent = ({
    question,
    forceDisableHtml,
    displayQuestionIndex,
    appearance,
    onSubmit,
    onPreviewSubmit,
    initialValue,
}: GetQuestionComponentProps): JSX.Element | null => {
    const baseProps = {
        forceDisableHtml,
        appearance,
        onPreviewSubmit: (res: string | string[] | number | null) => {
            onPreviewSubmit(res)
        },
        onSubmit: (res: string | string[] | number | null) => {
            onSubmit(res)
        },
        initialValue,
        displayQuestionIndex,
    }

    switch (question.type) {
        case SurveyQuestionType.Open:
            return <OpenTextQuestion {...baseProps} question={question} key={question.id} />
        case SurveyQuestionType.Link:
            return <LinkQuestion {...baseProps} question={question} key={question.id} />
        case SurveyQuestionType.Rating:
            return <RatingQuestion {...baseProps} question={question} key={question.id} />
        case SurveyQuestionType.SingleChoice:
        case SurveyQuestionType.MultipleChoice:
            return <MultipleChoiceQuestion {...baseProps} question={question} key={question.id} />
        default:
            logger.error(`Unsupported question type: ${(question as any).type}`)
            return null
    }
}
