import { isNullish } from '@posthog/core'
import { isMatchingRegex } from '@posthog/core/surveys'

export function extractHref(elementsChain: string): string {
    const match = elementsChain.match(/(?::|")href="(.*?)"/)
    return match ? match[1]! : ''
}

export function extractTexts(elementsChain: string): string[] {
    const texts: string[] = []
    const regex = /(?::|")text="(.*?)"/g
    let match: RegExpExecArray | null
    while (!isNullish((match = regex.exec(elementsChain)))) {
        if (!texts.includes(match[1]!)) {
            texts.push(match[1]!)
        }
    }
    return texts
}

export function matchString(
    value: string | undefined | null,
    pattern: string,
    matching: 'exact' | 'contains' | 'regex'
): boolean {
    if (isNullish(value)) return false
    switch (matching) {
        case 'exact':
            return value === pattern
        case 'contains': {
            // Simulating SQL LIKE behavior (_ = any single character, % = any zero or more characters)
            const likePattern = pattern
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/_/g, '.')
                .replace(/%/g, '.*')
            return new RegExp(likePattern, 'i').test(value)
        }
        case 'regex':
            return isMatchingRegex(value, pattern)
        default:
            return false
    }
}

export function matchTexts(texts: string[], pattern: string, matching: 'exact' | 'contains' | 'regex'): boolean {
    return texts.some((text) => matchString(text, pattern, matching))
}
