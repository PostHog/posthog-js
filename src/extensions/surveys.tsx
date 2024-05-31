import { PostHog } from '../posthog-core'
import { Survey, SurveyAppearance, SurveyQuestion, SurveyQuestionType, SurveyType } from '../posthog-surveys-types'

import { window as _window, document as _document } from '../utils/globals'
import {
    style,
    defaultSurveyAppearance,
    sendSurveyEvent,
    createShadow,
    getContrastingTextColor,
    SurveyContext,
    getDisplayOrderQuestions,
} from './surveys/surveys-utils'
import * as Preact from 'preact'
import { createWidgetShadow, createWidgetStyle } from './surveys-widget'
import { useState, useEffect, useRef, useContext, useMemo } from 'preact/hooks'
import { isNumber } from '../utils/type-utils'
import { ConfirmationMessage } from './surveys/components/ConfirmationMessage'
import {
    OpenTextQuestion,
    LinkQuestion,
    RatingQuestion,
    MultipleChoiceQuestion,
} from './surveys/components/QuestionTypes'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const window = _window as Window & typeof globalThis
const document = _document as Document

const handleWidget = (posthog: PostHog, survey: Survey) => {
    const shadow = createWidgetShadow(survey)
    const surveyStyleSheet = style(survey.appearance)
    shadow.appendChild(Object.assign(document.createElement('style'), { innerText: surveyStyleSheet }))
    Preact.render(<FeedbackWidget key={'feedback-survey'} posthog={posthog} survey={survey} />, shadow)
}

export const callSurveys = (posthog: PostHog, forceReload: boolean = false) => {
    posthog?.getActiveMatchingSurveys((surveys) => {
        const nonAPISurveys = surveys.filter((survey) => survey.type !== 'api')
        nonAPISurveys.forEach((survey) => {
            if (survey.type === SurveyType.Widget) {
                if (
                    survey.appearance?.widgetType === 'tab' &&
                    document.querySelectorAll(`.PostHogWidget${survey.id}`).length === 0
                ) {
                    handleWidget(posthog, survey)
                }
                if (survey.appearance?.widgetType === 'selector' && survey.appearance?.widgetSelector) {
                    const selectorOnPage = document.querySelector(survey.appearance.widgetSelector)
                    if (selectorOnPage) {
                        if (document.querySelectorAll(`.PostHogWidget${survey.id}`).length === 0) {
                            handleWidget(posthog, survey)
                        } else if (document.querySelectorAll(`.PostHogWidget${survey.id}`).length === 1) {
                            // we have to check if user selector already has a survey listener attached to it because we always have to check if it's on the page or not
                            if (!selectorOnPage.getAttribute('PHWidgetSurveyClickListener')) {
                                const surveyPopup = document
                                    .querySelector(`.PostHogWidget${survey.id}`)
                                    ?.shadowRoot?.querySelector(`.survey-form`) as HTMLFormElement
                                selectorOnPage.addEventListener('click', () => {
                                    if (surveyPopup) {
                                        surveyPopup.style.display =
                                            surveyPopup.style.display === 'none' ? 'block' : 'none'
                                        surveyPopup.addEventListener(
                                            'PHSurveyClosed',
                                            () => (surveyPopup.style.display = 'none')
                                        )
                                    }
                                })
                                selectorOnPage.setAttribute('PHWidgetSurveyClickListener', 'true')
                            }
                        }
                    }
                }
            }
            if (
                survey.type === SurveyType.Popover &&
                document.querySelectorAll("div[class^='PostHogSurvey']").length === 0
            ) {
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

                if (!localStorage.getItem(`seenSurvey_${survey.id}`)) {
                    const shadow = createShadow(style(survey?.appearance), survey.id)
                    Preact.render(<SurveyPopup key={'popover-survey'} posthog={posthog} survey={survey} />, shadow)
                }
            }
        })
    }, forceReload)
}

export const renderSurveysPreview = (survey: Survey, root: HTMLElement, previewQuestionIndex: number) => {
    const surveyStyleSheet = style(survey.appearance)
    const styleElement = Object.assign(document.createElement('style'), { innerText: surveyStyleSheet })

    // Remove previously attached <style>
    Array.from(root.children).forEach((child) => {
        if (child instanceof HTMLStyleElement) {
            root.removeChild(child)
        }
    })

    root.appendChild(styleElement)
    const textColor = getContrastingTextColor(
        survey.appearance?.backgroundColor || defaultSurveyAppearance.backgroundColor || 'white'
    )

    Preact.render(
        <SurveyPopup
            key="surveys-render-preview"
            survey={survey}
            readOnly={true}
            previewQuestionIndex={previewQuestionIndex}
            style={{
                position: 'relative',
                right: 0,
                borderBottom: `1px solid ${survey.appearance?.borderColor}`,
                borderRadius: 10,
                color: textColor,
            }}
        />,
        root
    )
}

export const renderFeedbackWidgetPreview = (survey: Survey, root: HTMLElement) => {
    const widgetStyleSheet = createWidgetStyle(survey.appearance?.widgetColor)
    const styleElement = Object.assign(document.createElement('style'), { innerText: widgetStyleSheet })
    root.appendChild(styleElement)
    Preact.render(<FeedbackWidget key={'feedback-render-preview'} survey={survey} readOnly={true} />, root)
}

// This is the main exported function
export function generateSurveys(posthog: PostHog) {
    // NOTE: Important to ensure we never try and run surveys without a window environment
    if (!document || !window) {
        return
    }
    callSurveys(posthog, true)

    // recalculate surveys every 3 seconds to check if URL or selectors have changed
    setInterval(() => {
        callSurveys(posthog, false)
    }, 3000)
}

