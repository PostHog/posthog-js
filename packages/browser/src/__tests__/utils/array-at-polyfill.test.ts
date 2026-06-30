/// <reference lib="dom" />

// Loads the side-effecting polyfill module in a fresh module registry so we can control
// whether Array.prototype.at exists at import time.
function loadPolyfill(): void {
    jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../utils/array-at-polyfill')
    })
}

describe('Array.prototype.at polyfill', () => {
    const nativeAt = Array.prototype.at

    afterEach(() => {
        // restore whatever the environment had to avoid leaking between tests
        if (nativeAt) {
            Object.defineProperty(Array.prototype, 'at', {
                value: nativeAt,
                writable: true,
                enumerable: false,
                configurable: true,
            })
        } else {
            // eslint-disable-next-line no-extend-native
            delete (Array.prototype as any).at
        }
    })

    describe('when Array.prototype.at is missing (old browser)', () => {
        beforeEach(() => {
            // simulate Chrome <92 / iOS Safari <15.4
            // eslint-disable-next-line no-extend-native
            delete (Array.prototype as any).at
            loadPolyfill()
        })

        it('installs a working at()', () => {
            expect(typeof Array.prototype.at).toBe('function')
        })

        it('returns the element at a positive index', () => {
            expect(['a', 'b', 'c'].at(0)).toBe('a')
            expect(['a', 'b', 'c'].at(2)).toBe('c')
        })

        it('returns the element at a negative index (the case web-vitals relies on)', () => {
            expect([1, 2, 3].at(-1)).toBe(3)
            expect([1, 2, 3].at(-3)).toBe(1)
        })

        it('returns undefined for out-of-range indices', () => {
            expect([1, 2, 3].at(3)).toBeUndefined()
            expect([1, 2, 3].at(-4)).toBeUndefined()
            expect([].at(0)).toBeUndefined()
        })

        it('treats a missing/NaN index as 0', () => {
            expect(['x', 'y'].at(undefined as unknown as number)).toBe('x')
            expect(['x', 'y'].at(NaN)).toBe('x')
        })

        it('truncates fractional indices', () => {
            expect(['a', 'b', 'c'].at(1.9)).toBe('b')
            expect(['a', 'b', 'c'].at(-1.9)).toBe('c')
        })

        it('is non-enumerable so it does not leak into for..in', () => {
            const keys: string[] = []
            for (const key in ['a']) {
                keys.push(key)
            }
            expect(keys).not.toContain('at')
        })
    })

    describe('when Array.prototype.at already exists (modern browser)', () => {
        it('does not replace the native implementation', () => {
            const sentinel = function at(): string {
                return 'native'
            }
            Object.defineProperty(Array.prototype, 'at', {
                value: sentinel,
                writable: true,
                enumerable: false,
                configurable: true,
            })

            loadPolyfill()

            expect(Array.prototype.at).toBe(sentinel)
        })
    })
})
