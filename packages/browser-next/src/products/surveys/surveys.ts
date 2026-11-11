import { createSurveys } from './surveys-extension'
import type { SurveysOptions } from './surveys-options'
import type { SurveysExtension } from './surveys-internal'
export type { SurveysExtension } from './surveys-internal'

export const surveys = (options: SurveysOptions = {}): SurveysExtension =>
    createSurveys(options, () => import('@posthog/browser-common/surveys-renderer'))
export type {
    SurveysOptions,
    Survey,
    SurveyCallback,
    DisplaySurveyOptions,
    SurveyRenderReason,
} from './surveys-options'
export { DisplaySurveyType } from '@posthog/browser-common/surveys'
