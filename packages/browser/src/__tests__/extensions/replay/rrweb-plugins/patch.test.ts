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

    it('does not clobber a newer wrapper when restoring an older patch', () => {
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
        const secondWrapper = fakeWindow.fakeFetch

        firstRestore()
        expect(fakeWindow.fakeFetch).toBe(secondWrapper)

        secondRestore()
        expect(fakeWindow.fakeFetch).toBe(firstWrapper)

        firstRestore()
        expect(fakeWindow.fakeFetch).toBe(original)
    })
})
