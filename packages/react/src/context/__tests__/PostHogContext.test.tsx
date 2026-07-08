import * as React from 'react'
import { render } from '@testing-library/react'
import { PostHogProvider, PostHog, PostHogContext } from '..'
import posthogJs from 'posthog-js'
import { setDefaultPostHogInstance } from '../posthog-default'

jest.mock('posthog-js', () => ({
    __esModule: true,
    default: {
        init: jest.fn(),
        __loaded: false,
    },
}))

describe('PostHogContext component', () => {
    const posthog = {} as unknown as PostHog

    beforeEach(() => {
        setDefaultPostHogInstance(posthogJs)
    })

    afterEach(() => {
        setDefaultPostHogInstance(undefined)
    })

    it('should return a client instance from the context if available', () => {
        function ClientConsumer() {
            const { client } = React.useContext(PostHogContext)
            return <div data-testid="client">{client === posthog ? 'match' : 'mismatch'}</div>
        }
        const { getByTestId } = render(
            <PostHogProvider client={posthog}>
                <ClientConsumer />
            </PostHogProvider>
        )
        expect(getByTestId('client').textContent).toBe('match')
    })

    it("should not throw error if a client instance can't be found in the context", () => {
        // eslint-disable-next-line no-console
        console.warn = jest.fn()

        expect(() => {
            render(
                // we have to cast `as any` so that we can test for when
                // posthog might not exist - in SSR for example
                <PostHogProvider client={undefined as any}>
                    <div>Hello</div>
                </PostHogProvider>
            )
        }).not.toThrow()

        // eslint-disable-next-line no-console
        expect(console.warn).toHaveBeenCalledWith(
            '[PostHog.js] No `apiKey` or `client` were provided to `PostHogProvider`. Using default global `window.posthog` instance. You must initialize it manually. This is not recommended behavior.'
        )
    })
})
