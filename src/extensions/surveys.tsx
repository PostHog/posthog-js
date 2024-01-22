import { PostHog } from 'posthog-core'
import { BasicSurveyQuestion, LinkSurveyQuestion, Survey, SurveyAppearance, SurveyQuestion, SurveyQuestionType, SurveyType } from '../posthog-surveys-types'
import { SurveysWidget } from './surveys-widget'

import { window as _window, document as _document } from '../utils/globals'
import {
    createMultipleQuestionSurvey,
    createSingleQuestionSurvey,
    showQuestion,
    setTextColors,
    // cancelSVG,
    closeSurveyPopup,
    // posthogLogo,
    style,
    getTextColor,
    defaultSurveyAppearance,
    nextQuestion,
} from './surveys/surveys-utils'
import * as Preact from 'preact'
import { useState, useEffect } from 'preact/hooks'

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

export const createThankYouMessage = (survey: Survey) => {
    const thankYouHTML = `
    <div class="thank-you-message-container">
        <div class="cancel-btn-wrapper">
            <button class="form-cancel" type="cancel">${cancelSVG}</button>
        </div>
        <h3 class="thank-you-message-header auto-text-color">${survey.appearance?.thankYouMessageHeader || 'Thank you!'
        }</h3>
        <div class="thank-you-message-body auto-text-color">${survey.appearance?.thankYouMessageDescription || ''}</div>
        <button class="form-submit auto-text-color"><span>Close</span><span class="thank-you-message-countdown"></span></button>
        ${survey.appearance?.whiteLabel
            ? ''
            : `<a href="https://posthog.com" target="_blank" rel="noopener" class="footer-branding auto-text-color">Survey by ${posthogLogo}</a>`
        }
    </div>
    `
    const thankYouElement = Object.assign(document.createElement('div'), {
        className: `thank-you-message`,
        innerHTML: thankYouHTML,
    })
    return thankYouElement
}

export const addCancelListeners = (
    posthog: PostHog,
    surveyPopup: HTMLFormElement,
    surveyId: string,
    surveyEventName: string
) => {
    const cancelButtons = surveyPopup.getElementsByClassName('form-cancel')
    for (const button of cancelButtons) {
        button.addEventListener('click', (e) => {
            e.preventDefault()
            closeSurveyPopup(surveyId, surveyPopup)
            posthog.capture('survey dismissed', {
                $survey_name: surveyEventName,
                $survey_id: surveyId,
                sessionRecordingUrl: posthog.get_session_replay_url?.(),
                $set: {
                    [`$survey_dismissed/${surveyId}`]: true,
                },
            })
        })
    }
    window.dispatchEvent(new Event('PHSurveyClosed'))
}

const handleWidget = (posthog: PostHog, survey: Survey) => {
    const posthogWidget = new SurveysWidget(posthog, survey)
    posthogWidget.createWidget()
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
                    // let surveyPopup
                    // if (survey.questions.length < 2) {
                    //     surveyPopup = createSingleQuestionSurvey(
                    //         posthog,
                    //         survey,
                    //         survey.questions[0]
                    //     ) as HTMLFormElement
                    // } else {
                    //     surveyPopup = createMultipleQuestionSurvey(posthog, survey)
                }
                // if (surveyPopup) {
                //     addCancelListeners(posthog, surveyPopup, survey.id, survey.name)
                //     if (survey.appearance?.whiteLabel) {
                //         const allBrandingElements = surveyPopup.getElementsByClassName('footer-branding')
                //         for (const brandingElement of allBrandingElements) {
                //             ; (brandingElement as HTMLAnchorElement).style.display = 'none'
                //         }
                //     }
                // shadow.appendChild(surveyPopup)
                // }
                // if (survey.questions.length > 1) {
                //     const currentQuestion = 0
                //     showQuestion(currentQuestion, survey.id, survey.type)
                // }
                // setTextColors(shadow)
                // window.dispatchEvent(new Event('PHSurveyShown'))
                // posthog.capture('survey shown', {
                //     $survey_name: survey.name,
                //     $survey_id: survey.id,
                //     sessionRecordingUrl: posthog.get_session_replay_url?.(),
                // })
                // localStorage.setItem(`lastSeenSurveyDate`, new Date().toISOString())
                // if (survey.appearance?.displayThankYouMessage) {
                //     window.addEventListener('PHSurveySent', () => {
                //         const thankYouElement = createThankYouMessage(survey)
                //         shadow.appendChild(thankYouElement)
                //         const cancelButtons = thankYouElement.querySelectorAll('.form-cancel, .form-submit')
                //         for (const button of cancelButtons) {
                //             button.addEventListener('click', () => {
                //                 thankYouElement.remove()
                //             })
                //         }
                //         const countdownEl = thankYouElement.querySelector('.thank-you-message-countdown')
                //         if (survey.appearance?.autoDisappear && countdownEl) {
                //             let count = 3
                //             countdownEl.textContent = `(${count})`
                //             const countdown = setInterval(() => {
                //                 count -= 1
                //                 if (count <= 0) {
                //                     clearInterval(countdown)
                //                     thankYouElement.remove()
                //                     return
                //                 }
                //                 countdownEl.textContent = `(${count})`
                //             }, 1000)
                //         }
                //         setTextColors(shadow)
                //     })
                // }
                // }
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

