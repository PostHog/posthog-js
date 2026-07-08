import { patch } from '../../../../extensions/replay/rrweb-plugins/patch'

const fakeWindow = {
    fakeFetch: () => {},
}

// JS-DOM doesn't have fetch and its fake XHR doesn't work with our patch,
// so we can't test them directly
describe('patch', () => {
    const originalFakeFetch = fakeWindow.fakeFetch

    afterEach(() => {
        fakeWindow.fakeFetch = originalFakeFetch
    })

    it('marks a function as wrapped', () => {
        patch(fakeWindow, 'fakeFetch', () => () => {})
        // eslint-disable-next-line compat/compat
        expect((fakeWindow.fakeFetch as any).__posthog_wrapped__).toBe(true)
    })

    it('restores in LIFO order', () => {
        const original = fakeWindow.fakeFetch
        const firstRestore = patch(fakeWindow, 'fakeFetch', (firstOriginal) => {
            return function firstWrapper() {
                return firstOriginal()
            }
        })
        const firstWrapper = fakeWindow.fakeFetch
        const secondRestore = patch(fakeWindow, 'fakeFetch', (secondOriginal) => {
            return function secondWrapper() {
                return secondOriginal()
            }
        })

        secondRestore()
        expect(fakeWindow.fakeFetch).toBe(firstWrapper)

        firstRestore()
        expect(fakeWindow.fakeFetch).toBe(original)
    })

    it('tears down a buried wrapper without clobbering newer wrappers', () => {
        const original = fakeWindow.fakeFetch
        const firstRestore = patch(fakeWindow, 'fakeFetch', (firstOriginal) => {
            return function firstWrapper() {
                return firstOriginal()
            }
        })
        const secondRestore = patch(fakeWindow, 'fakeFetch', (secondOriginal) => {
            return function secondWrapper() {
                return secondOriginal()
            }
        })
        const secondWrapper = fakeWindow.fakeFetch

        // Restore the older patch first (out of order). The newer wrapper must remain
        // installed on top, and the older wrapper must actually be removed from the chain.
        firstRestore()
        expect(fakeWindow.fakeFetch).toBe(secondWrapper)

        // Removing the last remaining wrapper returns straight to the original, proving the
        // older wrapper was genuinely spliced out rather than left leaking underneath.
        secondRestore()
        expect(fakeWindow.fakeFetch).toBe(original)
    })

    it('does not grow the wrapper chain when independent layers are re-patched out of order', () => {
        // Reproduces the "Maximum call stack size exceeded" defect: two independent
        // extensions (A and B) each repeatedly wrap + restore window.fetch. Their
        // restores run out of order relative to each other, so before this fix each
        // cycle leaked a wrapper and the chain grew without bound.
        const base = jest.fn()
        fakeWindow.fakeFetch = base

        // Counts how many wrapper frames a single call walks through.
        let framesPerCall = 0
        const makeWrapper = (next: any) =>
            function wrapper(this: unknown) {
                framesPerCall += 1
                // eslint-disable-next-line prefer-rest-params
                return next.apply(this, arguments)
            }

        let restoreA = patch(fakeWindow, 'fakeFetch', makeWrapper)
        let restoreB = patch(fakeWindow, 'fakeFetch', makeWrapper)

        for (let i = 0; i < 100; i++) {
            restoreA()
            restoreA = patch(fakeWindow, 'fakeFetch', makeWrapper)
            restoreB()
            restoreB = patch(fakeWindow, 'fakeFetch', makeWrapper)
        }

        framesPerCall = 0
        ;(fakeWindow.fakeFetch as any)()

        // Only the two currently-installed wrappers should run — not hundreds of leaked ones.
        expect(framesPerCall).toBe(2)
        expect(base).toHaveBeenCalledTimes(1)

        restoreA()
        restoreB()
        expect(fakeWindow.fakeFetch).toBe(base)
    })
})
