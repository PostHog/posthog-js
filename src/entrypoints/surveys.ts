import { generateSurveys } from '../extensions/surveys'
import { SurveyEventReceiver } from '../extensions/surveys/survey-event-receiver'

import { window } from '../utils/globals'

if (window) {
    ;(window as any).__PosthogExtensions__ = (window as any).__Posthog__ || {}
    ;(window as any).extendPostHogWithSurveys = generateSurveys
    ;(window as any).__PosthogExtensions__.SurveysEventReceiver = SurveyEventReceiver
}

export default generateSurveys
