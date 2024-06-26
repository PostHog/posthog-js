import { PostHog } from '../posthog-core'
import {
    Survey,
    SurveyAppearance,
    SurveyQuestion,
    SurveyQuestionBranchingType,
    SurveyQuestionType,
    SurveyType,
} from '../posthog-surveys-types'

import { window as _window, document as _document } from '../utils/globals'
import {
    style,
    defaultSurveyAppearance,
    sendSurveyEvent,
    dismissedSurveyEvent,
    createShadow,
    getContrastingTextColor,
    SurveyContext,
    getDisplayOrderQuestions,
    getSurveySeenKey,
} from './surveys/surveys-utils'
import * as Preact from 'preact'
import { createWidgetShadow, createWidgetStyle } from './surveys-widget'
import { useState, useEffect, useRef, useContext, useMemo } from 'preact/hooks'
import { isNull, isNumber } from '../utils/type-utils'
import { ConfirmationMessage } from './surveys/components/ConfirmationMessage'
import {
    OpenTextQuestion,
    LinkQuestion,
    RatingQuestion,
    MultipleChoiceQuestion,
} from './surveys/components/QuestionTypes'
import { logger } from '../utils/logger'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const window = _window as Window & typeof globalThis
const document = _document as Document

export class SurveyManager {
    private posthog: PostHog
    private surveyInFocus: string | null

    constructor(posthog: PostHog) {
        this.posthog = posthog
        // This is used to track the survey that is currently in focus. We only show one survey at a time.
        this.surveyInFocus = null
    }

    private canShowNextEventBasedSurvey = (): boolean => {
        // with event based surveys, we need to show the next survey without reloading the page.
        // A simple check for div elements with the class name pattern of PostHogSurvey_xyz doesn't work here
        // because preact leaves behind the div element for any surveys responded/dismissed with a <style> node.
        // To alleviate this, we check the last div in the dom and see if it has any elements other than a Style node.
        // if the last PostHogSurvey_xyz div has only one style node, we can show the next survey in the queue
        // without reloading the page.
        const surveyPopups = document.querySelectorAll(`div[class^=PostHogSurvey]`)
        if (surveyPopups.length > 0) {
            return surveyPopups[surveyPopups.length - 1].shadowRoot?.childElementCount === 1
        }
        return true
    }

    private handlePopoverSurvey = (survey: Survey): void => {
        const surveyWaitPeriodInDays = survey.conditions?.seenSurveyWaitPeriodInDays
        const lastSeenSurveyDate = localStorage.getItem(`lastSeenSurveyDate`)
        if (surveyWaitPeriodInDays && lastSeenSurveyDate) {
            const today = new Date()
            const diff = Math.abs(today.getTime() - new Date(lastSeenSurveyDate).getTime())
            const diffDaysFromToday = Math.ceil(diff / (1000 * 3600 * 24))
            if (diffDaysFromToday < surveyWaitPeriodInDays) {
                return
            }
        }

        if (!localStorage.getItem(getSurveySeenKey(survey))) {
            this.addSurveyToFocus(survey.id)
            const shadow = createShadow(style(survey?.appearance), survey.id)
            Preact.render(
                <SurveyPopup
                    key={'popover-survey'}
                    posthog={this.posthog}
                    survey={survey}
                    removeSurveyFromFocus={this.removeSurveyFromFocus}
                />,
                shadow
            )
        }
    }

    private handleWidget = (survey: Survey): void => {
        const shadow = createWidgetShadow(survey)
        const surveyStyleSheet = style(survey.appearance)
        shadow.appendChild(Object.assign(document.createElement('style'), { innerText: surveyStyleSheet }))
        Preact.render(
            <FeedbackWidget
                key={'feedback-survey'}
                posthog={this.posthog}
                survey={survey}
                removeSurveyFromFocus={this.removeSurveyFromFocus}
            />,
            shadow
        )
    }

