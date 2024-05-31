import { PostHog } from '../posthog-core'
import {
    BasicSurveyQuestion,
    LinkSurveyQuestion,
    MultipleSurveyQuestion,
    RatingSurveyQuestion,
    Survey,
    SurveyAppearance,
    SurveyQuestion,
    SurveyQuestionType,
    SurveyType,
} from '../posthog-surveys-types'

import { window as _window, document as _document } from '../utils/globals'
import {
    style,
    defaultSurveyAppearance,
    sendSurveyEvent,
    createShadow,
    getContrastingTextColor,
    SurveyContext,
    getDisplayOrderQuestions,
    shouldShowSurveyInWaitPeriod,
} from './surveys/surveys-utils'
import * as Preact from 'preact'
import { createWidgetShadow, createWidgetStyle } from './surveys-widget'
import { useState, useEffect, useRef, useContext, useMemo } from 'preact/hooks'
import { isNumber, isUndefined } from '../utils/type-utils'
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

            if (survey.type === SurveyType.Popover) {
                const surveyWaitPeriodInDays = survey.conditions?.seenSurveyWaitPeriodInDays
                if (surveyWaitPeriodInDays && !shouldShowSurveyInWaitPeriod(surveyWaitPeriodInDays)) {
                    return
                }

                const shadow = createShadow(style(survey?.appearance), survey.id)
                const hasEvents = survey.events && survey.events.length > 0
                if (hasEvents && !isUndefined(posthog._addCaptureHook)) {
                    const surveyEventRegisteredKey = `surveyEventRegistered_${survey.id}`
                    // we use sessionStorage here because within the context of the current window,
                    // we want to observe the events only once.
                    // sessionStorage gets reset once the document reloads.
                    if (sessionStorage.getItem(surveyEventRegisteredKey)) {
                        return
                    }

                    sessionStorage.setItem(surveyEventRegisteredKey, 'true')

                    posthog._addCaptureHook((eventName) => {
                        // since the event can fire at any time, we want to ensure that the survey show is idempotent,
                        // check that surveySeenKey hasn't been set again in local storage here.
                        if (survey.events.indexOf(eventName) >= 0) {
                            Preact.render(
                                <Surveys
                                    key={`popover-survey-${Date.now()}`}
                                    posthog={posthog}
                                    initialDisplayState="survey"
                                    survey={survey}
                                />,
                                shadow
                            )
                        }
                    })
                } else if (document.querySelectorAll("div[class^='PostHogSurvey']").length === 0) {
                    const surveySeenKey = `seenSurvey_${survey.id}`
                    if (localStorage.getItem(surveySeenKey)) {
                        return
                    }
                    Preact.render(<Surveys key={'popover-survey'} posthog={posthog} survey={survey} />, shadow)
                }
            }
        })
    }, forceReload)
}

export const renderSurveysPreview = (
    survey: Survey,
    root: HTMLElement,
    displayState: 'survey' | 'confirmation',
    previewQuestionIndex: number
) => {
    const surveyStyleSheet = style(survey.appearance)
    const styleElement = Object.assign(document.createElement('style'), { innerText: surveyStyleSheet })
    root.appendChild(styleElement)
    const textColor = getContrastingTextColor(
        survey.appearance?.backgroundColor || defaultSurveyAppearance.backgroundColor || 'white'
    )

    Preact.render(
        <Surveys
            key={'surveys-render-preview'}
            survey={survey}
            readOnly={true}
            initialDisplayState={displayState}
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

export function Surveys({
    survey,
    posthog,
    readOnly,
    style,
    initialDisplayState,
    previewQuestionIndex,
    eventName,
}: {
    survey: Survey
    posthog?: PostHog
    readOnly?: boolean
    style?: React.CSSProperties
    initialDisplayState?: 'survey' | 'confirmation' | 'closed'
    previewQuestionIndex?: number
    eventName?: string
}) {
    const [displayState, setDisplayState] = useState<'survey' | 'confirmation' | 'closed'>(
        initialDisplayState || 'survey'
    )

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
            setDisplayState('closed')
        })

        window.addEventListener('PHSurveySent', () => {
            if (!survey.appearance?.displayThankYouMessage) {
                return setDisplayState('closed')
            }
            setDisplayState('confirmation')
            if (survey.appearance?.autoDisappear) {
                setTimeout(() => {
                    setDisplayState('closed')
                }, 5000)
            }
        })
    }, [])
    const confirmationBoxLeftStyle = style?.left && isNumber(style?.left) ? { left: style.left - 40 } : {}
    return (
        <>
            <SurveyContext.Provider
                value={{
                    readOnly: !!readOnly,
                    previewQuestionIndex: previewQuestionIndex ?? 0,
                    textColor: getContrastingTextColor(
                        survey.appearance?.backgroundColor || defaultSurveyAppearance.backgroundColor
                    ),
                }}
            >
                {displayState === 'survey' && (
                    <Questions survey={survey} posthog={posthog} styleOverrides={style} eventName={eventName} />
                )}
                {displayState === 'confirmation' && (
                    <ConfirmationMessage
                        confirmationHeader={survey.appearance?.thankYouMessageHeader || 'Thank you!'}
                        confirmationDescription={survey.appearance?.thankYouMessageDescription || ''}
                        appearance={survey.appearance || defaultSurveyAppearance}
                        styleOverrides={{ ...style, ...confirmationBoxLeftStyle }}
                        onClose={() => setDisplayState('closed')}
                    />
                )}
            </SurveyContext.Provider>
        </>
    )
}

