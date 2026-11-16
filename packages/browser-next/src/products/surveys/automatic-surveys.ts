import { createSurveys } from './surveys-extension'
import type { SurveysOptions } from './surveys-options'

export const surveys = (options: SurveysOptions = {}) =>
    createSurveys(options, () => import('@posthog/browser-common/surveys-renderer'))
