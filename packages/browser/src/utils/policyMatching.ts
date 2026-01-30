import { SDKPolicyConfigUrlTrigger } from '../types'
import { logger } from './logger'

/**
 * Checks if a URL matches any of the provided URL triggers.
 * Used by both session replay and error tracking for URL-based policy matching.
 *
 * @param url - The URL to check
 * @param triggers - Array of URL trigger configurations
 * @param compiledRegexCache - Optional pre-compiled regex cache for performance
 * @returns true if the URL matches any trigger
 */
export function urlMatchesTriggers(
    url: string,
    triggers: SDKPolicyConfigUrlTrigger[],
    compiledRegexCache?: Map<string, RegExp>
): boolean {
    return triggers.some((trigger) => {
        switch (trigger.matching) {
            case 'regex': {
                const regex = compiledRegexCache?.get(trigger.url) ?? new RegExp(trigger.url)
                return regex.test(url)
            }
            default:
                return false
        }
    })
}

/**
 * Compiles regex patterns from URL triggers into a cache for performance.
 * This prevents recreating RegExp objects on every check.
 *
 * @param triggers - Array of URL trigger configurations
 * @param logPrefix - Optional prefix for error logging
 * @returns Map of pattern string to compiled RegExp
 */
export function compileRegexCache(
    triggers: SDKPolicyConfigUrlTrigger[],
    logPrefix?: string
): Map<string, RegExp> {
    const cache = new Map<string, RegExp>()

    for (const trigger of triggers) {
        if (trigger.matching === 'regex' && !cache.has(trigger.url)) {
            try {
                cache.set(trigger.url, new RegExp(trigger.url))
            } catch (e) {
                logger.error(`${logPrefix ? logPrefix + ' ' : ''}Invalid regex pattern:`, trigger.url, e)
            }
        }
    }

    return cache
}
