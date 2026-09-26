import * as React from 'react'
import { render } from '@testing-library/react'
import { PostHogProvider, PostHog, PostHogContext } from '..'
import posthogJs from 'posthog-js'
import { setDefaultPostHogInstance } from '../posthog-default'

vi.mock('posthog-js', () => ({
    __esModule: true,
    default: {
        init: vi.fn(),
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
        vi.restoreAllMocks()
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

    it('uses the default client when no client or API key is supplied', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        let observedClient: unknown
        function DefaultConsumer() {
            observedClient = React.useContext(PostHogContext).client
            return <div>Hello</div>
        }

        expect(() => {
            render(
                <PostHogProvider client={undefined as any}>
                    <DefaultConsumer />
                </PostHogProvider>
            )
        }).not.toThrow()
        expect(observedClient).toBe(posthogJs)

        // oxlint-disable-next-line no-console
        expect(console.warn).toHaveBeenCalledWith(
            '[PostHog.js] No `apiKey` or `client` were provided to `PostHogProvider`. Using default global `window.posthog` instance. You must initialize it manually. This is not recommended behavior.'
        )
    })
})
