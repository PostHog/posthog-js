import * as React from 'react'
import { render } from '@testing-library/react'
import { usePostHogContext, PostHogProvider } from '../'

describe('usePostHogContext hook', () => {
    function App() {
        const context = usePostHogContext()
        expect(context.client).toEqual(given.posthog)
        return null
    }

    given(
        'render',
        () => () =>
            render(
                <PostHogProvider client={given.posthog}>
                    <App />
                </PostHogProvider>
            )
    )
    given('posthog', () => ({}))

    it('should return a client instance from the context if available', () => {
        given.render()
    })

    it("should error if a client instance can't be found in the context", () => {
        given('posthog', () => undefined)
        console.error = jest.fn()

        expect(() => given.render()).toThrow()
    })
})
