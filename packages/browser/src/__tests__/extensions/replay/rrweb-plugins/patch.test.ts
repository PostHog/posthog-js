import { patch } from '../../../../extensions/replay/rrweb-plugins/patch'

const fakeWindow = {
    fakeFetch: () => {},
}

// JS-DOM doesn't have fetch and its fake XHR doesn't work with our patch,
// so we can't test them directly
describe('patch', () => {
    it('marks a function as wrapped', () => {
        patch(fakeWindow, 'fakeFetch', () => () => {})
        // eslint-disable-next-line compat/compat
        expect((fakeWindow.fakeFetch as any).__posthog_wrapped__).toBe(true)
    })
})
