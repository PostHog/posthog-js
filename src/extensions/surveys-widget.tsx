import { Survey } from '../posthog-surveys-types'
import { document as _document } from '../utils/globals'
// import * as Preact from 'preact'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const document = _document as Document

// export class SurveysWidget {
//     instance: PostHog
//     survey: Survey
//     shadow: any
//     widget?: any

//     constructor(instance: PostHog, survey: Survey, widget?: any) {
//         this.instance = instance
//         this.survey = survey
//         // this.shadow = this.createWidgetShadow()
//         this.widget = widget
//     }

//     createWidget(): void {
//         const surveyPopup = this.createSurveyForWidget()
//         let widget
//         if (this.survey.appearance?.widgetType === 'selector') {
//             // user supplied button
//             widget = document.querySelector(this.survey.appearance.widgetSelector || '')
//         } else if (this.survey.appearance?.widgetType === 'tab') {
//             widget = this.createTabWidget()
//         } else if (this.survey.appearance?.widgetType === 'button') {
//             widget = this.createButtonWidget()
//         }
//         this.widget = widget
//         if (this.survey.appearance?.widgetType !== 'selector') {
//             this.shadow.appendChild(this.widget)
//         }
//         setTextColors(this.shadow)
//         // reposition survey next to widget when opened
//         if (surveyPopup && this.survey.appearance?.widgetType === 'tab' && this.widget) {
//             surveyPopup.style.bottom = 'auto'
//             surveyPopup.style.borderBottom = `1.5px solid ${this.survey.appearance?.borderColor || '#c9c6c6'}`
//             surveyPopup.style.borderRadius = '10px'
//             const widgetPos = this.widget.getBoundingClientRect()
//             surveyPopup.style.top = '50%'
//             surveyPopup.style.left = `${widgetPos.right - 360}px`
//         }
//         if (this.widget) {
//             this.widget.addEventListener('click', () => {
//                 if (surveyPopup) {
//                     surveyPopup.style.display = surveyPopup.style.display === 'none' ? 'block' : 'none'
//                 }
//             })
//             this.widget.setAttribute('PHWidgetSurveyClickListener', 'true')
//             if (surveyPopup) {
//                 window.addEventListener('PHSurveySent', () => {
//                     if (surveyPopup) {
//                         surveyPopup.style.display = 'none'
//                     }
//                     const tabs = document
//                         ?.getElementsByClassName(`PostHogWidget${this.survey.id}`)[0]
//                         ?.shadowRoot?.querySelectorAll('.tab') as NodeListOf<HTMLElement>
//                     tabs.forEach((tab) => (tab.style.display = 'none'))
//                     showQuestion(0, this.survey.id, this.survey.type)
//                 })
//             }
//         }
//     }

//     createTabWidget(): HTMLDivElement {
//         // make a permanent tab widget
//         const tab = document.createElement('div')
//         const html = `
//             <div class="ph-survey-widget-tab auto-text-color">
//                 <div class="ph-survey-widget-tab-icon">
//                 </div>
//                 ${this.survey.appearance?.widgetLabel || ''}
//             </div>
//             `

//         tab.innerHTML = html
//         return tab
//     }

//     createButtonWidget(): HTMLButtonElement {
//         // make a permanent button widget
//         const label = 'Feedback :)'
//         const button = document.createElement('button')
//         const html = `
//             <div class="ph-survey-widget-button auto-text-color">
//                 <div class="ph-survey-widget-button-icon">
//                     <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
//                 </div>
//                 ${label}
//             </div>
//             `
//         button.innerHTML = html
//         return button
//     }

//     private createSurveyForWidget(): HTMLFormElement | null {
//         const surveyStyleSheet = style(this.survey.appearance)
//         this.shadow.appendChild(Object.assign(document.createElement('style'), { innerText: surveyStyleSheet }))
//         const widgetSurvey =
//             this.survey.questions.length > 1
//                 ? createMultipleQuestionSurvey(this.instance, this.survey)
//                 : createSingleQuestionSurvey(this.instance, this.survey, this.survey.questions[0])
//         if (widgetSurvey) {
//             widgetSurvey.style.display = 'none'
//             addCancelListeners(this.instance, widgetSurvey as HTMLFormElement, this.survey.id, this.survey.name)
//             if (this.survey.appearance?.whiteLabel) {
//                 const allBrandingElements = widgetSurvey.getElementsByClassName('footer-branding')
//                 for (const brandingElement of allBrandingElements) {
//                     ; (brandingElement as HTMLAnchorElement).style.display = 'none'
//                 }
//             }
//             this.shadow.appendChild(widgetSurvey)
//             if (this.survey.questions.length > 1) {
//                 const currentQuestion = 0
//                 showQuestion(currentQuestion, this.survey.id, this.survey.type)
//             }
//             setTextColors(this.shadow)
//             window.dispatchEvent(new Event('PHSurveyShown'))
//             this.instance.capture('survey shown', {
//                 $survey_name: this.survey.name,
//                 $survey_id: this.survey.id,
//                 sessionRecordingUrl: this.instance.get_session_replay_url?.(),
//             })
//             if (this.survey.appearance?.displayThankYouMessage) {
//                 window.addEventListener('PHSurveySent', () => {
//                     const thankYouElement = createThankYouMessage(this.survey)
//                     if (thankYouElement && this.survey.appearance?.widgetType === 'tab') {
//                         thankYouElement.style.bottom = 'auto'
//                         thankYouElement.style.borderBottom = `1.5px solid ${this.survey.appearance?.borderColor || '#c9c6c6'
//                             }`
//                         thankYouElement.style.borderRadius = '10px'
//                         const widgetPos = this.widget.getBoundingClientRect()
//                         thankYouElement.style.top = '50%'
//                         thankYouElement.style.left = `${widgetPos.right - 400}px`
//                     }
//                     this.shadow.appendChild(thankYouElement)
//                     // reposition thank you box next to widget when opened
//                     const cancelButtons = thankYouElement.querySelectorAll('.form-cancel, .form-submit')
//                     for (const button of cancelButtons) {
//                         button.addEventListener('click', () => {
//                             thankYouElement.remove()
//                         })
//                     }
//                     const countdownEl = thankYouElement.querySelector('.thank-you-message-countdown')
//                     if (this.survey.appearance?.autoDisappear && countdownEl) {
//                         let count = 3
//                         countdownEl.textContent = `(${count})`
//                         const countdown = setInterval(() => {
//                             count -= 1
//                             if (count <= 0) {
//                                 clearInterval(countdown)
//                                 thankYouElement.remove()
//                                 return
//                             }
//                             countdownEl.textContent = `(${count})`
//                         }, 1000)
//                     }
//                     setTextColors(this.shadow)
//                 })
//             }
//         }
//         return widgetSurvey as HTMLFormElement
//     }

//     // private
// }
export function createWidgetShadow(survey: Survey) {
    const div = document.createElement('div')
    div.className = `PostHogWidget${survey.id}`
    const shadow = div.attachShadow({ mode: 'open' })
    const widgetStyleSheet = `
        .ph-survey-widget-tab {
            position: fixed;
            top: 50%;
            right: 0;
            background: ${survey.appearance?.widgetColor || '#e0a045'};
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

// export function FeedbackWidget({ survey }: { survey: Survey }): JSX.Element {
//     return (
//         <>
//             <div className="ph-survey-widget-tab auto-text-color">
//                 <div className="ph-survey-widget-tab-icon">
//                 </div>
//                 {survey.appearance?.widgetLabel || ''}
//             </div>
//         </>
//     )
// }
