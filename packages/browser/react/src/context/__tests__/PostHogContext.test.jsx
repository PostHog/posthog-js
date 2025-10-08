import * as React from 'react'
import { render } from '@testing-library/react'
import { PostHogProvider } from '..'

describe('PostHogContext component', () => {
    given(
        'render',
        () => () =>
            render(
                <PostHogProvider client={given.posthog}>
                    <div>Hello</div>
                </PostHogProvider>
            )
    )
    given('posthog', () => ({}))

    it('should return a client instance from the context if available', () => {
        given.render()
    })

    it("should not throw error if a client instance can't be found in the context", () => {
        given('posthog', () => undefined) // it might not exist in SSR for example

        // eslint-disable-next-line no-console
        console.warn = jest.fn()

        expect(() => given.render()).not.toThrow()

        // eslint-disable-next-line no-console
        expect(console.warn).toHaveBeenCalledWith(
            '[PostHog.js] No `apiKey` or `client` were provided to `PostHogProvider`. Using default global `window.posthog` instance. You must initialize it manually. This is not recommended behavior.'
        )
    })
})
