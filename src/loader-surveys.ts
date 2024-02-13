import { generateSurveys } from './extensions/surveys'

import { window } from './utils/globals'
export { renderSurveysPreview } from './extensions/surveys'

if (window) {
    ;(window as any).extendPostHogWithSurveys = generateSurveys
}

export default generateSurveys
