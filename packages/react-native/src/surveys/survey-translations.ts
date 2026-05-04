import { createLogger, PostHogPersistedProperty, Survey } from '@posthog/core'
import { applySurveyTranslation, detectSurveyLanguage } from '@posthog/core/surveys'
import { PostHog } from '../posthog-rn'

let isDebugEnabled = false
const logger = createLogger('[SurveyTranslations]', (fn) => {
  if (isDebugEnabled) {
    fn()
  }
})

function syncLoggerDebugState(instance: PostHog): void {
  isDebugEnabled = instance.isDebug
}

export function detectUserLanguage(instance: PostHog): string | null {
  syncLoggerDebugState(instance)

  return detectSurveyLanguage(
    {
      overrideLanguage: instance.getSurveyDisplayLanguageOverride(),
      storedPersonProperties: instance.getPersistedProperty(PostHogPersistedProperty.PersonProperties),
      locale: instance.getCommonEventProperties().$locale,
    },
    logger
  )
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

  const result = applySurveyTranslation(survey, userLanguage, logger)

  return {
    survey: result.survey,
    language: result.matchedKey,
  }
}
