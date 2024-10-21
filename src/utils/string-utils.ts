/**
 * Truncate a string to a maximum length and optionally append a suffix only if the string is longer than the maximum length.
 */
export const truncateString = (str: unknown, maxLength: number, suffix?: string): string => {
    if (typeof str !== 'string') {
        return ''
    }

    const trimmedSuffix = suffix?.trim()
    const trimmedStr = str.trim()

    let sliceLength = maxLength
    if (trimmedSuffix?.length) {
        sliceLength -= trimmedSuffix.length
    }
    const sliced = Array.from(trimmedStr).slice(0, sliceLength).join('').trim()
    const addSuffix = trimmedStr.length > maxLength
    return sliced + (addSuffix ? trimmedSuffix || '' : '')
}
