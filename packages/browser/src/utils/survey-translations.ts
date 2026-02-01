import { PostHog } from '../posthog-core'
import { Survey, SurveyQuestion } from '../posthog-surveys-types'
import { STORED_PERSON_PROPERTIES_KEY } from '../constants'
import { createLogger } from './logger'

const logger = createLogger('[SurveyTranslations]')

/**
 * Detects the user's language from person properties
 * @param instance - PostHog instance to retrieve person properties
 * @returns The detected language code (e.g., 'fr', 'es', 'en-US') or null if not found
 */
export function detectUserLanguage(instance: PostHog): string | null {
    const personProperties = instance.get_property(STORED_PERSON_PROPERTIES_KEY) || {}
    const language = personProperties['language']

    if (typeof language === 'string' && language.trim()) {
        return language.trim()
    }

    return null
}

/**
 * Normalizes a language code to lowercase for consistent matching
 * @param languageCode - The language code to normalize (e.g., 'FR', 'en-US')
 * @returns Normalized language code (e.g., 'fr', 'en-us')
 */
function normalizeLanguageCode(languageCode: string): string {
    return languageCode.toLowerCase()
}

/**
 * Extracts the base language from a language variant
 * @param languageCode - The full language code (e.g., 'en-US', 'fr-CA')
 * @returns The base language code (e.g., 'en', 'fr')
 */
function getBaseLanguage(languageCode: string): string {
    return languageCode.split('-')[0]
}

/**
 * Finds the best matching translation for a given language code
 * Tries: exact match -> base language fallback -> null
 * @param translations - Available translations object
 * @param targetLanguage - The target language code
 * @returns The best matching language key or null
 */
function findBestTranslationMatch(
    translations: Record<string, any> | undefined,
    targetLanguage: string
): string | null {
    if (!translations || !targetLanguage) {
        return null
    }

    const normalizedTarget = normalizeLanguageCode(targetLanguage)

    // Try exact match first (case-insensitive)
    const exactMatch = Object.keys(translations).find((key) => normalizeLanguageCode(key) === normalizedTarget)
    if (exactMatch) {
        logger.info(`Found exact translation match: ${exactMatch}`)
        return exactMatch
    }

    // Try base language fallback (e.g., fr-CA -> fr)
    if (normalizedTarget.includes('-')) {
        const baseLanguage = getBaseLanguage(normalizedTarget)
        const baseMatch = Object.keys(translations).find((key) => normalizeLanguageCode(key) === baseLanguage)
        if (baseMatch) {
            logger.info(`Found base language translation match: ${baseMatch} (from ${targetLanguage})`)
            return baseMatch
        }
    }

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