    private handleWidgetSelector = (survey: Survey): void => {
        const selectorOnPage =
            survey.appearance?.widgetSelector && document.querySelector(survey.appearance.widgetSelector)
        if (selectorOnPage) {
            if (document.querySelectorAll(`.PostHogWidget${survey.id}`).length === 0) {
                this.handleWidget(survey)
            } else if (document.querySelectorAll(`.PostHogWidget${survey.id}`).length === 1) {
                // we have to check if user selector already has a survey listener attached to it because we always have to check if it's on the page or not
                if (!selectorOnPage.getAttribute('PHWidgetSurveyClickListener')) {
                    const surveyPopup = document
                        .querySelector(`.PostHogWidget${survey.id}`)
                        ?.shadowRoot?.querySelector(`.survey-form`) as HTMLFormElement
                    selectorOnPage.addEventListener('click', () => {
                        if (surveyPopup) {
                            surveyPopup.style.display = surveyPopup.style.display === 'none' ? 'block' : 'none'
                            surveyPopup.addEventListener('PHSurveyClosed', () => {
                                this.removeSurveyFromFocus(survey.id)
                                surveyPopup.style.display = 'none'
                            })
                        }
                    })
                    selectorOnPage.setAttribute('PHWidgetSurveyClickListener', 'true')
                }
            }
        }
    }

    /**
     * Sorts surveys by their appearance delay in ascending order. If a survey does not have an appearance delay,
     * it is considered to have a delay of 0.
     * @param surveys
     * @returns The surveys sorted by their appearance delay
     */
    private sortSurveysByAppearanceDelay(surveys: Survey[]): Survey[] {
        return surveys.sort(
            (a, b) => (a.appearance?.surveyPopupDelaySeconds || 0) - (b.appearance?.surveyPopupDelaySeconds || 0)
        )
    }

    public callSurveysAndEvaluateDisplayLogic = (forceReload: boolean = false): void => {
        this.posthog?.getActiveMatchingSurveys((surveys) => {
            const nonAPISurveys = surveys.filter((survey) => survey.type !== 'api')

            // Create a queue of surveys sorted by their appearance delay.  We will evaluate the display logic
            // for each survey in the queue in order, and only display one survey at a time.
            const nonAPISurveyQueue = this.sortSurveysByAppearanceDelay(nonAPISurveys)

            nonAPISurveyQueue.forEach((survey) => {
                // We only evaluate the display logic for one survey at a time
                if (!isNull(this.surveyInFocus)) {
                    return
                }
                if (survey.type === SurveyType.Widget) {
                    if (
                        survey.appearance?.widgetType === 'tab' &&
                        document.querySelectorAll(`.PostHogWidget${survey.id}`).length === 0
                    ) {
                        this.handleWidget(survey)
                    }
                    if (survey.appearance?.widgetType === 'selector' && survey.appearance?.widgetSelector) {
                        this.handleWidgetSelector(survey)
                    }
                }

                if (survey.type === SurveyType.Popover && this.canShowNextEventBasedSurvey()) {
                    this.handlePopoverSurvey(survey)
                }
            })
        }, forceReload)
    }

    private addSurveyToFocus = (id: string): void => {
        if (!isNull(this.surveyInFocus)) {
            logger.error(`Survey ${[...this.surveyInFocus]} already in focus. Cannot add survey ${id}.`)
        }
        this.surveyInFocus = id
    }

    private removeSurveyFromFocus = (id: string): void => {
        if (this.surveyInFocus !== id) {
            logger.error(`Survey ${id} is not in focus. Cannot remove survey ${id}.`)
        }
        this.surveyInFocus = null
    }

    // Expose internal state and methods for testing
    public getTestAPI() {
        return {
            addSurveyToFocus: this.addSurveyToFocus,
            removeSurveyFromFocus: this.removeSurveyFromFocus,
            surveyInFocus: this.surveyInFocus,
            canShowNextEventBasedSurvey: this.canShowNextEventBasedSurvey,
            handleWidget: this.handleWidget,
            handlePopoverSurvey: this.handlePopoverSurvey,
            handleWidgetSelector: this.handleWidgetSelector,
            sortSurveysByAppearanceDelay: this.sortSurveysByAppearanceDelay,
        }
    }
}

