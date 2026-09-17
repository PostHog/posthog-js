import * as shared from '@posthog/browser-common/surveys/survey-translations'
import type { PostHog } from '../posthog-core'
import type { Survey } from '../posthog-surveys-types'
import { createSurveysRuntimeHost } from './surveys-runtime-host'
export const detectUserLanguage = (instance: PostHog) => shared.detectUserLanguage(createSurveysRuntimeHost(instance))
export const applySurveyTranslationForUser = (survey: Survey, instance: PostHog) =>
    shared.applySurveyTranslationForUser(survey, createSurveysRuntimeHost(instance))
