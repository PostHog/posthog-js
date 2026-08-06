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