export const renderSurveysPreview = ({
    survey,
    parentElement,
    previewPageIndex,
    forceDisableHtml,
}: {
    survey: Survey
    parentElement: HTMLElement
    previewPageIndex: number
    forceDisableHtml?: boolean
}) => {
    const surveyStyleSheet = style(survey.appearance)
    const styleElement = Object.assign(document.createElement('style'), { innerText: surveyStyleSheet })

    // Remove previously attached <style>
    Array.from(parentElement.children).forEach((child) => {
        if (child instanceof HTMLStyleElement) {
            parentElement.removeChild(child)
        }
    })

    parentElement.appendChild(styleElement)
    const textColor = getContrastingTextColor(
        survey.appearance?.backgroundColor || defaultSurveyAppearance.backgroundColor || 'white'
    )

    Preact.render(
        <SurveyPopup
            key="surveys-render-preview"
            survey={survey}
            forceDisableHtml={forceDisableHtml}
            style={{
                position: 'relative',
                right: 0,
                borderBottom: `1px solid ${survey.appearance?.borderColor}`,
                borderRadius: 10,
                color: textColor,
            }}
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
    const widgetStyleSheet = createWidgetStyle(survey.appearance?.widgetColor)
    const styleElement = Object.assign(document.createElement('style'), { innerText: widgetStyleSheet })
    root.appendChild(styleElement)
    Preact.render(
        <FeedbackWidget
            key={'feedback-render-preview'}
            forceDisableHtml={forceDisableHtml}
            survey={survey}
            readOnly={true}
            removeSurveyFromFocus={() => {}}
        />,
        root
    )
}

// This is the main exported function
export function generateSurveys(posthog: PostHog) {
    // NOTE: Important to ensure we never try and run surveys without a window environment
    if (!document || !window) {
        return
    }

    const surveyManager = new SurveyManager(posthog)
    surveyManager.callSurveysAndEvaluateDisplayLogic(true)

    // recalculate surveys every second to check if URL or selectors have changed
    setInterval(() => {
        surveyManager.callSurveysAndEvaluateDisplayLogic(false)
    }, 1000)
}

export function usePopupVisibility(
    survey: Survey,
    posthog: PostHog | undefined,
    millisecondDelay: number,
    isPreviewMode: boolean,
    removeSurveyFromFocus: (id: string) => void
) {
    const [isPopupVisible, setIsPopupVisible] = useState(isPreviewMode || millisecondDelay === 0)
    const [isSurveySent, setIsSurveySent] = useState(false)

    useEffect(() => {
        if (isPreviewMode || !posthog) {
            return
        }

        const handleSurveyClosed = () => {
            removeSurveyFromFocus(survey.id)
            setIsPopupVisible(false)
        }

        const handleSurveySent = () => {
            if (!survey.appearance?.displayThankYouMessage) {
                removeSurveyFromFocus(survey.id)
                setIsPopupVisible(false)
            } else {
                setIsSurveySent(true)
                removeSurveyFromFocus(survey.id)
                if (survey.appearance?.autoDisappear) {
                    setTimeout(() => {
                        setIsPopupVisible(false)
                    }, 5000)
                }
            }
        }

        const showSurvey = () => {
            setIsPopupVisible(true)
            window.dispatchEvent(new Event('PHSurveyShown'))
            posthog.capture('survey shown', {
                $survey_name: survey.name,
                $survey_id: survey.id,
                $survey_iteration: survey.current_iteration,
                $survey_iteration_start_date: survey.current_iteration_start_date,
                sessionRecordingUrl: posthog.get_session_replay_url?.(),
            })
            localStorage.setItem('lastSeenSurveyDate', new Date().toISOString())
        }

        const handleShowSurveyWithDelay = () => {
            const timeoutId = setTimeout(() => {
                showSurvey()
            }, millisecondDelay)

            return () => {
                clearTimeout(timeoutId)
                window.removeEventListener('PHSurveyClosed', handleSurveyClosed)
                window.removeEventListener('PHSurveySent', handleSurveySent)
            }
        }

        const handleShowSurveyImmediately = () => {
            showSurvey()
            return () => {
                window.removeEventListener('PHSurveyClosed', handleSurveyClosed)
                window.removeEventListener('PHSurveySent', handleSurveySent)
            }
        }

        window.addEventListener('PHSurveyClosed', handleSurveyClosed)
        window.addEventListener('PHSurveySent', handleSurveySent)

        if (millisecondDelay > 0) {
            return handleShowSurveyWithDelay()
        } else {
            return handleShowSurveyImmediately()
        }
    }, [])

    return { isPopupVisible, isSurveySent, setIsPopupVisible }
}

export function SurveyPopup({
    survey,
    forceDisableHtml,
    posthog,
    style,
    previewPageIndex,
    removeSurveyFromFocus,
}: {
    survey: Survey
    forceDisableHtml?: boolean
    posthog?: PostHog
    style?: React.CSSProperties
    previewPageIndex?: number | undefined
    removeSurveyFromFocus: (id: string) => void
}) {
    const isPreviewMode = Number.isInteger(previewPageIndex)
    // NB: The client-side code passes the millisecondDelay in seconds, but setTimeout expects milliseconds, so we multiply by 1000
    const surveyPopupDelayMilliseconds = survey.appearance?.surveyPopupDelaySeconds
        ? survey.appearance.surveyPopupDelaySeconds * 1000
        : 0
    const { isPopupVisible, isSurveySent, setIsPopupVisible } = usePopupVisibility(
        survey,
        posthog,
        surveyPopupDelayMilliseconds,
        isPreviewMode,
        removeSurveyFromFocus
    )
    const shouldShowConfirmation = isSurveySent || previewPageIndex === survey.questions.length
    const confirmationBoxLeftStyle = style?.left && isNumber(style?.left) ? { left: style.left - 40 } : {}

    if (isPreviewMode) {
        style = style || {}
        style.left = 'unset'
        style.right = 'unset'
        style.transform = 'unset'
    }

    return isPopupVisible ? (
        <SurveyContext.Provider
            value={{
                isPreviewMode,
                previewPageIndex: previewPageIndex,
                handleCloseSurveyPopup: () => dismissedSurveyEvent(survey, posthog, isPreviewMode),
            }}
        >
            {!shouldShowConfirmation ? (
                <Questions
                    survey={survey}
                    forceDisableHtml={!!forceDisableHtml}
                    posthog={posthog}
                    styleOverrides={style}
                />
            ) : (
                <ConfirmationMessage
                    header={survey.appearance?.thankYouMessageHeader || 'Thank you!'}
                    description={survey.appearance?.thankYouMessageDescription || ''}
                    forceDisableHtml={!!forceDisableHtml}
                    contentType={survey.appearance?.thankYouMessageDescriptionContentType}
                    appearance={survey.appearance || defaultSurveyAppearance}
                    styleOverrides={{ ...style, ...confirmationBoxLeftStyle }}
                    onClose={() => setIsPopupVisible(false)}
                />
            )}
        </SurveyContext.Provider>
    ) : (
        <></>
    )
}

export function Questions({
    survey,
    forceDisableHtml,
    posthog,
    styleOverrides,
}: {
    survey: Survey
    forceDisableHtml: boolean
    posthog?: PostHog
    styleOverrides?: React.CSSProperties
}) {
    const textColor = getContrastingTextColor(
        survey.appearance?.backgroundColor || defaultSurveyAppearance.backgroundColor
    )
    const [questionsResponses, setQuestionsResponses] = useState({})
    const { isPreviewMode, previewPageIndex } = useContext(SurveyContext)
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(previewPageIndex || 0)
    const surveyQuestions = useMemo(() => getDisplayOrderQuestions(survey), [survey])

    // Sync preview state
    useEffect(() => {
        setCurrentQuestionIndex(previewPageIndex ?? 0)
    }, [previewPageIndex])

    const onNextButtonClick = ({
        res,
        originalQuestionIndex,
        displayQuestionIndex,
    }: {
        res: string | string[] | number | null
        originalQuestionIndex: number
        displayQuestionIndex: number
    }) => {
        if (!posthog) {
            return
        }

        const responseKey =
            originalQuestionIndex === 0 ? `$survey_response` : `$survey_response_${originalQuestionIndex}`

        setQuestionsResponses({ ...questionsResponses, [responseKey]: res })

        // Old SDK, no branching
        if (!posthog.getNextSurveyStep) {
            const isLastDisplayedQuestion = displayQuestionIndex === survey.questions.length - 1
            if (isLastDisplayedQuestion) {
                sendSurveyEvent({ ...questionsResponses, [responseKey]: res }, survey, posthog)
            } else {
                setCurrentQuestionIndex(displayQuestionIndex + 1)
            }
            return
        }

        const nextStep = posthog.getNextSurveyStep(survey, displayQuestionIndex, res)
        if (nextStep === SurveyQuestionBranchingType.End) {
            sendSurveyEvent({ ...questionsResponses, [responseKey]: res }, survey, posthog)
        } else {
            setCurrentQuestionIndex(nextStep)
        }
    }

    return (
        <form
            className="survey-form"
            style={{
                color: textColor,
                borderColor: survey.appearance?.borderColor,
                ...styleOverrides,
            }}
        >
            {surveyQuestions.map((question, displayQuestionIndex) => {
                const { originalQuestionIndex } = question

                const isVisible = isPreviewMode
                    ? currentQuestionIndex === originalQuestionIndex
                    : currentQuestionIndex === displayQuestionIndex
                return (
                    isVisible && (
                        <div>
                            {getQuestionComponent({
                                question,
                                forceDisableHtml,
                                displayQuestionIndex,
                                appearance: survey.appearance || defaultSurveyAppearance,
                                onSubmit: (res) =>
                                    onNextButtonClick({
                                        res,
                                        originalQuestionIndex,
                                        displayQuestionIndex,
                                    }),
                            })}
                        </div>
                    )
                )
            })}
        </form>
    )
}

export function FeedbackWidget({
    survey,
    forceDisableHtml,
    posthog,
    readOnly,
    removeSurveyFromFocus,
}: {
    survey: Survey
    forceDisableHtml?: boolean
    posthog?: PostHog
    readOnly?: boolean
    removeSurveyFromFocus: (id: string) => void
}): JSX.Element {
    const [showSurvey, setShowSurvey] = useState(false)
    const [styleOverrides, setStyle] = useState({})
    const widgetRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (readOnly || !posthog) {
            return
        }

        if (survey.appearance?.widgetType === 'tab') {
            if (widgetRef.current) {
                const widgetPos = widgetRef.current.getBoundingClientRect()
                const style = {
                    top: '50%',
                    left: parseInt(`${widgetPos.right - 360}`),
                    bottom: 'auto',
                    borderRadius: 10,
                    borderBottom: `1.5px solid ${survey.appearance?.borderColor || '#c9c6c6'}`,
                }
                setStyle(style)
            }
        }
        if (survey.appearance?.widgetType === 'selector') {
            const widget = document.querySelector(survey.appearance.widgetSelector || '')
            widget?.addEventListener('click', () => {
                setShowSurvey(!showSurvey)
            })
            widget?.setAttribute('PHWidgetSurveyClickListener', 'true')
        }
    }, [])

    return (
        <>
            {survey.appearance?.widgetType === 'tab' && (
                <div
                    className="ph-survey-widget-tab"
                    ref={widgetRef}
                    onClick={() => !readOnly && setShowSurvey(!showSurvey)}
                    style={{ color: getContrastingTextColor(survey.appearance.widgetColor) }}
                >
                    <div className="ph-survey-widget-tab-icon"></div>
                    {survey.appearance?.widgetLabel || ''}
                </div>
            )}
            {showSurvey && (
                <SurveyPopup
                    key={'feedback-widget-survey'}
                    posthog={posthog}
                    survey={survey}
                    forceDisableHtml={forceDisableHtml}
                    style={styleOverrides}
                    removeSurveyFromFocus={removeSurveyFromFocus}
                />
            )}
        </>
    )
}

