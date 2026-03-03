import { createLogger } from './logger'

const logger = createLogger('[LanguageUtils]')

/**
 * Normalizes a language code to lowercase for consistent matching
 * @param languageCode - The language code to normalize (e.g., 'FR', 'en-US')
 * @returns Normalized language code (e.g., 'fr', 'en-us')
 */
export function normalizeLanguageCode(languageCode: string): string {
    return languageCode.toLowerCase()
}

/**
 * Extracts the base language from a language variant
 * @param languageCode - The full language code (e.g., 'en-US', 'fr-CA')
 * @returns The base language code (e.g., 'en', 'fr')
 */
export function getBaseLanguage(languageCode: string): string {
    return languageCode.split('-')[0]
}

/**
 * Finds the best matching translation for a given language code
 * Tries: exact match -> base language fallback -> null
 * @param translations - Available translations object
 * @param targetLanguage - The target language code
 * @returns The best matching language key or null
 */
export function findBestTranslationMatch(
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
