import { generateSurveys } from '../extensions/surveys'

import { window } from '../utils/globals'
import { canActivateRepeatedly } from '../extensions/surveys/surveys-utils'

if (window) {
    ;(window as any).__PosthogExtensions__ = (window as any).__PosthogExtensions__ || {}
    ;(window as any).__PosthogExtensions__.canActivateRepeatedly = canActivateRepeatedly
    ;(window as any).extendPostHogWithSurveys = generateSurveys
}

export default generateSurveys
