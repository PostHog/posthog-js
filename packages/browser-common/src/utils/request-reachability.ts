const isBrowserOnline = (): boolean => {
    try {
        return typeof window !== 'undefined' && window.navigator.onLine !== false
    } catch {
        return false
    }
}

export const isStatusZeroFailureCircuitBreakerTripped = (
    consecutiveStatusZeroFailures: number,
    maxConsecutiveStatusZeroFailures: number
): boolean => {
    return consecutiveStatusZeroFailures >= maxConsecutiveStatusZeroFailures && isBrowserOnline()
}

export const updateStatusZeroFailureCount = (
    statusCode: number,
    consecutiveStatusZeroFailures: number,
    maxConsecutiveStatusZeroFailures: number,
    onCircuitBreakerTripped: () => void
): number => {
    if (statusCode === 0) {
        if (isBrowserOnline()) {
            const updatedConsecutiveStatusZeroFailures = consecutiveStatusZeroFailures + 1
            if (updatedConsecutiveStatusZeroFailures === maxConsecutiveStatusZeroFailures) {
                onCircuitBreakerTripped()
            }
            return updatedConsecutiveStatusZeroFailures
        }
        return consecutiveStatusZeroFailures
    }

    return 0
}