export function QuestionHeader({ question, description, backgroundColor }: { question: string, description?: string | null, backgroundColor?: string }) {

    return (
        <div style={{ backgroundColor: backgroundColor || defaultBackgroundColor }}>
            <div className="survey-question">{question}</div>
            <div className="description">{description}</div>
        </div>
    )
}

export function Cancel() {
    return (
        <div className="cancel-btn-wrapper">
            <button className="form-cancel" onClick={() => window.dispatchEvent(new Event('PHSurveyClosed'))}>{cancelSVG}</button>
        </div>
    )
}

export function BottomSection({ text, submitDisabled, appearance, onSubmit, link }: { text: string, submitDisabled: boolean, appearance: SurveyAppearance, onSubmit: () => void, link?: string | null }) {
    const backgroundColorRef = Preact.createRef()
    const [textColor, setTextColor] = useState('white')

    useEffect(() => {
        const color = getTextColor(backgroundColorRef.current)
        setTextColor(color)

    }, [appearance])

    return (
        <div className="bottom-section">
            <div className="buttons">
                <button className="form-submit"
                    ref={backgroundColorRef}
                    disabled={submitDisabled}
                    style={{ color: textColor }}
                    onClick={() => {
                        if (link) {
                            window.open(link)
                        }
                        onSubmit()
                    }}>
                    {text}
                </button>
            </div>
            {!appearance.whiteLabel && <PostHogLogo backgroundColor={appearance.backgroundColor || defaultBackgroundColor} />}
        </div>
    )
}

export function PostHogLogo({ backgroundColor }: { backgroundColor?: string }) {
    const backgroundColorRef = Preact.createRef()
    const [textColor, setTextColor] = useState('white')
    useEffect(() => {
        setTextColor(getTextColor(backgroundColorRef.current))
    }, [])

    return (
        <a href="https://posthog.com" target="_blank" rel="noopener" ref={backgroundColorRef} style={{ backgroundColor: backgroundColor, color: textColor }} className="footer-branding auto-text-color">Survey by {posthogLogo}</a>
    )
}
const sendSurveyEvent = (responses: Record<string, string | number | string[] | null> = {}, survey: Survey, posthog: PostHog) => {
    localStorage.setItem(`seenSurvey_${survey.id}`, 'true')
    posthog.capture('survey sent', {
        $survey_name: survey.name,
        $survey_id: survey.id,
        $survey_questions: survey.questions.map((question) => question.question),
        sessionRecordingUrl: posthog.get_session_replay_url?.(),
        ...responses,
        $set: {
            [`$survey_responded/${survey.id}`]: true,
        },
    })
    window.dispatchEvent(new Event('PHSurveySent'))
}
export function Surveys({ posthog, survey }: { posthog: PostHog, survey: Survey }) {
    const [showConfirmation, setShowConfirmation] = useState(false)
    const [showSurveyQuestion, setShowSurveyQuestion] = useState(true)

    useEffect(() => {
        window.dispatchEvent(new Event('PHSurveyShown'))
        posthog.capture('survey shown', {
            $survey_name: survey.name,
            $survey_id: survey.id,
            sessionRecordingUrl: posthog.get_session_replay_url?.(),
        })
        localStorage.setItem(`lastSeenSurveyDate`, new Date().toISOString())

        window.addEventListener('PHSurveyClosed', () => {
            localStorage.setItem(`seenSurvey_${survey.id}`, 'true')
            console.log('survey dismissed')
            posthog.capture('survey dismissed', {
                $survey_name: survey.name,
                $survey_id: survey.id,
                sessionRecordingUrl: posthog.get_session_replay_url?.(),
                $set: {
                    [`$survey_dismissed/${survey.id}`]: true,
                },
            })
            setShowSurveyQuestion(false)
        })

        window.addEventListener('PHSurveySent', () => {
            setShowSurveyQuestion(false)
            setShowConfirmation(true)
            // setTimeout(() => {
            //     setShowConfirmation(true)
            // }, 500)
        })
    }, [])
    console.log('show confirmation', showConfirmation)
    return (
        <>
            {showSurveyQuestion && <Questions survey={survey} posthog={posthog} />}
            {survey.appearance?.displayThankYouMessage && showConfirmation &&
                <ConfirmationMessage confirmationHeader={survey.appearance?.thankYouMessageHeader || 'Thank you!'} confirmationDescription={survey.appearance?.thankYouMessageDescription || ''} appearance={survey.appearance || {}} />
            }
        </>
    )
}



