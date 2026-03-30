import * as React from 'react'
import { render } from '@testing-library/react'
import { PostHogProvider } from '../PostHogProviderSlim'
import { PostHogContext } from '../PostHogContext'
import type { PostHog } from 'posthog-js'

// Do NOT call setDefaultPostHogInstance — this simulates the slim bundle
// where no default instance exists.

let contextClient: PostHog | undefined

function ClientConsumer() {
    const { client } = React.useContext(PostHogContext)
    contextClient = client
    return <div>consumed</div>
}

describe('PostHogProvider (slim)', () => {
    afterEach(() => {
        contextClient = undefined
    })

    it('renders children', () => {
        const client = { config: {} } as unknown as PostHog
        const { getByText } = render(
            <PostHogProvider client={client}>
                <div>Hello</div>
            </PostHogProvider>
        )
        expect(getByText('Hello')).toBeTruthy()
    })

    it('provides the exact client instance via context', () => {
        const client = { config: {} } as unknown as PostHog
        render(
            <PostHogProvider client={client}>
                <ClientConsumer />
            </PostHogProvider>
        )
        expect(contextClient).toBe(client)
    })

    it('provides bootstrap from client config', () => {
        const bootstrap = { featureFlags: { 'test-flag': true } }
        const client = { config: { bootstrap } } as unknown as PostHog

        function BootstrapConsumer() {
            const { bootstrap: ctx } = React.useContext(PostHogContext)
            return <div data-testid="bootstrap">{JSON.stringify(ctx)}</div>
        }

        const { getByTestId } = render(
            <PostHogProvider client={client}>
                <BootstrapConsumer />
            </PostHogProvider>
        )
        expect(JSON.parse(getByTestId('bootstrap').textContent!)).toEqual(bootstrap)
    })
})
