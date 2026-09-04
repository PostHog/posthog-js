/// <reference lib="dom" />

// Loads the side-effecting polyfill module in a fresh module registry so we can control
// whether Array.prototype.findLast exists at import time.
function loadPolyfill(): void {
    jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@posthog/browser-common/utils/array-find-last-polyfill')
    })
}

describe('Array.prototype.findLast polyfill', () => {
    const nativeFindLast = Array.prototype.findLast

    afterEach(() => {
        // restore whatever the environment had to avoid leaking between tests
        if (nativeFindLast) {
            Object.defineProperty(Array.prototype, 'findLast', {
                value: nativeFindLast,
                writable: true,
                enumerable: false,
                configurable: true,
            })
        } else {
            delete (Array.prototype as any).findLast
        }
    })

    describe('when Array.prototype.findLast is missing (old browser)', () => {
        beforeEach(() => {
            // simulate Chrome <97 / iOS Safari <15.4

            delete (Array.prototype as any).findLast
            loadPolyfill()
        })

        it('installs a working findLast()', () => {
            expect(typeof Array.prototype.findLast).toBe('function')
        })

        it('returns the last match, not the first (the case web-vitals relies on)', () => {
            const entries = [
                { name: 'a.png', id: 1 },
                { name: 'b.png', id: 2 },
                { name: 'a.png', id: 3 },
            ]
            expect(entries.findLast((e) => e.name === 'a.png')).toBe(entries[2])
        })

        it('returns undefined when nothing matches', () => {
            expect([1, 2, 3].findLast((n) => n > 10)).toBeUndefined()
            expect([].findLast(() => true)).toBeUndefined()
        })

        it('passes value, index and array to the predicate', () => {
            const array = ['a', 'b']
            const calls: [string, number, string[]][] = []
            array.findLast((value, index, arr) => {
                calls.push([value, index, arr])
                return false
            })
            expect(calls).toEqual([
                ['b', 1, array],
                ['a', 0, array],
            ])
        })

        it('honours thisArg', () => {
            const thisArg = { wanted: 2 }
            const found = [1, 2, 3].findLast(function (this: typeof thisArg, n) {
                return n === this.wanted
            }, thisArg)
            expect(found).toBe(2)
        })

        it('stops at the first match walking backwards', () => {
            const seen: number[] = []
            const found = [1, 2, 3, 4].findLast((n) => {
                seen.push(n)
                return n === 3
            })
            expect(found).toBe(3)
            expect(seen).toEqual([4, 3])
        })

        it('is non-enumerable so it does not leak into for..in', () => {
            const keys: string[] = []
            for (const key in ['a']) {
                keys.push(key)
            }
            expect(keys).not.toContain('findLast')
        })
    })

    describe('when Array.prototype.findLast already exists (modern browser)', () => {
        it('does not replace the native implementation', () => {
            const sentinel = function findLast(): string {
                return 'native'
            }
            Object.defineProperty(Array.prototype, 'findLast', {
                value: sentinel,
                writable: true,
                enumerable: false,
                configurable: true,
            })

            loadPolyfill()

            expect(Array.prototype.findLast).toBe(sentinel)
        })
    })
})
