import { PostHog } from 'posthog-core'
import { Survey, SurveyType } from '../posthog-surveys-types'
import { SurveysWidget } from './surveys-widget'

import { window as _window, document as _document } from '../utils/globals'
import {
    createMultipleQuestionSurvey,
    createSingleQuestionSurvey,
    showQuestion,
    setTextColors,
    cancelSVG,
    closeSurveyPopup,
    posthogLogo,
    style,
} from './surveys/surveys-utils'

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
        <h3 class="thank-you-message-header auto-text-color">${
            survey.appearance?.thankYouMessageHeader || 'Thank you!'
        }</h3>
        <div class="thank-you-message-body auto-text-color">${survey.appearance?.thankYouMessageDescription || ''}</div>
        <button class="form-submit auto-text-color"><span>Close</span><span class="thank-you-message-countdown"></span></button>
        ${
            survey.appearance?.whiteLabel
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
            if (
                survey.type === SurveyType.Widget &&
                document.querySelectorAll(`.PostHogWidget${survey.id}`).length === 0
            ) {
                if (survey.appearance?.widgetType !== 'selector') {
                    handleWidget(posthog, survey)
                } else if (survey.appearance?.widgetType === 'selector') {
                    const widgetSelector = document.querySelector(survey.appearance.widgetSelector || '')
                    if (widgetSelector) {
                        handleWidget(posthog, survey)
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
                    const shadow = createShadow(style(survey.id, survey?.appearance), survey.id)
                    let surveyPopup
                    if (survey.questions.length < 2) {
                        surveyPopup = createSingleQuestionSurvey(
                            posthog,
                            survey,
                            survey.questions[0]
                        ) as HTMLFormElement
                    } else {
                        surveyPopup = createMultipleQuestionSurvey(posthog, survey)
                    }
                    if (surveyPopup) {
                        addCancelListeners(posthog, surveyPopup, survey.id, survey.name)
                        if (survey.appearance?.whiteLabel) {
                            const allBrandingElements = surveyPopup.getElementsByClassName('footer-branding')
                            for (const brandingElement of allBrandingElements) {
                                ;(brandingElement as HTMLAnchorElement).style.display = 'none'
                            }
                        }
                        shadow.appendChild(surveyPopup)
                    }
                    if (survey.questions.length > 1) {
                        const currentQuestion = 0
                        showQuestion(currentQuestion, survey.id)
                    }
                    setTextColors(shadow)
                    window.dispatchEvent(new Event('PHSurveyShown'))
                    posthog.capture('survey shown', {
                        $survey_name: survey.name,
                        $survey_id: survey.id,
                        sessionRecordingUrl: posthog.get_session_replay_url?.(),
                    })
                    localStorage.setItem(`lastSeenSurveyDate`, new Date().toISOString())
                    if (survey.appearance?.displayThankYouMessage) {
                        window.addEventListener('PHSurveySent', () => {
                            const thankYouElement = createThankYouMessage(survey)
                            shadow.appendChild(thankYouElement)
                            const cancelButtons = thankYouElement.querySelectorAll('.form-cancel, .form-submit')
                            for (const button of cancelButtons) {
                                button.addEventListener('click', () => {
                                    thankYouElement.remove()
                                })
                            }
                            const countdownEl = thankYouElement.querySelector('.thank-you-message-countdown')
                            if (survey.appearance?.autoDisappear && countdownEl) {
                                let count = 3
                                countdownEl.textContent = `(${count})`
                                const countdown = setInterval(() => {
                                    count -= 1
                                    if (count <= 0) {
                                        clearInterval(countdown)
                                        thankYouElement.remove()
                                        return
                                    }
                                    countdownEl.textContent = `(${count})`
                                }, 1000)
                            }
                            setTextColors(shadow)
                        })
                    }
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
