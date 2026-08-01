const randomByte = (): number => {
    try {
        const crypto = globalThis.crypto
        if (crypto?.getRandomValues) {
            return crypto.getRandomValues(new Uint8Array(1))[0] ?? 0
        }
    } catch {
        // Fall back to Math.random when the browser blocks crypto access.
    }

    return Math.floor(Math.random() * 256)
}

export const createId = (): string => {
    try {
        if (globalThis.crypto?.randomUUID) {
            return globalThis.crypto.randomUUID()
        }
    } catch {
        // Build a UUID below when the browser blocks crypto access.
    }

    const bytes = Array.from({ length: 16 }, randomByte)
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
    const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0'))

    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex
        .slice(8, 10)
        .join('')}-${hex.slice(10).join('')}`
}
