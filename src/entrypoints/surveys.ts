import { generateSurveys } from '../extensions/surveys'

import { assignableWindow } from '../utils/globals'
import { canActivateRepeatedly } from '../extensions/surveys/surveys-utils'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.canActivateRepeatedly = canActivateRepeatedly
assignableWindow.extendPostHogWithSurveys = generateSurveys

export default generateSurveys
