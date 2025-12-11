export const isValidRegex = function (str: string): boolean {
    try {
        new RegExp(str)
    } catch {
        return false
    }
    return true
}

export const isMatchingRegex = function (value: string, pattern: string): boolean {
    if (!isValidRegex(pattern)) return false

    try {
        return new RegExp(pattern).test(value)
    } catch {
        return false
    }
}

/**
 * Wraps a regex pattern with ^ and $ anchors so it only matches the entire string.
 * @param {RegExp} pattern - The regex pattern to anchor
 * @returns {RegExp} A new regex that matches only if the entire string matches the pattern
 */
export const toExactMatch = function (pattern: RegExp): RegExp {
    return new RegExp(`^(?:${pattern.source})$`, pattern.flags)
}
