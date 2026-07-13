/**
 * @vitest-environment jsdom
 */
import { patch } from '@posthog/rrweb-utils'

// The shared patch() helper wraps globals such as Element.prototype.attachShadow.
// These tests pin down that out-of-order teardown splices wrappers out of the
// chain instead of leaking them, which is what caused the recorded
// "RangeError: Maximum call stack size exceeded".
describe('patch', () => {
    let source: { fakeMethod: (...args: unknown[]) => unknown }
    let original: (...args: unknown[]) => unknown

    beforeEach(() => {
        original = () => 'original'
        source = { fakeMethod: original }
    })

    it('marks a function as wrapped with the original reference', () => {
        patch(source, 'fakeMethod', () => () => {})
        expect((source.fakeMethod as any).__rrweb_original__).toBe(original)
    })

    it('restores in LIFO order', () => {
        const firstRestore = patch(source, 'fakeMethod', (firstOriginal) => {
            return function firstWrapper() {
                return (firstOriginal as () => unknown)()
            }
        })
        const firstWrapper = source.fakeMethod
        const secondRestore = patch(source, 'fakeMethod', (secondOriginal) => {
            return function secondWrapper() {
                return (secondOriginal as () => unknown)()
            }
        })

        secondRestore()
        expect(source.fakeMethod).toBe(firstWrapper)

        firstRestore()
        expect(source.fakeMethod).toBe(original)
    })

    it('tears down a buried wrapper without clobbering newer wrappers', () => {
        const firstRestore = patch(source, 'fakeMethod', (firstOriginal) => {
            return function firstWrapper() {
                return (firstOriginal as () => unknown)()
            }
        })
        const secondRestore = patch(source, 'fakeMethod', (secondOriginal) => {
            return function secondWrapper() {
                return (secondOriginal as () => unknown)()
            }
        })
        const secondWrapper = source.fakeMethod

        // Restore the older patch first (out of order). The newer wrapper must remain
        // installed on top, and the older wrapper must actually be removed from the chain.
        firstRestore()
        expect(source.fakeMethod).toBe(secondWrapper)

        // Removing the last remaining wrapper returns straight to the original, proving the
        // older wrapper was genuinely spliced out rather than left leaking underneath.
        secondRestore()
        expect(source.fakeMethod).toBe(original)
    })

    it('does not grow the wrapper chain when independent layers are re-patched out of order', () => {
        // Reproduces the "Maximum call stack size exceeded" defect: two independent
        // recorder layers (A and B) each repeatedly wrap + restore the same global.
        // Their restores run out of order relative to each other, so before this fix
        // each cycle leaked a wrapper and the chain grew without bound.
        const base = vi.fn()
        source.fakeMethod = base

        // Counts how many wrapper frames a single call walks through.
        let framesPerCall = 0
        const makeWrapper = (next: any) =>
            function wrapper(this: unknown, ...args: unknown[]) {
                framesPerCall += 1
                return (next as (...args: unknown[]) => unknown).apply(this, args)
            }

        let restoreA = patch(source, 'fakeMethod', makeWrapper)
        let restoreB = patch(source, 'fakeMethod', makeWrapper)

        for (let i = 0; i < 100; i++) {
            restoreA()
            restoreA = patch(source, 'fakeMethod', makeWrapper)
            restoreB()
            restoreB = patch(source, 'fakeMethod', makeWrapper)
        }

        framesPerCall = 0
        ;(source.fakeMethod as () => unknown)()

        // Only the two currently-installed wrappers should run — not hundreds of leaked ones.
        expect(framesPerCall).toBe(2)
        expect(base).toHaveBeenCalledTimes(1)

        restoreA()
        restoreB()
        expect(source.fakeMethod).toBe(base)
    })
})
