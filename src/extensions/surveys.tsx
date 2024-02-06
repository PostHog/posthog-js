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
import { style, defaultSurveyAppearance, sendSurveyEvent } from './surveys/surveys-utils'
import { useContrastingTextColor } from './surveys/hooks/useContrastingTextColor'
import * as Preact from 'preact'
import { createWidgetShadow } from './surveys-widget'
import { useState, useEffect, useRef } from 'preact/hooks'
import { _isArray, _isNull, _isNumber } from '../utils/type-utils'
import { BottomSection } from './surveys/components/BottomSection'
import {
    cancelSVG,
    checkSVG,
    dissatisfiedEmoji,
    neutralEmoji,
    satisfiedEmoji,
    veryDissatisfiedEmoji,
    verySatisfiedEmoji,
} from './surveys/icons'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const window = _window as Window & typeof globalThis
const document = _document as Document

export const createShadow = (styleSheet: string, surveyId: string) => {
    const div = document.createElement('div')
    div.className = `PostHogSurvey${surveyId}`
    const shadow = div.attachShadow({ mode: 'open' })
    if (styleSheet) {
        const styleElement = Object.assign(document.createElement('style'), {
            innerText: styleSheet,
        })
        shadow.appendChild(styleElement)
    }
    document.body.appendChild(div)
    return shadow
}

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

const defaultBackgroundColor = '#eeeded'

export function QuestionHeader({
    question,
    description,
    backgroundColor,
}: {
    question: string
    description?: string | null
    backgroundColor?: string
}) {
    return (
        <div style={{ backgroundColor: backgroundColor || defaultBackgroundColor }}>
            <div className="survey-question">{question}</div>
            {description && <div className="description" dangerouslySetInnerHTML={{ __html: description }} />}
        </div>
    )
}

export function Cancel({ onClick }: { onClick: () => void }) {
    return (
        <div className="cancel-btn-wrapper">
            <button className="form-cancel" onClick={onClick}>
                {cancelSVG}
            </button>
        </div>
    )
}

export function PostHogLogo({ backgroundColor }: { backgroundColor?: string }) {
    const { textColor, ref } = useContrastingTextColor({ appearance: { backgroundColor } })

    return (
        <a
            href="https://posthog.com"
            target="_blank"
            rel="noopener"
            ref={ref as Preact.RefObject<HTMLAnchorElement>}
            style={{ backgroundColor: backgroundColor, color: textColor }}
            className="footer-branding"
        >
            Survey by {posthogLogo}
        </a>
    )
}

export function Surveys({ posthog, survey, style }: { posthog: PostHog; survey: Survey; style?: React.CSSProperties }) {
    const [displayState, setDisplayState] = useState<'survey' | 'confirmation' | 'closed'>('survey')

    useEffect(() => {
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
        </>
    )
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

    const onNextClick = (res: string | string[] | number | null, idx: number) => {
        const responseKey = idx === 0 ? `$survey_response` : `$survey_response_${idx}`
        if (idx === survey.questions.length - 1) {
            sendSurveyEvent({ ...questionsResponses, [responseKey]: res }, survey, posthog)
            return
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
                                        () => closeSurveyPopup(posthog, survey)
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
                    () => closeSurveyPopup(posthog, survey)
                )
            })}
        </form>
    )
}