interface GetQuestionComponentProps {
    question: SurveyQuestion
    forceDisableHtml: boolean
    displayQuestionIndex: number
    appearance: SurveyAppearance
    onSubmit: (res: string | string[] | number | null) => void
}

const getQuestionComponent = ({
    question,
    forceDisableHtml,
    displayQuestionIndex,
    appearance,
    onSubmit,
}: GetQuestionComponentProps): JSX.Element => {
    const questionComponents = {
        [SurveyQuestionType.Open]: OpenTextQuestion,
        [SurveyQuestionType.Link]: LinkQuestion,
        [SurveyQuestionType.Rating]: RatingQuestion,
        [SurveyQuestionType.SingleChoice]: MultipleChoiceQuestion,
        [SurveyQuestionType.MultipleChoice]: MultipleChoiceQuestion,
    }

    const commonProps = {
        question,
        forceDisableHtml,
        appearance,
        onSubmit,
    }

    const additionalProps: Record<SurveyQuestionType, any> = {
        [SurveyQuestionType.Open]: {},
        [SurveyQuestionType.Link]: {},
        [SurveyQuestionType.Rating]: { displayQuestionIndex },
        [SurveyQuestionType.SingleChoice]: { displayQuestionIndex },
        [SurveyQuestionType.MultipleChoice]: { displayQuestionIndex },
    }

    const Component = questionComponents[question.type]
    const componentProps = { ...commonProps, ...additionalProps[question.type] }

    return <Component {...componentProps} />
}
