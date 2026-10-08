import {
    isStatusZeroFailureCircuitBreakerTripped,
    updateStatusZeroFailureCount,
} from '../../src/utils/request-reachability'

afterEach(() => vi.unstubAllGlobals())

describe('request reachability', () => {
    it('trips at the online failure budget and resets on an HTTP response', () => {
        vi.stubGlobal('window', { navigator: { onLine: true } })
        const tripped = vi.fn()
        expect(updateStatusZeroFailureCount(0, 2, 3, tripped)).toBe(3)
        expect(tripped).toHaveBeenCalledOnce()
        expect(isStatusZeroFailureCircuitBreakerTripped(3, 3)).toBe(true)
        expect(updateStatusZeroFailureCount(200, 3, 3, tripped)).toBe(0)
    })

    it('does not spend the reachability budget offline or without a browser', () => {
        const tripped = vi.fn()
        for (const value of [{ navigator: { onLine: false } }, undefined]) {
            vi.stubGlobal('window', value)
            expect(updateStatusZeroFailureCount(0, 2, 3, tripped)).toBe(2)
            expect(isStatusZeroFailureCircuitBreakerTripped(3, 3)).toBe(false)
        }
        expect(tripped).not.toHaveBeenCalled()
    })
})
