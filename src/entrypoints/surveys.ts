import { generateSurveys } from '../extensions/surveys'

import { assignableWindow } from '../utils/globals'
import { canActivateRepeatedly } from '../extensions/surveys/surveys-utils'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.canActivateRepeatedly = canActivateRepeatedly
assignableWindow.__PosthogExtensions__.generateSurveys = generateSurveys

// this used to be directly on window, but we moved it to __PosthogExtensions__
// it is still on window for backwards compatibility
assignableWindow.extendPostHogWithSurveys = generateSurveys

export default generateSurveys
