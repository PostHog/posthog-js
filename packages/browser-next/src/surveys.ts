import { generateSurveys } from '@posthog/browser-common/surveys-renderer'
import { createSurveys } from './surveys-extension'
import type { SurveysOptions } from './surveys-options'
import type { Extension } from '@posthog/browser-common'

/** Statically include survey orchestration and rendering, avoiding runtime module loading. */
export const surveys = (options: SurveysOptions = {}): Extension =>
    createSurveys(options, async () => ({ generateSurveys }))
export type {
    SurveysOptions,
    Survey,
    SurveyCallback,
    DisplaySurveyOptions,
    SurveyRenderReason,
} from './surveys-options'
export { DisplaySurveyType } from '@posthog/browser-common/surveys'
