import { generateSurveys } from './extensions/surveys'

import { window } from './utils/globals'
export { renderSurveysPreview, renderFeedbackWidgetPreview } from './extensions/surveys'

if (window) {
    ;(window as any).extendPostHogWithSurveys = generateSurveys
}

export default generateSurveys
