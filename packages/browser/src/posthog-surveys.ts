import { PostHogSurveys as SharedSurveys } from '@posthog/browser-common/surveys'
import { SurveysExtension } from './extension-tokens'
import type { SurveyEventReceiver } from './utils/survey-event-receiver'

export type { SurveyFetchResult } from '@posthog/browser-common/surveys'

/** Legacy branded extension and event-receiver surface. */
export class PostHogSurveys extends SharedSurveys {
    override readonly name = SurveysExtension
    declare _surveyEventReceiver: SurveyEventReceiver | null
}
