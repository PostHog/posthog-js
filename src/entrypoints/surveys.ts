import { generateSurveys } from '../extensions/surveys'
import { SurveyEventReceiver } from '../extensions/surveys/survey-event-receiver'
import { canActivateRepeatedly, hasEvents } from '../extensions/surveys/surveys-utils'

import { window } from '../utils/globals'

if (window) {
    ;(window as any).__PosthogExtensions__ = (window as any).__Posthog__ || {}
    ;(window as any).extendPostHogWithSurveys = generateSurveys
    ;(window as any).__PosthogExtensions__.SurveysEventReceiver = SurveyEventReceiver
    ;(window as any).__PosthogExtensions__.canActivateRepeatedly = canActivateRepeatedly
    ;(window as any).__PosthogExtensions__.hasEvents = hasEvents
}

export default generateSurveys
