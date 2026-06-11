import { generateSurveys } from '../extensions/surveys'

import { assignableWindow } from '../utils/globals'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.generateSurveys = generateSurveys

export default generateSurveys
