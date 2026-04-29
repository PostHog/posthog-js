import { createLogger, PostHogPersistedProperty, Survey } from '@posthog/core'
import { applySurveyTranslation, detectSurveyLanguage } from '@posthog/core/surveys'
import { PostHog } from '../posthog-rn'

const logger = createLogger('[SurveyTranslations]')

export function detectUserLanguage(instance: PostHog): string | null {
  return detectSurveyLanguage({
    overrideLanguage: instance.getSurveyDisplayLanguageOverride(),
    storedPersonProperties: instance.getPersistedProperty(PostHogPersistedProperty.PersonProperties),
    locale: instance.getCommonEventProperties().$locale,
  })
}

export function applySurveyTranslationForUser(
  survey: Survey,
  instance: PostHog
): { survey: Survey; language: string | null } {
  const userLanguage = detectUserLanguage(instance)

  if (!userLanguage) {
    logger.info('No user language detected')
    return { survey, language: null }
  }

  const result = applySurveyTranslation(survey, userLanguage)

  return {
    survey: result.survey,
    language: result.matchedKey,
  }
}