export function Questions({ survey, posthog }: { survey: Survey, posthog: PostHog }) {
    const backgroundColorRef = Preact.createRef()
    const [textColor, setTextColor] = useState('white')
    const [questionsResponses, setQuestionsResponses] = useState({})
    const [currentQuestion, setCurrentQuestion] = useState(0)
    useEffect(() => {
        setTextColor(getTextColor(backgroundColorRef.current))
    }, [])

    const onNextClick = (res: string, idx: number) => {
        if (idx === survey.questions.length - 1) {
            sendSurveyEvent(questionsResponses, survey, posthog)
            return
        } else {
            const responseKey = idx === 0 ? `$survey_response` : `$survey_response_${idx}`
            setQuestionsResponses({ ...questionsResponses, [responseKey]: res })
            setCurrentQuestion(idx + 1)
        }
    }
    const isMultipleQuestion = survey.questions.length > 1
    console.log('questions', currentQuestion, isMultipleQuestion)

    return (
        <form
            className="survey-form"
            style={{ color: textColor, borderColor: survey.appearance?.borderColor }}
            ref={backgroundColorRef}
        >
            {survey.questions.map((question, idx) => {
                console.log('where am i', isMultipleQuestion, idx)
                if (isMultipleQuestion) {
                    return (
                        <>
                            {currentQuestion === idx && <div className={`tab question-${idx} ${question.type}`}>
                                {questionTypeMap(question, idx, survey.appearance || defaultSurveyAppearance, (res) => onNextClick(res, idx))}
                            </div>}
                        </>
                    )
                }
                return (
                    questionTypeMap(survey.questions[idx], idx, survey.appearance || defaultSurveyAppearance, (res) => onNextClick(res, idx))
                )
            })}
        </form>
    )
}

export function OpenTextQuestion({ question, appearance, onSubmit }: { question: any, appearance: SurveyAppearance, onSubmit: (text: string) => void }) {
    const textRef = Preact.createRef()
    const [text, setText] = useState('')
    return (
        <div className="survey-box" style={{ backgroundColor: appearance.backgroundColor || defaultBackgroundColor }} ref={textRef}>
            <Cancel />
            <QuestionHeader question={question.question} description={question.description} backgroundColor={appearance.backgroundColor} />
            <textarea rows={4} placeholder={appearance?.placeholder} onInput={e => setText(e.currentTarget.value)} />
            <BottomSection
                text={question.buttonText || 'Submit'}
                submitDisabled={(!text && !question.optional)}
                appearance={appearance}
                onSubmit={() => onSubmit(text)}
            />
        </div>
    )
}

export function LinkQuestion({ question, appearance, onSubmit }: { question: LinkSurveyQuestion, appearance: SurveyAppearance, onSubmit: () => void }) {
    return (
        <div className="survey-box">
            <Cancel />
            <QuestionHeader question={question.question} description={question.description} />
            <BottomSection
                text={question.buttonText || 'Submit'}
                submitDisabled={false}
                link={question.link}
                appearance={appearance}
                onSubmit={onSubmit}
            />
        </div>
    )
}

