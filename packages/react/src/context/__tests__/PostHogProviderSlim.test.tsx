import * as React from 'react'
import { render } from '@testing-library/react'
import { PostHogProvider } from '../PostHogProviderSlim'
import { PostHogContext } from '../PostHogContext'
import type { PostHog } from 'posthog-js'

// Do NOT call setDefaultPostHogInstance — this simulates the slim bundle
// where no default instance exists.

function TestConsumer() {
    const { client } = React.useContext(PostHogContext)
    return <div data-testid="client-exists">{client ? 'yes' : 'no'}</div>
}

describe('PostHogProvider (slim)', () => {
    it('renders children', () => {
        const client = { config: {} } as unknown as PostHog
        const { getByText } = render(
            <PostHogProvider client={client}>
                <div>Hello</div>
            </PostHogProvider>
        )
        expect(getByText('Hello')).toBeTruthy()
    })

    it('provides the client via context', () => {
        const client = { config: {} } as unknown as PostHog
        const { getByTestId } = render(
            <PostHogProvider client={client}>
                <TestConsumer />
            </PostHogProvider>
        )
        expect(getByTestId('client-exists').textContent).toBe('yes')
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
