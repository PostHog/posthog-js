import { UrlTrigger } from '../types'
import { logger } from './logger'

export function urlMatchesTriggers(
    url: string,
    triggers: UrlTrigger[],
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

export function compileRegexCache(triggers: UrlTrigger[], logPrefix?: string): Map<string, RegExp> {
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
