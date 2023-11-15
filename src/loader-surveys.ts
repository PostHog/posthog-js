import { generateSurveys } from './extensions/surveys'

import { window } from './utils/globals'

if (window) {
    ;(window as any).extendPostHogWithSurveys = generateSurveys
}

export default generateSurveys
