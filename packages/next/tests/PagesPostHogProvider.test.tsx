import React from 'react'
import { render, screen } from '@testing-library/react'
import { PostHogProvider } from '../src/pages/PostHogProvider'

const mockClientPostHogProvider = jest.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="client-provider">{children}</div>
))
jest.mock('../src/client/ClientPostHogProvider', () => ({
    ClientPostHogProvider: (props: any) => mockClientPostHogProvider(props),
}))

describe('Pages PostHogProvider', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('renders children inside ClientPostHogProvider', () => {
        render(
            <PostHogProvider apiKey="phc_test123">
                <div data-testid="child">Hello</div>
            </PostHogProvider>
        )
        expect(screen.getByTestId('client-provider')).toBeInTheDocument()
        expect(screen.getByTestId('child')).toBeInTheDocument()
    })

    it('passes apiKey to ClientPostHogProvider', () => {
        render(
            <PostHogProvider apiKey="phc_test123">
                <div>Child</div>
            </PostHogProvider>
        )
        expect(mockClientPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({ apiKey: 'phc_test123' })
        )
    })

    it('applies NEXTJS_CLIENT_DEFAULTS to options', () => {
        render(
            <PostHogProvider apiKey="phc_test123">
                <div>Child</div>
            </PostHogProvider>
        )
        expect(mockClientPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    persistence: 'localStorage+cookie',
                    opt_out_capturing_persistence_type: 'cookie',
                    opt_out_persistence_by_default: true,
                }),
            })
        )
    })

    it('allows user options to override defaults', () => {
        render(
            <PostHogProvider apiKey="phc_test123" options={{ persistence: 'memory' }}>
                <div>Child</div>
            </PostHogProvider>
        )
        expect(mockClientPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    persistence: 'memory',
                    opt_out_capturing_persistence_type: 'cookie',
                }),
            })
        )
    })

    it('resolves api_host from env when not provided', () => {
        process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://env-host.posthog.com'
        render(
            <PostHogProvider apiKey="phc_test123">
                <div>Child</div>
            </PostHogProvider>
        )
        expect(mockClientPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    api_host: 'https://env-host.posthog.com',
                }),
            })
        )
        delete process.env.NEXT_PUBLIC_POSTHOG_HOST
    })

    it('passes bootstrap prop through to ClientPostHogProvider', () => {
        const bootstrap = { featureFlags: { 'flag-a': true } }
        render(
            <PostHogProvider apiKey="phc_test123" bootstrap={bootstrap}>
                <div>Child</div>
            </PostHogProvider>
        )
        expect(mockClientPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({ bootstrap })
        )
    })
})
