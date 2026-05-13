export function getCurrentUrl(): string | undefined {
    if (typeof window === 'undefined' || !window.location.href) {
        return undefined
    }

    return window.location.href
}