export function SurveyPopup({
    survey,
    posthog,
    readOnly,
    style,
    previewQuestionIndex,
}: {
    survey: Survey
    posthog?: PostHog
    readOnly?: boolean
    style?: React.CSSProperties
    previewQuestionIndex?: number | undefined
}) {
    const [isPopupVisible, setIsPopupVisible] = useState(true)
    const [isSurveySent, setIsSurveySent] = useState(false)
    const shouldShowConfirmation = isSurveySent || previewQuestionIndex === survey.questions.length
    const confirmationBoxLeftStyle = style?.left && isNumber(style?.left) ? { left: style.left - 40 } : {}

    // Ensure the popup stays in the same position for the preview
    if (readOnly) {
        style = style || {}
        style.left = 'initial'
        style.right = 'initial'
        style.transform = 'initial'
    }

    useEffect(() => {
        if (readOnly || !posthog) {
            return
        }

        window.dispatchEvent(new Event('PHSurveyShown'))
        posthog.capture('survey shown', {
            $survey_name: survey.name,
            $survey_id: survey.id,
            sessionRecordingUrl: posthog.get_session_replay_url?.(),
        })
        localStorage.setItem(`lastSeenSurveyDate`, new Date().toISOString())

        window.addEventListener('PHSurveyClosed', () => {
            setIsPopupVisible(false)
        })
        window.addEventListener('PHSurveySent', () => {
            if (!survey.appearance?.displayThankYouMessage) {
                return setIsPopupVisible(false)
            }

            setIsSurveySent(true)

            if (survey.appearance?.autoDisappear) {
                setTimeout(() => {
                    setIsPopupVisible(false)
                }, 5000)
            }
        })
    }, [])

    return isPopupVisible ? (
        <SurveyContext.Provider
            value={{
                readOnly: !!readOnly,
                previewQuestionIndex: previewQuestionIndex,
                handleCloseSurveyPopup: () => closeSurveyPopup(survey, posthog, readOnly),
            }}
        >
            {!shouldShowConfirmation ? (
                <Questions survey={survey} posthog={posthog} styleOverrides={style} />
            ) : (
                <ConfirmationMessage
                    header={survey.appearance?.thankYouMessageHeader || 'Thank you!'}
                    description={survey.appearance?.thankYouMessageDescription || ''}
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

interface GetQuestionComponentProps {
    question: SurveyQuestion
    questionIndex: number
    appearance: SurveyAppearance
    onSubmit: (res: string | string[] | number | null) => void
}

const getQuestionComponent = ({
    question,
    questionIndex,
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
        appearance,
        onSubmit,
    }

    const additionalProps: Record<SurveyQuestionType, any> = {
        [SurveyQuestionType.Open]: {},
        [SurveyQuestionType.Link]: {},
        [SurveyQuestionType.Rating]: { questionIndex },
        [SurveyQuestionType.SingleChoice]: { questionIndex },
        [SurveyQuestionType.MultipleChoice]: { questionIndex },
    }

    const Component = questionComponents[question.type]
    const componentProps = { ...commonProps, ...additionalProps[question.type] }

    return <Component {...componentProps} />
}

export function Questions({
    survey,
    posthog,
    styleOverrides,
}: {
    survey: Survey
    posthog?: PostHog
    styleOverrides?: React.CSSProperties
}) {
    const textColor = getContrastingTextColor(
        survey.appearance?.backgroundColor || defaultSurveyAppearance.backgroundColor
    )
    const [questionsResponses, setQuestionsResponses] = useState({})
    const { previewQuestionIndex } = useContext(SurveyContext)
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(previewQuestionIndex || 0)
    const surveyQuestions = useMemo(() => getDisplayOrderQuestions(survey), [survey])

    // Sync preview state
    useEffect(() => {
        setCurrentQuestionIndex(previewQuestionIndex ?? 0)
    }, [previewQuestionIndex])

    const onNextButtonClick = (res: string | string[] | number | null, questionIndex: number) => {
        const isFirstQuestion = questionIndex === 0
        const isLastQuestion = questionIndex === survey.questions.length - 1

        const responseKey = isFirstQuestion ? `$survey_response` : `$survey_response_${questionIndex}`
        if (isLastQuestion) {
            return sendSurveyEvent({ ...questionsResponses, [responseKey]: res }, survey, posthog)
        } else {
            setQuestionsResponses({ ...questionsResponses, [responseKey]: res })
            setCurrentQuestionIndex(questionIndex + 1)
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
            {surveyQuestions.map((question, questionIndex) => {
                const isVisible = currentQuestionIndex === questionIndex
                return (
                    isVisible && (
                        <div>
                            {getQuestionComponent({
                                question,
                                questionIndex,
                                appearance: survey.appearance || defaultSurveyAppearance,
                                onSubmit: (res) => onNextButtonClick(res, questionIndex),
                            })}
                        </div>
                    )
                )
            })}
        </form>
    )
}

const closeSurveyPopup = (survey: Survey, posthog?: PostHog, readOnly?: boolean) => {
    if (readOnly || !posthog) {
        return
    }
    posthog.capture('survey dismissed', {
        $survey_name: survey.name,
        $survey_id: survey.id,
        sessionRecordingUrl: posthog.get_session_replay_url?.(),
        $set: {
            [`$survey_dismissed/${survey.id}`]: true,
        },
    })
    localStorage.setItem(`seenSurvey_${survey.id}`, 'true')
    window.dispatchEvent(new Event('PHSurveyClosed'))
}

export function FeedbackWidget({
    survey,
    posthog,
    readOnly,
}: {
    survey: Survey
    posthog?: PostHog
    readOnly?: boolean
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
                <SurveyPopup key={'feedback-widget-survey'} posthog={posthog} survey={survey} style={styleOverrides} />
            )}
        </>
    )
}
