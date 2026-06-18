import { isNullish } from '@posthog/core'

export function extractHref(elementsChain: string): string {
    const match = elementsChain.match(/(?::|")href="(.*?)"/)
    return match ? match[1] : ''
}

export function extractTexts(elementsChain: string): string[] {
    const texts: string[] = []
    const regex = /(?::|")text="(.*?)"/g
    let match
    while (!isNullish((match = regex.exec(elementsChain)))) {
        if (!texts.includes(match[1])) {
            texts.push(match[1])
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
            try {
                return new RegExp(pattern).test(value)
            } catch {
                return false
            }
        default:
            return false
    }
}

export function matchTexts(texts: string[], pattern: string, matching: 'exact' | 'contains' | 'regex'): boolean {
    return texts.some((text) => matchString(text, pattern, matching))
}
