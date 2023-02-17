import * as React from 'react'
import { render } from '@testing-library/react'
import { PostHogContext, PostHogProvider } from '../'

describe('usePostHogContext hook', () => {
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

    it("should not error if a client instance can't be found in the context", () => {
        // used to make sure it doesn't throw an error when no client is found e.g. nextjs
        given('posthog', () => undefined)
        console.error = jest.fn()

        expect(() => given.render())
    })
})
