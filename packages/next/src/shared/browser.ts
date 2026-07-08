export function getCurrentUrl(path: string): string | undefined {
    if (typeof window === 'undefined') {
        return undefined
    }

    return `${window.location.origin}${path}`
}
