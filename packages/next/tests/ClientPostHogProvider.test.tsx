import React from 'react'
import { render, screen } from '@testing-library/react'
import { ClientPostHogProvider } from '../src/client/ClientPostHogProvider'

const mockPostHogProvider = jest.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="posthog-provider">{children}</div>
))
jest.mock('posthog-js/react', () => ({
    PostHogProvider: (props: any) => mockPostHogProvider(props),
}))

describe('ClientPostHogProvider', () => {
    beforeEach(() => {
        mockPostHogProvider.mockClear()
    })

    it('renders children', () => {
        render(
            <ClientPostHogProvider apiKey="phc_test123">
                <div data-testid="child">Hello</div>
            </ClientPostHogProvider>
        )
        expect(screen.getByTestId('child')).toBeInTheDocument()
    })

    it('passes apiKey and options to upstream provider', () => {
        const options = { api_host: 'https://custom.posthog.com' }
        render(
            <ClientPostHogProvider apiKey="phc_test123" options={options}>
                <div>Child</div>
            </ClientPostHogProvider>
        )
        expect(mockPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                apiKey: 'phc_test123',
                options: expect.objectContaining({ api_host: 'https://custom.posthog.com' }),
            })
        )
    })

    it('merges bootstrap into options when provided', () => {
        const bootstrap = {
            distinctID: 'user_abc',
            isIdentifiedID: true,
            featureFlags: { 'flag-a': true, 'flag-b': 'variant-1' },
        }
        render(
            <ClientPostHogProvider apiKey="phc_test123" bootstrap={bootstrap}>
                <div>Child</div>
            </ClientPostHogProvider>
        )
        expect(mockPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    bootstrap,
                }),
            })
        )
    })

    it('merges bootstrap with existing options without overwriting', () => {
        const options = { api_host: 'https://custom.posthog.com' }
        const bootstrap = { featureFlags: { 'flag-a': true } }
        render(
            <ClientPostHogProvider apiKey="phc_test123" options={options} bootstrap={bootstrap}>
                <div>Child</div>
            </ClientPostHogProvider>
        )
        expect(mockPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    api_host: 'https://custom.posthog.com',
                    bootstrap,
                }),
            })
        )
    })

    it('preserves existing options.bootstrap fields when merging server bootstrap', () => {
        const options = {
            bootstrap: { sessionID: 'sess_123' },
        } as any
        const bootstrap = {
            distinctID: 'user_abc',
            featureFlags: { 'flag-a': true },
        }
        render(
            <ClientPostHogProvider apiKey="phc_test123" options={options} bootstrap={bootstrap}>
                <div>Child</div>
            </ClientPostHogProvider>
        )
        expect(mockPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    bootstrap: expect.objectContaining({
                        sessionID: 'sess_123',
                        distinctID: 'user_abc',
                        featureFlags: { 'flag-a': true },
                    }),
                }),
            })
        )
    })

    it('throws when apiKey is empty', () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
        expect(() =>
            render(
                <ClientPostHogProvider apiKey="">
                    <div>Child</div>
                </ClientPostHogProvider>
            )
        ).toThrow('[PostHog Next.js] apiKey is required')
        consoleSpy.mockRestore()
    })
})
