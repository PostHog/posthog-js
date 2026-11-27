let fallbackSequence = 0

export const createId = (): string => {
    try {
        const crypto = globalThis.crypto
        if (crypto?.randomUUID) {
            return crypto.randomUUID()
        }
        if (crypto?.getRandomValues) {
            const bytes = crypto.getRandomValues(new Uint8Array(16))
            bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
            bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
            const hex = bytes.reduce((value, byte) => value + byte.toString(16).padStart(2, '0'), '')
            return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
        }
    } catch {
        // Fall back to Math.random when the browser blocks crypto access.
    }

    let seed = Date.now() + fallbackSequence++
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
        let random = seed++ & 15
        try {
            random = Math.floor(Math.random() * 16)
        } catch {
            // The timestamp seed keeps the no-throw fallback usable.
        }
        return (character === 'x' ? random : (random & 3) | 8).toString(16)
    })
}

/**
 * A UUIDv7 that encodes `timestamp`, for session and window IDs, which PostHog sessions and posthog-js require to be
 * v7. A local primitive, because the shared generator imports `@posthog/core` and reads its own clock.
 */
export const createTimeId = (timestamp: number): string => {
    const time = Number.isFinite(timestamp) ? Math.min(Math.max(Math.floor(timestamp), 0), 0xffff_ffff_ffff) : 0
    const hex = time.toString(16).padStart(12, '0')
    // The v4 ID supplies the random bits and the RFC 4122 variant; only the version changes.
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${createId().slice(15)}`
}