export function RatingQuestion({ question, questionIndex, appearance, onSubmit }: { question: any, questionIndex: number, appearance: SurveyAppearance, onSubmit: (rating: number | null) => void }) {
    const threeScaleEmojis = [dissatisfiedEmoji, neutralEmoji, dissatisfiedEmoji]
    const fiveScaleEmojis = [dissatisfiedEmoji, neutralEmoji, dissatisfiedEmoji, neutralEmoji, dissatisfiedEmoji]
    const fiveScaleNumbers = [1, 2, 3, 4, 5]
    const tenScaleNumbers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const scale = question.scale
    const starting = question.scale === 10 ? 0 : 1
    const [rating, setRating] = useState<number | null>(null)

    return (
        <div className="survey-box">
            <Cancel />
            <QuestionHeader question={question.question} description={question.description} backgroundColor={appearance.backgroundColor} />
            <div className="rating-section">
                <div className="rating-options">

                    {question.display === 'emoji' && (
                        <div className="rating-options-emoji">
                            {(question.scale === 3 ? threeScaleEmojis : fiveScaleEmojis).map((emoji, idx) => {
                                const active = idx === rating
                                return (
                                    <button
                                        className={`ratings-emoji question-${questionIndex}-rating-${idx}`}
                                        value={idx + 1}
                                        key={idx}
                                        style={{ fill: active ? appearance.ratingButtonActiveColor : appearance.ratingButtonColor }}
                                        onClick={() => { setRating(idx + 1) }}
                                    >
                                        {emoji}
                                    </button>
                                )
                            })}

                        </div>
                    )}
                    {question.display === 'number' && (
                        <div className="rating-options-number" style={{ gridTemplateColumns: `repeat(${scale - starting + 1}, minmax(0, 1fr))` }}>
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
                submitDisabled={((rating === null) && !question.optional)}
                appearance={appearance}
                onSubmit={() => onSubmit(rating)}
            />
        </div >
    )
}

export function RatingButton({ num, active, questionIndex, appearance, setActiveNumber }: { num: number, active: boolean, questionIndex: number, appearance: any, setActiveNumber: (num: number) => void }) {
    const [textColor, setTextColor] = useState('black')
    const ref = Preact.createRef()

    useEffect(() => {
        if (ref.current) {
            const textColor = getTextColor(ref.current)
            setTextColor(textColor)
        }
    }, [appearance.ratingButtonActiveColor, appearance.ratingButtonColor, active])

    return (
        <button
            ref={ref}
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

export function ConfirmationMessage({ confirmationHeader, confirmationDescription, appearance }: { confirmationHeader: string, confirmationDescription: string, appearance: SurveyAppearance }) {
    // const [count, setCount] = useState(3)
    // const [displayConfirmation, setDisplayConfirmation] = useState(false)
    // useEffect(() => {
    //     // window.addEventListener('PHSurveySent', () => {
    //     //     debugger
    //     //     setTimeout(() => {
    //     //         setDisplayConfirmation(true)
    //     //     }, 1000)
    //     //     // setDisplayConfirmation(true)
    //     //     if (appearance.autoDisappear) {
    //     //         setInterval(() => {
    //     //             setCount(count - 1)
    //     //             if (count <= 0) {
    //     //                 clearInterval(count)
    //     //                 setDisplayConfirmation(false)
    //     //                 return
    //     //             }
    //     //         }, 1000)
    //     //     }
    //     // })
    // }, [appearance])

    return (
        <>
            <div className="thank-you-message">
                <div className="thank-you-message-container">
                    <Cancel />
                    <h3 className="thank-you-message-header auto-text-color">{confirmationHeader}</h3>
                    <div className="thank-you-message-body">{confirmationDescription}</div>
                    {appearance.autoDisappear && <div className="thank-you-message-countdown">{1}</div>}
                    <BottomSection
                        text={''}
                        submitDisabled={false}
                        appearance={appearance}
                        onSubmit={() => { }}
                    />
                </div>
            </div>

        </>
    )
}

export function MultipleChoiceQuestion({ question, questionIndex, appearance, onSubmit }: { question: any, questionIndex: number, appearance: SurveyAppearance, onSubmit: (text: string) => void }) {
    const textRef = Preact.createRef()
    const [text, setText] = useState('')
    const inputType = question.type === 'single_choice' ? 'radio' : 'checkbox'
    return (
        <div className="survey-box" style={{ backgroundColor: appearance.backgroundColor || defaultBackgroundColor }} ref={textRef}>
            <Cancel />
            <QuestionHeader question={question.question} description={question.description} backgroundColor={appearance.backgroundColor} />
            <div className="multiple-choice-options">
                {question.choices.map((choice: string, idx: number) => {
                    let choiceClass = 'choice-option'
                    let val = choice
                    let option = choice
                    if (!!question.hasOpenChoice && idx === question.choices.length - 1) {
                        option = `<span>${option}:</span><input type="text" value="">`
                        choiceClass += ' choice-option-open'
                        option = ''
                    }
                    return (
                        <div className={choiceClass}>
                            <input type={inputType} id={`surveyQuestion${questionIndex}Choice${idx}`} name={`question${questionIndex}`} value={val} disabled={!choice} />
                            <label className="auto-text-color" htmlFor={`surveyQuestion${questionIndex}Choice${idx}`}>{option}</label>
                            <span className="choice-check auto-text-color">{checkSVG}</span>
                        </div>
                    )
                })}
            </div>
            <BottomSection
                text={question.buttonText || 'Submit'}
                submitDisabled={(!text && !question.optional)}
                appearance={appearance}
                onSubmit={() => onSubmit(text)}
            />
        </div>
    )
}

const questionTypeMap = (question: SurveyQuestion, questionIndex: number, appearance: SurveyAppearance, onSubmit: (res: string) => void): JSX.Element => {
    const mapping = {
        [SurveyQuestionType.Open]: <OpenTextQuestion question={question} appearance={appearance} onSubmit={onSubmit} />,
        [SurveyQuestionType.Link]: <LinkQuestion question={question as LinkSurveyQuestion} appearance={appearance} onSubmit={() => { }} />,
        [SurveyQuestionType.Rating]: <RatingQuestion question={question} appearance={appearance} questionIndex={questionIndex} onSubmit={() => { }} />,
        [SurveyQuestionType.SingleChoice]: <MultipleChoiceQuestion question={question} appearance={appearance} questionIndex={questionIndex} onSubmit={onSubmit} />,
        [SurveyQuestionType.MultipleChoice]: <MultipleChoiceQuestion question={question} appearance={appearance} questionIndex={questionIndex} onSubmit={onSubmit} />,
    }
    return mapping[question.type]

}


export const satisfiedEmoji =
    <svg className="emoji-svg" xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M626-533q22.5 0 38.25-15.75T680-587q0-22.5-15.75-38.25T626-641q-22.5 0-38.25 15.75T572-587q0 22.5 15.75 38.25T626-533Zm-292 0q22.5 0 38.25-15.75T388-587q0-22.5-15.75-38.25T334-641q-22.5 0-38.25 15.75T280-587q0 22.5 15.75 38.25T334-533Zm146 272q66 0 121.5-35.5T682-393h-52q-23 40-63 61.5T480.5-310q-46.5 0-87-21T331-393h-53q26 61 81 96.5T480-261Zm0 181q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-400Zm0 340q142.375 0 241.188-98.812Q820-337.625 820-480t-98.812-241.188Q622.375-820 480-820t-241.188 98.812Q140-622.375 140-480t98.812 241.188Q337.625-140 480-140Z" /></svg>
export const neutralEmoji =
    <svg className="emoji-svg" xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M626-533q22.5 0 38.25-15.75T680-587q0-22.5-15.75-38.25T626-641q-22.5 0-38.25 15.75T572-587q0 22.5 15.75 38.25T626-533Zm-292 0q22.5 0 38.25-15.75T388-587q0-22.5-15.75-38.25T334-641q-22.5 0-38.25 15.75T280-587q0 22.5 15.75 38.25T334-533Zm20 194h253v-49H354v49ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-400Zm0 340q142.375 0 241.188-98.812Q820-337.625 820-480t-98.812-241.188Q622.375-820 480-820t-241.188 98.812Q140-622.375 140-480t98.812 241.188Q337.625-140 480-140Z" /></svg>
export const dissatisfiedEmoji =
    <svg className="emoji-svg" xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M626-533q22.5 0 38.25-15.75T680-587q0-22.5-15.75-38.25T626-641q-22.5 0-38.25 15.75T572-587q0 22.5 15.75 38.25T626-533Zm-292 0q22.5 0 38.25-15.75T388-587q0-22.5-15.75-38.25T334-641q-22.5 0-38.25 15.75T280-587q0 22.5 15.75 38.25T334-533Zm146.174 116Q413-417 358.5-379.5T278-280h53q22-42 62.173-65t87.5-23Q528-368 567.5-344.5T630-280h52q-25-63-79.826-100-54.826-37-122-37ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-400Zm0 340q142.375 0 241.188-98.812Q820-337.625 820-480t-98.812-241.188Q622.375-820 480-820t-241.188 98.812Q140-622.375 140-480t98.812 241.188Q337.625-140 480-140Z" /></svg>
export const veryDissatisfiedEmoji =
    <svg className="emoji-svg" xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M480-417q-67 0-121.5 37.5T278-280h404q-25-63-80-100t-122-37Zm-183-72 50-45 45 45 31-36-45-45 45-45-31-36-45 45-50-45-31 36 45 45-45 45 31 36Zm272 0 44-45 51 45 31-36-45-45 45-45-31-36-51 45-44-45-31 36 44 45-44 45 31 36ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-400Zm0 340q142 0 241-99t99-241q0-142-99-241t-241-99q-142 0-241 99t-99 241q0 142 99 241t241 99Z" /></svg>
export const verySatisfiedEmoji =
    <svg className="emoji-svg" xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M479.504-261Q537-261 585.5-287q48.5-26 78.5-72.4 6-11.6-.75-22.6-6.75-11-20.25-11H316.918Q303-393 296.5-382t-.5 22.6q30 46.4 78.5 72.4 48.5 26 105.004 26ZM347-578l27 27q7.636 8 17.818 8Q402-543 410-551q8-8 8-18t-8-18l-42-42q-8.8-9-20.9-9-12.1 0-21.1 9l-42 42q-8 7.636-8 17.818Q276-559 284-551q8 8 18 8t18-8l27-27Zm267 0 27 27q7.714 8 18 8t18-8q8-7.636 8-17.818Q685-579 677-587l-42-42q-8.8-9-20.9-9-12.1 0-21.1 9l-42 42q-8 7.714-8 18t8 18q7.636 8 17.818 8Q579-543 587-551l27-27ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-400Zm0 340q142.375 0 241.188-98.812Q820-337.625 820-480t-98.812-241.188Q622.375-820 480-820t-241.188 98.812Q140-622.375 140-480t98.812 241.188Q337.625-140 480-140Z" /></svg>
export const cancelSVG =
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M0.164752 0.164752C0.384422 -0.0549175 0.740578 -0.0549175 0.960248 0.164752L6 5.20451L11.0398 0.164752C11.2594 -0.0549175 11.6156 -0.0549175 11.8352 0.164752C12.0549 0.384422 12.0549 0.740578 11.8352 0.960248L6.79549 6L11.8352 11.0398C12.0549 11.2594 12.0549 11.6156 11.8352 11.8352C11.6156 12.0549 11.2594 12.0549 11.0398 11.8352L6 6.79549L0.960248 11.8352C0.740578 12.0549 0.384422 12.0549 0.164752 11.8352C-0.0549175 11.6156 -0.0549175 11.2594 0.164752 11.0398L5.20451 6L0.164752 0.960248C-0.0549175 0.740578 -0.0549175 0.384422 0.164752 0.164752Z" fill="black" /></svg>
export const posthogLogo =
    <svg width="77" height="14" viewBox="0 0 77 14" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_2415_6911)"><mask id="mask0_2415_6911" style={{ maskType: "luminance" }} maskUnits="userSpaceOnUse" x="0" y="0" width="77" height="14"><path d="M0.5 0H76.5V14H0.5V0Z" fill="white" /></mask><g mask="url(#mask0_2415_6911)"><path d="M5.77226 8.02931C5.59388 8.37329 5.08474 8.37329 4.90634 8.02931L4.4797 7.20672C4.41155 7.07535 4.41155 6.9207 4.4797 6.78933L4.90634 5.96669C5.08474 5.62276 5.59388 5.62276 5.77226 5.96669L6.19893 6.78933C6.26709 6.9207 6.26709 7.07535 6.19893 7.20672L5.77226 8.02931ZM5.77226 12.6946C5.59388 13.0386 5.08474 13.0386 4.90634 12.6946L4.4797 11.872C4.41155 11.7406 4.41155 11.586 4.4797 11.4546L4.90634 10.632C5.08474 10.288 5.59388 10.288 5.77226 10.632L6.19893 11.4546C6.26709 11.586 6.26709 11.7406 6.19893 11.872L5.77226 12.6946Z" fill="#1D4AFF" /><path d="M0.5 10.9238C0.5 10.508 1.02142 10.2998 1.32637 10.5938L3.54508 12.7327C3.85003 13.0267 3.63405 13.5294 3.20279 13.5294H0.984076C0.716728 13.5294 0.5 13.3205 0.5 13.0627V10.9238ZM0.5 8.67083C0.5 8.79459 0.551001 8.91331 0.641783 9.00081L5.19753 13.3927C5.28831 13.4802 5.41144 13.5294 5.53982 13.5294H8.0421C8.47337 13.5294 8.68936 13.0267 8.3844 12.7327L1.32637 5.92856C1.02142 5.63456 0.5 5.84278 0.5 6.25854V8.67083ZM0.5 4.00556C0.5 4.12932 0.551001 4.24802 0.641783 4.33554L10.0368 13.3927C10.1276 13.4802 10.2508 13.5294 10.3791 13.5294H12.8814C13.3127 13.5294 13.5287 13.0267 13.2237 12.7327L1.32637 1.26329C1.02142 0.969312 0.5 1.17752 0.5 1.59327V4.00556ZM5.33931 4.00556C5.33931 4.12932 5.39033 4.24802 5.4811 4.33554L14.1916 12.7327C14.4965 13.0267 15.0179 12.8185 15.0179 12.4028V9.99047C15.0179 9.86671 14.9669 9.74799 14.8762 9.66049L6.16568 1.26329C5.86071 0.969307 5.33931 1.17752 5.33931 1.59327V4.00556ZM11.005 1.26329C10.7 0.969307 10.1786 1.17752 10.1786 1.59327V4.00556C10.1786 4.12932 10.2296 4.24802 10.3204 4.33554L14.1916 8.06748C14.4965 8.36148 15.0179 8.15325 15.0179 7.7375V5.3252C15.0179 5.20144 14.9669 5.08272 14.8762 4.99522L11.005 1.26329Z" fill="#F9BD2B" /><path d="M21.0852 10.981L16.5288 6.58843C16.2238 6.29443 15.7024 6.50266 15.7024 6.91841V13.0627C15.7024 13.3205 15.9191 13.5294 16.1865 13.5294H23.2446C23.5119 13.5294 23.7287 13.3205 23.7287 13.0627V12.5032C23.7287 12.2455 23.511 12.0396 23.2459 12.0063C22.4323 11.9042 21.6713 11.546 21.0852 10.981ZM18.0252 12.0365C17.5978 12.0365 17.251 11.7021 17.251 11.2901C17.251 10.878 17.5978 10.5436 18.0252 10.5436C18.4527 10.5436 18.7996 10.878 18.7996 11.2901C18.7996 11.7021 18.4527 12.0365 18.0252 12.0365Z" fill="currentColor" /><path d="M0.5 13.0627C0.5 13.3205 0.716728 13.5294 0.984076 13.5294H3.20279C3.63405 13.5294 3.85003 13.0267 3.54508 12.7327L1.32637 10.5938C1.02142 10.2998 0.5 10.508 0.5 10.9238V13.0627ZM5.33931 5.13191L1.32637 1.26329C1.02142 0.969306 0.5 1.17752 0.5 1.59327V4.00556C0.5 4.12932 0.551001 4.24802 0.641783 4.33554L5.33931 8.86412V5.13191ZM1.32637 5.92855C1.02142 5.63455 0.5 5.84278 0.5 6.25853V8.67083C0.5 8.79459 0.551001 8.91331 0.641783 9.00081L5.33931 13.5294V9.79717L1.32637 5.92855Z" fill="#1D4AFF" /><path d="M10.1787 5.3252C10.1787 5.20144 10.1277 5.08272 10.0369 4.99522L6.16572 1.26329C5.8608 0.969306 5.33936 1.17752 5.33936 1.59327V4.00556C5.33936 4.12932 5.39037 4.24802 5.48114 4.33554L10.1787 8.86412V5.3252ZM5.33936 13.5294H8.04214C8.47341 13.5294 8.6894 13.0267 8.38443 12.7327L5.33936 9.79717V13.5294ZM5.33936 5.13191V8.67083C5.33936 8.79459 5.39037 8.91331 5.48114 9.00081L10.1787 13.5294V9.99047C10.1787 9.86671 10.1277 9.74803 10.0369 9.66049L5.33936 5.13191Z" fill="#F54E00" /><path d="M29.375 11.6667H31.3636V8.48772H33.0249C34.8499 8.48772 36.0204 7.4443 36.0204 5.83052C36.0204 4.21681 34.8499 3.17334 33.0249 3.17334H29.375V11.6667ZM31.3636 6.84972V4.81136H32.8236C33.5787 4.81136 34.0318 5.19958 34.0318 5.83052C34.0318 6.4615 33.5787 6.84972 32.8236 6.84972H31.3636ZM39.618 11.7637C41.5563 11.7637 42.9659 10.429 42.9659 8.60905C42.9659 6.78905 41.5563 5.45438 39.618 5.45438C37.6546 5.45438 36.2701 6.78905 36.2701 8.60905C36.2701 10.429 37.6546 11.7637 39.618 11.7637ZM38.1077 8.60905C38.1077 7.63838 38.7118 6.97105 39.618 6.97105C40.5116 6.97105 41.1157 7.63838 41.1157 8.60905C41.1157 9.57972 40.5116 10.2471 39.618 10.2471C38.7118 10.2471 38.1077 9.57972 38.1077 8.60905ZM46.1482 11.7637C47.6333 11.7637 48.6402 10.8658 48.6402 9.81025C48.6402 7.33505 45.2294 8.13585 45.2294 7.16518C45.2294 6.8983 45.5189 6.72843 45.9342 6.72843C46.3622 6.72843 46.8782 6.98318 47.0418 7.54132L48.527 6.94678C48.2375 6.06105 47.1677 5.45438 45.8713 5.45438C44.4743 5.45438 43.6058 6.25518 43.6058 7.21372C43.6058 9.53118 46.9663 8.88812 46.9663 9.84665C46.9663 10.1864 46.6391 10.417 46.1482 10.417C45.4434 10.417 44.9525 9.94376 44.8015 9.3735L43.3164 9.93158C43.6436 10.8537 44.6001 11.7637 46.1482 11.7637ZM53.4241 11.606L53.2982 10.0651C53.0843 10.1743 52.8074 10.2106 52.5808 10.2106C52.1278 10.2106 51.8257 9.89523 51.8257 9.34918V7.03172H53.3612V5.55145H51.8257V3.78001H49.9755V5.55145H48.9687V7.03172H49.9755V9.57972C49.9755 11.06 51.0202 11.7637 52.3921 11.7637C52.7696 11.7637 53.122 11.7031 53.4241 11.606ZM59.8749 3.17334V6.47358H56.376V3.17334H54.3874V11.6667H56.376V8.11158H59.8749V11.6667H61.8761V3.17334H59.8749ZM66.2899 11.7637C68.2281 11.7637 69.6378 10.429 69.6378 8.60905C69.6378 6.78905 68.2281 5.45438 66.2899 5.45438C64.3265 5.45438 62.942 6.78905 62.942 8.60905C62.942 10.429 64.3265 11.7637 66.2899 11.7637ZM64.7796 8.60905C64.7796 7.63838 65.3837 6.97105 66.2899 6.97105C67.1835 6.97105 67.7876 7.63838 67.7876 8.60905C67.7876 9.57972 67.1835 10.2471 66.2899 10.2471C65.3837 10.2471 64.7796 9.57972 64.7796 8.60905ZM73.2088 11.4725C73.901 11.4725 74.5177 11.242 74.845 10.8416V11.424C74.845 12.1034 74.2786 12.5767 73.4102 12.5767C72.7935 12.5767 72.2523 12.2854 72.1642 11.788L70.4776 12.0428C70.7042 13.1955 71.925 13.972 73.4102 13.972C75.361 13.972 76.6574 12.8679 76.6574 11.2298V5.55145H74.8324V6.07318C74.4926 5.69705 73.9136 5.45438 73.171 5.45438C71.409 5.45438 70.3014 6.61918 70.3014 8.46345C70.3014 10.3077 71.409 11.4725 73.2088 11.4725ZM72.1012 8.46345C72.1012 7.55345 72.655 6.97105 73.5109 6.97105C74.3793 6.97105 74.9331 7.55345 74.9331 8.46345C74.9331 9.37345 74.3793 9.95585 73.5109 9.95585C72.655 9.95585 72.1012 9.37345 72.1012 8.46345Z" fill="currentColor" /></g></g><defs><clipPath id="clip0_2415_6911"><rect width="76" height="14" fill="white" transform="translate(0.5)" /></clipPath></defs></svg>
export const checkSVG =
    <svg width="16" height="12" viewBox="0 0 16 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.30769 10.6923L4.77736 11.2226C4.91801 11.3633 5.10878 11.4423 5.30769 11.4423C5.5066 11.4423 5.69737 11.3633 5.83802 11.2226L5.30769 10.6923ZM15.5303 1.53033C15.8232 1.23744 15.8232 0.762563 15.5303 0.46967C15.2374 0.176777 14.7626 0.176777 14.4697 0.46967L15.5303 1.53033ZM1.53033 5.85429C1.23744 5.56139 0.762563 5.56139 0.46967 5.85429C0.176777 6.14718 0.176777 6.62205 0.46967 6.91495L1.53033 5.85429ZM5.83802 11.2226L15.5303 1.53033L14.4697 0.46967L4.77736 10.162L5.83802 11.2226ZM0.46967 6.91495L4.77736 11.2226L5.83802 10.162L1.53033 5.85429L0.46967 6.91495Z" fill="currentColor" /></svg>