const questionTypeMap = (
    question: SurveyQuestion,
    questionIndex: number,
    appearance: SurveyAppearance,
    onSubmit: (res: string | string[] | number | null) => void,
    closeSurveyPopup: () => void
): JSX.Element => {
    const mapping = {
        [SurveyQuestionType.Open]: (
            <OpenTextQuestion
                question={question as BasicSurveyQuestion}
                appearance={appearance}
                onSubmit={onSubmit}
                closeSurveyPopup={closeSurveyPopup}
            />
        ),
        [SurveyQuestionType.Link]: (
            <LinkQuestion
                question={question as LinkSurveyQuestion}
                appearance={appearance}
                onSubmit={onSubmit}
                closeSurveyPopup={closeSurveyPopup}
            />
        ),
        [SurveyQuestionType.Rating]: (
            <RatingQuestion
                question={question as RatingSurveyQuestion}
                appearance={appearance}
                questionIndex={questionIndex}
                onSubmit={onSubmit}
                closeSurveyPopup={closeSurveyPopup}
            />
        ),
        [SurveyQuestionType.SingleChoice]: (
            <MultipleChoiceQuestion
                question={question as MultipleSurveyQuestion}
                appearance={appearance}
                questionIndex={questionIndex}
                onSubmit={onSubmit}
                closeSurveyPopup={closeSurveyPopup}
            />
        ),
        [SurveyQuestionType.MultipleChoice]: (
            <MultipleChoiceQuestion
                question={question as MultipleSurveyQuestion}
                appearance={appearance}
                questionIndex={questionIndex}
                onSubmit={onSubmit}
                closeSurveyPopup={closeSurveyPopup}
            />
        ),
    }
    return mapping[question.type]
}

export function Questions({
    survey,
    posthog,
    styleOverrides,
    eventName,
}: {
    survey: Survey
    posthog?: PostHog
    styleOverrides?: React.CSSProperties
    eventName?: string
}) {
    const textColor = getContrastingTextColor(
        survey.appearance?.backgroundColor || defaultSurveyAppearance.backgroundColor
    )
    const [questionsResponses, setQuestionsResponses] = useState({})
    const { readOnly, previewQuestionIndex } = useContext(SurveyContext)
    const [currentQuestion, setCurrentQuestion] = useState(readOnly ? previewQuestionIndex : 0)
    const surveyQuestions = useMemo(() => getDisplayOrderQuestions(survey), [survey])

    const onNextClick = (res: string | string[] | number | null, idx: number) => {
        const responseKey = idx === 0 ? `$survey_response` : `$survey_response_${idx}`
        if (idx === survey.questions.length - 1) {
            return sendSurveyEvent({ ...questionsResponses, [responseKey]: res }, survey, eventName, posthog)
        } else {
            setQuestionsResponses({ ...questionsResponses, [responseKey]: res })
            setCurrentQuestion(idx + 1)
        }
    }

    const questionToDisplay = readOnly ? previewQuestionIndex : currentQuestion
    const hasMultipleQuestions = survey.questions.length > 1
    const isPreviewThankYouMessage = readOnly && questionToDisplay === survey.questions.length

    return (
        <form
            // TODO: BEMify classes
            className="survey-form"
            style={{
                color: textColor,
                borderColor: survey.appearance?.borderColor,
                ...styleOverrides,
                ...(isPreviewThankYouMessage ? { border: 'none', borderBottom: 'solid 1px rgb(201, 198, 198)' } : {}),
            }}
        >
            {isPreviewThankYouMessage ? (
                <ConfirmationMessage
                    confirmationHeader={survey.appearance?.thankYouMessageHeader || 'Thank you!'}
                    confirmationDescription={survey.appearance?.thankYouMessageDescription || ''}
                    appearance={survey.appearance || defaultSurveyAppearance}
                    styleOverrides={{
                        ...style,
                        position: 'relative',
                        right: '0px',
                        borderRadius: '10px',
                        border: 'solid 1px rgb(201, 198, 198)',
                    }}
                    onClose={() => {}}
                />
            ) : (
                <>
                    {surveyQuestions.map((question, idx) => {
                        if (hasMultipleQuestions) {
                            return (
                                <>
                                    {questionToDisplay === idx && (
                                        <div className={`tab question-${idx} ${question.type}`}>
                                            {questionTypeMap(
                                                question,
                                                idx,
                                                survey.appearance || defaultSurveyAppearance,
                                                (res) => onNextClick(res, question.questionIndex || idx),
                                                () => closeSurveyPopup(survey, posthog, readOnly)
                                            )}
                                        </div>
                                    )}
                                </>
                            )
                        }
                        return questionTypeMap(
                            surveyQuestions[idx],
                            idx,
                            survey.appearance || defaultSurveyAppearance,
                            (res) => onNextClick(res, idx),
                            () => closeSurveyPopup(survey, posthog, readOnly)
                        )
                    })}
                </>
            )}
        </form>
    )
}

const closeSurveyPopup = (survey: Survey, posthog?: PostHog, readOnly?: boolean) => {
    // TODO: state management and unit tests for this would be nice
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
                <Surveys key={'feedback-widget-survey'} posthog={posthog} survey={survey} style={styleOverrides} />
            )}
        </>
    )
}
