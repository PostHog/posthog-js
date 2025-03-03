export function includes<T = any>(str: T[] | string, needle: T): boolean {
    return (str as any).indexOf(needle) !== -1
}

// UNDERSCORE
// Embed part of the Underscore Library
export const trim = function (str: string): string {
    return str.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '')
}
export const stripLeadingDollar = function (s: string): string {
    return s.replace(/^\$/, '')
}

export function isDistinctIdStringLike(value: string): boolean {
    return ['distinct_id', 'distinctid'].includes(value.toLowerCase())
}
