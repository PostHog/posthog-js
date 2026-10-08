export function getTimezone(): string | undefined {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
        return undefined
    }
}