const closeSurveyPopup = (posthog: PostHog, survey: Survey) => {
    // TODO: state management and unit tests for this would be nice
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

export function OpenTextQuestion({
    question,
    appearance,
    onSubmit,
    closeSurveyPopup,
}: {
    question: BasicSurveyQuestion
    appearance: SurveyAppearance
    onSubmit: (text: string) => void
    closeSurveyPopup: () => void
}) {
    const textRef = useRef(null)
    const [text, setText] = useState('')

    return (
        <div
            className="survey-box"
            style={{ backgroundColor: appearance.backgroundColor || defaultBackgroundColor }}
            ref={textRef}
        >
            <Cancel onClick={() => closeSurveyPopup()} />
            <QuestionHeader
                question={question.question}
                description={question.description}
                backgroundColor={appearance.backgroundColor}
            />
            <textarea rows={4} placeholder={appearance?.placeholder} onInput={(e) => setText(e.currentTarget.value)} />
            <BottomSection
                text={question.buttonText || 'Submit'}
                submitDisabled={!text && !question.optional}
                appearance={appearance}
                onSubmit={() => onSubmit(text)}
            />
        </div>
    )
}

export function LinkQuestion({
    question,
    appearance,
    onSubmit,
    closeSurveyPopup,
}: {
    question: LinkSurveyQuestion
    appearance: SurveyAppearance
    onSubmit: (clicked: string) => void
    closeSurveyPopup: () => void
}) {
    return (
        <div className="survey-box">
            <Cancel onClick={() => closeSurveyPopup()} />
            <QuestionHeader question={question.question} description={question.description} />
            <BottomSection
                text={question.buttonText || 'Submit'}
                submitDisabled={false}
                link={question.link}
                appearance={appearance}
                onSubmit={() => onSubmit('link clicked')}
            />
        </div>
    )
}

export function RatingQuestion({
    question,
    questionIndex,
    appearance,
    onSubmit,
    closeSurveyPopup,
}: {
    question: RatingSurveyQuestion
    questionIndex: number
    appearance: SurveyAppearance
    onSubmit: (rating: number | null) => void
    closeSurveyPopup: () => void
}) {
    const scale = question.scale
    const starting = question.scale === 10 ? 0 : 1
    const [rating, setRating] = useState<number | null>(null)

    return (
        <div className="survey-box">
            <Cancel onClick={() => closeSurveyPopup()} />
            <QuestionHeader
                question={question.question}
                description={question.description}
                backgroundColor={appearance.backgroundColor}
            />
            <div className="rating-section">
                <div className="rating-options">
                    {question.display === 'emoji' && (
                        <div className="rating-options-emoji">
                            {(question.scale === 3 ? threeScaleEmojis : fiveScaleEmojis).map((emoji, idx) => {
                                const active = idx + 1 === rating
                                return (
                                    <button
                                        className={`ratings-emoji question-${questionIndex}-rating-${idx} ${
                                            active ? 'rating-active' : null
                                        }`}
                                        value={idx + 1}
                                        key={idx}
                                        type="button"
                                        onClick={() => {
                                            setRating(idx + 1)
                                        }}
                                    >
                                        {emoji}
                                    </button>
                                )
                            })}
                        </div>
                    )}
                    {question.display === 'number' && (
                        <div
                            className="rating-options-number"
                            style={{ gridTemplateColumns: `repeat(${scale - starting + 1}, minmax(0, 1fr))` }}
                        >
                            {(question.scale === 5 ? fiveScaleNumbers : tenScaleNumbers).map((number, idx) => {
                                const active = rating === number
                                return (
                                    <RatingButton
                                        key={idx}
                                        questionIndex={questionIndex}
                                        active={active}
                                        appearance={appearance}
                                        num={number}
                                        setActiveNumber={(num) => {
                                            setRating(num)
                                        }}
                                    />
                                )
                            })}
                        </div>
                    )}
                </div>
                <div className="rating-text">
                    <div>{question.lowerBoundLabel}</div>
                    <div>{question.upperBoundLabel}</div>
                </div>
            </div>
            <BottomSection
                text={question.buttonText || appearance?.submitButtonText || 'Submit'}
                submitDisabled={_isNull(rating) && !question.optional}
                appearance={appearance}
                onSubmit={() => onSubmit(rating)}
            />
        </div>
    )
}

export function RatingButton({
    num,
    active,
    questionIndex,
    appearance,
    setActiveNumber,
}: {
    num: number
    active: boolean
    questionIndex: number
    appearance: any
    setActiveNumber: (num: number) => void
}) {
    const { textColor, ref } = useContrastingTextColor({ appearance, defaultTextColor: 'black' })

    return (
        <button
            ref={ref as Preact.RefObject<HTMLButtonElement>}
            className={`ratings-number question-${questionIndex}-rating-${num} ${active ? 'rating-active' : null}`}
            type="button"
            onClick={() => setActiveNumber(num)}
            style={{
                color: textColor,
                backgroundColor: active ? appearance.ratingButtonActiveColor : appearance.ratingButtonColor,
                borderColor: appearance.borderColor,
            }}
        >
            {num}
        </button>
    )
}

export function ConfirmationMessage({
    confirmationHeader,
    confirmationDescription,
    appearance,
    onClose,
    styleOverrides,
}: {
    confirmationHeader: string
    confirmationDescription: string
    appearance: SurveyAppearance
    onClose: () => void
    styleOverrides?: React.CSSProperties
}) {
    return (
        <>
            <div className="thank-you-message" style={{ ...styleOverrides }}>
                <div className="thank-you-message-container">
                    <Cancel onClick={() => onClose()} />
                    <h3 className="thank-you-message-header">{confirmationHeader}</h3>
                    {confirmationDescription && (
                        <div
                            className="thank-you-message-body"
                            dangerouslySetInnerHTML={{ __html: confirmationDescription }}
                        />
                    )}
                    <BottomSection
                        text={'Close'}
                        submitDisabled={false}
                        appearance={appearance}
                        onSubmit={() => onClose()}
                    />
                </div>
            </div>
        </>
    )
}

export function MultipleChoiceQuestion({
    question,
    questionIndex,
    appearance,
    onSubmit,
    closeSurveyPopup,
}: {
    question: MultipleSurveyQuestion
    questionIndex: number
    appearance: SurveyAppearance
    onSubmit: (choices: string | string[] | null) => void
    closeSurveyPopup: () => void
}) {
    const textRef = useRef(null)
    const [selectedChoices, setSelectedChoices] = useState<string | string[] | null>(
        question.type === SurveyQuestionType.MultipleChoice ? [] : null
    )
    const [openChoiceSelected, setOpenChoiceSelected] = useState(false)
    const [openEndedInput, setOpenEndedInput] = useState('')

    const inputType = question.type === SurveyQuestionType.SingleChoice ? 'radio' : 'checkbox'
    return (
        <div
            className="survey-box"
            style={{ backgroundColor: appearance.backgroundColor || defaultBackgroundColor }}
            ref={textRef}
        >
            <Cancel onClick={() => closeSurveyPopup()} />
            <QuestionHeader
                question={question.question}
                description={question.description}
                backgroundColor={appearance.backgroundColor}
            />
            <div className="multiple-choice-options">
                {question.choices.map((choice: string, idx: number) => {
                    let choiceClass = 'choice-option'
                    const val = choice
                    const option = choice
                    if (!!question.hasOpenChoice && idx === question.choices.length - 1) {
                        choiceClass += ' choice-option-open'
                    }
                    return (
                        <div className={choiceClass}>
                            <input
                                type={inputType}
                                id={`surveyQuestion${questionIndex}Choice${idx}`}
                                name={`question${questionIndex}`}
                                value={val}
                                disabled={!val}
                                onInput={() => {
                                    if (question.hasOpenChoice && idx === question.choices.length - 1) {
                                        return setOpenChoiceSelected(!openChoiceSelected)
                                    }
                                    if (question.type === SurveyQuestionType.SingleChoice) {
                                        return setSelectedChoices(val)
                                    }
                                    if (
                                        question.type === SurveyQuestionType.MultipleChoice &&
                                        _isArray(selectedChoices)
                                    ) {
                                        if (selectedChoices.includes(val)) {
                                            // filter out values because clicking on a selected choice should deselect it
                                            return setSelectedChoices(
                                                selectedChoices.filter((choice) => choice !== val)
                                            )
                                        }
                                        return setSelectedChoices([...selectedChoices, val])
                                    }
                                }}
                            />
                            <label htmlFor={`surveyQuestion${questionIndex}Choice${idx}`}>
                                {question.hasOpenChoice && idx === question.choices.length - 1 ? (
                                    <>
                                        <span>{option}:</span>
                                        <input
                                            type="text"
                                            id={`surveyQuestion${questionIndex}Choice${idx}Open`}
                                            name={`question${questionIndex}`}
                                            onInput={(e) => {
                                                const userValue = e.currentTarget.value
                                                if (question.type === SurveyQuestionType.SingleChoice) {
                                                    return setSelectedChoices(userValue)
                                                }
                                                if (
                                                    question.type === SurveyQuestionType.MultipleChoice &&
                                                    _isArray(selectedChoices)
                                                ) {
                                                    return setOpenEndedInput(userValue)
                                                }
                                            }}
                                        />
                                    </>
                                ) : (
                                    option
                                )}
                            </label>
                            <span className="choice-check">{checkSVG}</span>
                        </div>
                    )
                })}
            </div>
            <BottomSection
                text={question.buttonText || 'Submit'}
                submitDisabled={
                    (_isNull(selectedChoices) || (_isArray(selectedChoices) && selectedChoices.length === 0)) &&
                    !question.optional
                }
                appearance={appearance}
                onSubmit={() => {
                    if (openChoiceSelected && question.type === SurveyQuestionType.MultipleChoice) {
                        if (_isArray(selectedChoices)) {
                            onSubmit([...selectedChoices, openEndedInput])
                        }
                    } else {
                        onSubmit(selectedChoices)
                    }
                }}
            />
        </div>
    )
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

const threeScaleEmojis = [dissatisfiedEmoji, neutralEmoji, dissatisfiedEmoji]
const fiveScaleEmojis = [veryDissatisfiedEmoji, dissatisfiedEmoji, neutralEmoji, satisfiedEmoji, verySatisfiedEmoji]
const fiveScaleNumbers = [1, 2, 3, 4, 5]
const tenScaleNumbers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
