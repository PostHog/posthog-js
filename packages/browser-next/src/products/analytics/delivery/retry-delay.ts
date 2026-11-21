export const safeNow = (now: () => number): number => {
    try {
        const value = now()
        return Number.isFinite(value) ? value : 0
    } catch {
        return 0
    }
}

export const parseRetryAfter = (response: Response | undefined, now: () => number): number | undefined => {
    try {
        const raw = response?.headers.get('Retry-After')?.trim()
        if (!raw) {
            return undefined
        }
        if (/^\d+$/.test(raw)) {
            const milliseconds = Number(raw) * 1_000
            return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : undefined
        }
        const delay = Date.parse(raw) - safeNow(now)
        return delay > 0 ? delay : undefined
    } catch {
        return undefined
    }
}

export const retryDelay = (
    attempt: number,
    initialDelayMs: number,
    maxBackoffMs: number,
    random: () => number,
    retryAfterMs?: number
): number => {
    const exponential = Math.min(initialDelayMs * 2 ** (attempt - 1), maxBackoffMs)
    let randomValue = 0.5
    try {
        const candidate = random()
        if (Number.isFinite(candidate)) {
            randomValue = Math.max(0, Math.min(1, candidate))
        }
    } catch {
        // The midpoint gives an unjittered delay when randomness is unavailable.
    }
    const jittered = Math.min(maxBackoffMs, Math.ceil(exponential * (0.5 + randomValue)))
    return retryAfterMs === undefined ? jittered : Math.max(jittered, Math.min(retryAfterMs, maxBackoffMs))
}
