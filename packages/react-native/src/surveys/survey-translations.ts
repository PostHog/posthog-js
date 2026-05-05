import { createLogger, Logger, PostHogPersistedProperty, Survey } from '@posthog/core'
import { applySurveyTranslation, detectSurveyLanguage } from '@posthog/core/surveys'
import { PostHog } from '../posthog-rn'

const logger = createLogger('[SurveyTranslations]')

function getLogger(instance: PostHog): Logger | undefined {
  return instance.isDebug ? logger : undefined
}

export function detectUserLanguage(instance: PostHog): string | null {
  return detectSurveyLanguage(
    {
      overrideLanguage: instance.getSurveyDisplayLanguageOverride(),
      storedPersonProperties: instance.getPersistedProperty(PostHogPersistedProperty.PersonProperties),
      locale: instance.getCommonEventProperties().$locale,
    },
    getLogger(instance)
  )
}

export function applySurveyTranslationForUser(
  survey: Survey,
  instance: PostHog
): { survey: Survey; language: string | null } {
  const userLanguage = detectUserLanguage(instance)
  const logger = getLogger(instance)

  if (!userLanguage) {
    logger?.info('No user language detected')
    return { survey, language: null }
  }

  const result = applySurveyTranslation(survey, userLanguage, logger)

  return {
    survey: result.survey,
    language: result.matchedKey,
  }
}
