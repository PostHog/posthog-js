// import { PostHog } from 'posthog-core'
// import { Survey } from '../posthog-surveys-types'
// import { createMultipleQuestionSurvey, createSingleQuestionSurvey } from './surveys/surveys-utils'
// import { createMultipleQuestionSurvey, createSingleQuestionSurvey } from './surveys'

// export class SurveysWidget {
//     instance: PostHog
//     survey: Survey

//     constructor(instance: PostHog, survey: Survey) {
//         this.instance = instance
//         this.survey = survey
//     }

//     createTabWidget(): void {
//         // make a permanent tab widget
//         const label = 'Feedback :)'
//         const tab = document.createElement('div')
//         const html = `
//             <div class="ph-survey-widget-tab">
//                 <div class="ph-survey-widget-tab-icon">
//                     <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
//                 </div>
//                 ${label}
//             </div>
//             `
//         tab.innerHTML = html
//         const widgetForm = this.survey.questions.length > 1 ? createMultipleQuestionSurvey(this.instance, this.survey) : createSingleQuestionSurvey(this.instance, this.survey, this.survey.questions[0])
//     }

//     createButtonWidget(): void {
//         // make a permanent button widget
//     }
// }
