import { PostHog } from '../posthog-core'
import { Survey } from '../posthog-surveys-types'
import {
    createMultipleQuestionSurvey,
    createSingleQuestionSurvey,
    setTextColors,
    showQuestion,
    style,
} from './surveys/surveys-utils'
import { document as _document, window as _window } from '../utils/globals'
import { createThankYouMessage } from './surveys'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const document = _document as Document
const window = _window as Window & typeof globalThis

export class SurveysWidget {
    instance: PostHog
    survey: Survey
    shadow: any

    constructor(instance: PostHog, survey: Survey) {
        this.instance = instance
        this.survey = survey
        this.shadow = this.createWidgetShadow()
    }

    createWidget(): void {
        const surveyPopup = this.createSurveyForWidget()
        let widget
        if (this.survey.appearance?.widgetType === 'selector') {
            // user supplied button
            widget = document.querySelector(this.survey.appearance.widgetSelector || '')
        } else if (this.survey.appearance?.widgetType === 'tab') {
            widget = this.createTabWidget()
        } else if (this.survey.appearance?.widgetType === 'button') {
            widget = this.createButtonWidget()
        }
        if (this.survey.appearance?.widgetType !== 'selector') {
            this.shadow.appendChild(widget)
        }
        setTextColors(this.shadow)
        // reposition survey next to widget when opened
        if (surveyPopup && this.survey.appearance?.widgetType === 'tab' && widget) {
            surveyPopup.style.bottom = 'auto'
            surveyPopup.style.borderBottom = `1.5px solid ${this.survey.appearance?.borderColor || '#c9c6c6'}`
            surveyPopup.style.borderRadius = '10px'
            const widgetPos = widget.getBoundingClientRect()
            surveyPopup.style.top = '50%'
            surveyPopup.style.left = `${widgetPos.right - 360}px`
        }
        if (widget) {
            widget.addEventListener('click', () => {
                if (surveyPopup) {
                    surveyPopup.style.display = surveyPopup.style.display === 'none' ? 'block' : 'none'
                }
            })
            widget.setAttribute('PHWidgetSurveyClickListener', 'true')
            surveyPopup?.addEventListener('PHSurveyClosed', () => (surveyPopup.style.display = 'none'))
        }
    }

    createTabWidget(): HTMLDivElement {
        // make a permanent tab widget
        const tab = document.createElement('div')
        const html = `
            <div class="ph-survey-widget-tab auto-text-color">
                <div class="ph-survey-widget-tab-icon">
                </div>
                ${this.survey.appearance?.widgetLabel || ''}
            </div>
            `

        tab.innerHTML = html
        return tab
    }

    createButtonWidget(): HTMLButtonElement {
        // make a permanent button widget
        const label = 'Feedback :)'
        const button = document.createElement('button')
        const html = `
            <div class="ph-survey-widget-button auto-text-color">
                <div class="ph-survey-widget-button-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                </div>
                ${label}
            </div>
            `
        button.innerHTML = html
        return button
    }

    private createSurveyForWidget(): HTMLFormElement | null {
        const surveyStyleSheet = style(this.survey.id, this.survey.appearance)
        this.shadow.appendChild(Object.assign(document.createElement('style'), { innerText: surveyStyleSheet }))
        const widgetSurvey =
            this.survey.questions.length > 1
                ? createMultipleQuestionSurvey(this.instance, this.survey)
                : createSingleQuestionSurvey(this.instance, this.survey, this.survey.questions[0])
        if (widgetSurvey) {
            widgetSurvey.style.display = 'none'
            this.shadow.appendChild(widgetSurvey)
            if (this.survey.questions.length > 1) {
                const currentQuestion = 0
                showQuestion(currentQuestion, this.survey.id, this.survey.type)
            }
            setTextColors(this.shadow)
            window.dispatchEvent(new Event('PHSurveyShown'))
            this.instance.capture('survey shown', {
                $survey_name: this.survey.name,
                $survey_id: this.survey.id,
                sessionRecordingUrl: this.instance.get_session_replay_url?.(),
            })
            if (this.survey.appearance?.whiteLabel) {
                const allBrandingElements = widgetSurvey.getElementsByClassName('footer-branding')
                for (const brandingElement of allBrandingElements) {
                    ;(brandingElement as HTMLAnchorElement).style.display = 'none'
                }
            }
            if (this.survey.appearance?.displayThankYouMessage) {
                window.addEventListener('PHSurveySent', () => {
                    const thankYouElement = createThankYouMessage(this.survey)
                    this.shadow.appendChild(thankYouElement)
                    const cancelButtons = thankYouElement.querySelectorAll('.form-cancel, .form-submit')
                    for (const button of cancelButtons) {
                        button.addEventListener('click', () => {
                            thankYouElement.remove()
                        })
                    }
                    const countdownEl = thankYouElement.querySelector('.thank-you-message-countdown')
                    if (this.survey.appearance?.autoDisappear && countdownEl) {
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
                    setTextColors(this.shadow)
                })
            }
        }
        // add survey cancel listener
        widgetSurvey?.addEventListener('PHSurveyClosed', () => (widgetSurvey.style.display = 'none'))
        return widgetSurvey as HTMLFormElement
    }

    private createWidgetShadow() {
        const div = document.createElement('div')
        div.className = `PostHogWidget${this.survey.id}`
        const shadow = div.attachShadow({ mode: 'open' })
        const widgetStyleSheet = `
            .ph-survey-widget-tab {
                position: fixed;
                top: 50%;
                right: 0;
                background: ${this.survey.appearance?.widgetColor || '#e0a045'};
                color: white;
                transform: rotate(-90deg) translate(0, -100%);
                transform-origin: right top;
                min-width: 40px;
                padding: 8px 12px;
                font-weight: 500;
                border-radius: 3px 3px 0 0;
                text-align: center;
                cursor: pointer;
                z-index: 9999999;
            }
            .ph-survey-widget-tab:hover {
                padding-bottom: 13px;
            }
            .ph-survey-widget-button {
                position: fixed;
            }
        `
        shadow.append(Object.assign(document.createElement('style'), { innerText: widgetStyleSheet }))
        document.body.appendChild(div)
        return shadow
    }
}
