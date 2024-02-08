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
import { style, defaultSurveyAppearance, sendSurveyEvent, createShadow } from './surveys/surveys-utils'
import { useContrastingTextColor } from './surveys/hooks/useContrastingTextColor'
import * as Preact from 'preact'
import { render } from 'preact-render-to-string'
import { createWidgetShadow } from './surveys-widget'
import { useState, useEffect, useRef, useContext } from 'preact/hooks'
import { _isNumber } from '../utils/type-utils'
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
    Preact.render(<FeedbackWidget posthog={posthog} survey={survey} />, shadow)
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
                    Preact.render(<Surveys posthog={posthog} survey={survey} />, shadow)
                }
            }
        })
    }, forceReload)
}

export const renderSurveysPreview = (
    posthog: PostHog,
    survey: Survey,
    root: HTMLElement,
    displayState: 'survey' | 'confirmation'
) => {
    const surveyStyleSheet = style(survey.appearance)
    // remove fixed position from the style and bottom 0
    const styleElement = Object.assign(document.createElement('style'), { innerText: surveyStyleSheet })
    // remove fixed position from the style and bottom 0
    // styleElement.innerText = styleElement.innerText.replace(/position: fixed;/g, '')
    // styleElement.innerText = styleElement.innerText.replace(/bottom: 0;/g, '')
    root.appendChild(styleElement)
    const surveyHtml = render(
        <Surveys
            posthog={posthog}
            survey={survey}
            readOnly={true}
            initialDisplayState={displayState}
            style={{ position: 'relative', borderBottom: `1px solid ${survey.appearance?.borderColor}` }}
        />
    )
    const surveyDiv = document.createElement('div')
    surveyDiv.innerHTML = surveyHtml
    root.appendChild(surveyDiv)
}

export const SurveyContext = Preact.createContext(null)

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
    posthog,
    survey,
    readOnly,
    style,
    initialDisplayState,
}: {
    posthog: PostHog
    survey: Survey
    readOnly?: boolean
    style?: React.CSSProperties
    initialDisplayState?: 'survey' | 'confirmation' | 'closed'
}) {
    const [displayState, setDisplayState] = useState<'survey' | 'confirmation' | 'closed'>(
        initialDisplayState || 'survey'
    )

    useEffect(() => {
        if (readOnly) {
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
    const confirmationBoxLeftStyle = style?.left && _isNumber(style?.left) ? { left: style.left - 40 } : {}

    return (
        <>
            <SurveyContext.Provider value={{ readOnly }}>
                {displayState === 'survey' && <Questions survey={survey} posthog={posthog} styleOverrides={style} />}
                {displayState === 'confirmation' && (
                    <ConfirmationMessage
                        confirmationHeader={survey.appearance?.thankYouMessageHeader || 'Thank you!'}
                        confirmationDescription={survey.appearance?.thankYouMessageDescription || ''}
                        appearance={survey.appearance || {}}
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
}: {
    survey: Survey
    posthog: PostHog
    styleOverrides?: React.CSSProperties
}) {
    const { textColor, ref } = useContrastingTextColor({ appearance: survey.appearance || defaultSurveyAppearance })
    const [questionsResponses, setQuestionsResponses] = useState({})
    const [currentQuestion, setCurrentQuestion] = useState(0)
    const { readOnly } = useContext(SurveyContext)

    const onNextClick = (res: string | string[] | number | null, idx: number) => {
        const responseKey = idx === 0 ? `$survey_response` : `$survey_response_${idx}`
        if (idx === survey.questions.length - 1) {
            return sendSurveyEvent({ ...questionsResponses, [responseKey]: res }, survey, posthog)
        } else {
            setQuestionsResponses({ ...questionsResponses, [responseKey]: res })
            setCurrentQuestion(idx + 1)
        }
    }
    const isMultipleQuestion = survey.questions.length > 1

    return (
        <form
            // TODO: BEMify classes
            className="survey-form"
            style={{ color: textColor, borderColor: survey.appearance?.borderColor, ...styleOverrides }}
            ref={ref as Preact.RefObject<HTMLFormElement>}
        >
            {survey.questions.map((question, idx) => {
                if (isMultipleQuestion) {
                    return (
                        <>
                            {currentQuestion === idx && (
                                <div className={`tab question-${idx} ${question.type}`}>
                                    {questionTypeMap(
                                        question,
                                        idx,
                                        survey.appearance || defaultSurveyAppearance,
                                        (res) => onNextClick(res, idx),
                                        () => closeSurveyPopup(posthog, survey, readOnly)
                                    )}
                                </div>
                            )}
                        </>
                    )
                }
                return questionTypeMap(
                    survey.questions[idx],
                    idx,
                    survey.appearance || defaultSurveyAppearance,
                    (res) => onNextClick(res, idx),
                    () => closeSurveyPopup(posthog, survey, readOnly)
                )
            })}
        </form>
    )
}

const closeSurveyPopup = (posthog: PostHog, survey: Survey, readOnly?: boolean) => {
    // TODO: state management and unit tests for this would be nice
    if (readOnly) {
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

export function FeedbackWidget({ posthog, survey }: { posthog: PostHog; survey: Survey }): JSX.Element {
    const [showSurvey, setShowSurvey] = useState(false)
    const [styleOverrides, setStyle] = useState({})
    const widgetRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
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
                <div className="ph-survey-widget-tab" ref={widgetRef} onClick={() => setShowSurvey(!showSurvey)}>
                    <div className="ph-survey-widget-tab-icon"></div>
                    {survey.appearance?.widgetLabel || ''}
                </div>
            )}
            {showSurvey && <Surveys posthog={posthog} survey={survey} style={styleOverrides} />}
        </>
    )
}
