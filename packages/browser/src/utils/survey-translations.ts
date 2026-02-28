import { PostHog } from '../posthog-core'
import { Survey, SurveyQuestion } from '../posthog-surveys-types'
import { STORED_PERSON_PROPERTIES_KEY } from '../constants'
import { createLogger } from './logger'
import { getBrowserLanguage } from './event-utils'
import { findBestTranslationMatch } from './language-utils'

const logger = createLogger('[SurveyTranslations]')

/**
 * Detects the user's language using priority order:
 * 1. config.override_display_language (explicit override)
 * 2. navigator.language (browser language)
 * 3. person properties 'language' (allows programmatic control via posthog.identify())
 *
 * TODO: Consider adding dynamic language change detection in the future:
 * - Listen to 'languagechange' event on window (https://developer.mozilla.org/en-US/docs/Web/API/Window/languagechange_event)
 * - Listen to config changes (once we add config change events to PostHog core)
 * - Re-render survey when language changes mid-session
 *
 * @param instance - PostHog instance to retrieve config and person properties
 * @returns The detected language code (e.g., 'fr', 'es', 'en-US') or null if not found
 */
export function detectUserLanguage(instance: PostHog): string | null {
    const configLanguage = instance.config.override_display_language
    if (configLanguage) {
        logger.info(`Using config.override_display_language: ${configLanguage}`)
        return configLanguage
    }

    const browserLanguage = getBrowserLanguage()
    if (browserLanguage) {
        logger.info(`Using browser language: ${browserLanguage}`)
        return browserLanguage
    }

    const personProperties = instance.get_property(STORED_PERSON_PROPERTIES_KEY) || {}
    const personLanguage = personProperties['language']

    if (typeof personLanguage === 'string' && personLanguage.trim()) {
        logger.info(`Using person property language: ${personLanguage}`)
        return personLanguage.trim()
    }

    logger.info('No user language detected')
    return null
}

/**
 * Merges translated question fields on top of default question fields
 * @param question - The original question object
 * @param targetLanguage - The target language code
 * @returns An object with the translated question and the matched language key
 */
function mergeQuestionTranslation(
    question: SurveyQuestion,
    targetLanguage: string
): { question: SurveyQuestion; matchedKey: string | null } {
    const translationKey = findBestTranslationMatch(question.translations, targetLanguage)
    if (!translationKey) {
        return { question, matchedKey: null }
    }

    const questionTranslation = question.translations?.[translationKey]
    if (!questionTranslation) {
        return { question, matchedKey: null }
    }

    const translated = { ...question }

    if (questionTranslation.question) {
        translated.question = questionTranslation.question
    }
    if (questionTranslation.description !== undefined) {
        translated.description = questionTranslation.description
    }
    if (questionTranslation.buttonText) {
        translated.buttonText = questionTranslation.buttonText
    }

    if ('link' in question && questionTranslation.link !== undefined) {
        ;(translated as any).link = questionTranslation.link
    }

    if ('lowerBoundLabel' in question && questionTranslation.lowerBoundLabel) {
        ;(translated as any).lowerBoundLabel = questionTranslation.lowerBoundLabel
    }
    if ('upperBoundLabel' in question && questionTranslation.upperBoundLabel) {
        ;(translated as any).upperBoundLabel = questionTranslation.upperBoundLabel
    }

    if ('choices' in question && questionTranslation.choices && Array.isArray(questionTranslation.choices)) {
        ;(translated as any).choices = questionTranslation.choices
    }

    return { question: translated, matchedKey: translationKey }
}

/**
 * Applies translations to a survey based on the target language
 * @param survey - The original survey object
 * @param targetLanguage - The target language code
 * @returns An object with the translated survey and the matched language key (or null if no match)
 */
export function applySurveyTranslation(
    survey: Survey,
    targetLanguage: string
): { survey: Survey; matchedKey: string | null } {
    const translationKey = findBestTranslationMatch(survey.translations, targetLanguage)

    const translated = { ...survey }
    let hasTranslation = false

    if (translationKey) {
        const translation = survey.translations?.[translationKey]
        if (translation) {
            logger.info(`Applying survey-level translation for language: ${translationKey}`)
            hasTranslation = true

            if (translation.name) {
                translated.name = translation.name
            }
            if (translation.description) {
                translated.description = translation.description
            }

            if (translated.appearance) {
                translated.appearance = { ...translated.appearance }

                if (translation.thankYouMessageHeader) {
                    translated.appearance.thankYouMessageHeader = translation.thankYouMessageHeader
                }
                if (translation.thankYouMessageDescription) {
                    translated.appearance.thankYouMessageDescription = translation.thankYouMessageDescription
                }
                if (translation.thankYouMessageCloseButtonText) {
                    translated.appearance.thankYouMessageCloseButtonText = translation.thankYouMessageCloseButtonText
                }
            }
        }
    }

    // Always try to apply question-level translations (each question has its own translations field)
    const translatedResults = survey.questions.map((question) => mergeQuestionTranslation(question, targetLanguage))
    const translatedQuestions = translatedResults.map((r) => r.question)
    const anyQuestionTranslated = translatedQuestions.some((q, i) => q !== survey.questions[i])

    // Track the first matched key from question translations if we don't have a survey-level match
    let questionMatchedKey: string | null = null
    if (!translationKey) {
        const firstMatch = translatedResults.find((r) => r.matchedKey)
        questionMatchedKey = firstMatch?.matchedKey || null
    }

    if (anyQuestionTranslated) {
        translated.questions = translatedQuestions
        hasTranslation = true
        logger.info(`Applied question-level translations for language: ${targetLanguage}`)
    }

    return {
        survey: translated,
        matchedKey: hasTranslation ? translationKey || questionMatchedKey : null,
    }
}

/**
 * Applies translations to a survey based on the user's language from person properties
 * @param survey - The original survey object
 * @param instance - PostHog instance to retrieve person properties
 * @returns An object containing the translated survey and the language used (or null if no translation applied)
 */
export function applySurveyTranslationForUser(
    survey: Survey,
    instance: PostHog
): { survey: Survey; language: string | null } {
    const userLanguage = detectUserLanguage(instance)

    if (!userLanguage) {
        logger.info('No user language detected from person properties')
        return { survey, language: null }
    }

    const result = applySurveyTranslation(survey, userLanguage)

    return {
        survey: result.survey,
        language: result.matchedKey,
    }
}
