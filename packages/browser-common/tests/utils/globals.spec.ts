import { clearTimeout, setTimeout } from '../../src/utils/globals'

describe('globals timers', () => {
    const withoutTimers = (fn: () => void) => {
        const timers = ['setTimeout', 'clearTimeout'].map((name) => ({
            name,
            descriptor: Object.getOwnPropertyDescriptor(globalThis, name)!,
        }))
        timers.forEach(({ name }) =>
            Object.defineProperty(globalThis, name, { value: undefined, configurable: true, writable: true })
        )
        try {
            fn()
        } finally {
            timers.forEach(({ name, descriptor }) => Object.defineProperty(globalThis, name, descriptor))
        }
    }

    it('schedules a callback when the realm has timers', () => {
        vi.useFakeTimers()
        try {
            const callback = vi.fn()
            const id = setTimeout(callback, 10)
            expect(id).toBeDefined()

            vi.advanceTimersByTime(10)
            expect(callback).toHaveBeenCalledTimes(1)
        } finally {
            vi.useRealTimers()
        }
    })

    it('cancels a scheduled callback', () => {
        vi.useFakeTimers()
        try {
            const callback = vi.fn()
            clearTimeout(setTimeout(callback, 10))

            vi.advanceTimersByTime(10)
            expect(callback).not.toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
    })

    it('returns undefined instead of throwing when the realm has no timers', () => {
        withoutTimers(() => {
            const callback = vi.fn()
            expect(setTimeout(callback, 10)).toBeUndefined()
            expect(callback).not.toHaveBeenCalled()
        })
    })

    it('does not throw when clearing without timers', () => {
        withoutTimers(() => {
            expect(() => clearTimeout(1 as any)).not.toThrow()
            expect(() => clearTimeout(undefined)).not.toThrow()
        })
    })
})
