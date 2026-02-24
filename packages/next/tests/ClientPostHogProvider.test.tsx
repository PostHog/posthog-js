import React from 'react'
import { render, screen } from '@testing-library/react'
import { ClientPostHogProvider } from '../src/client/ClientPostHogProvider'

const mockPostHogProvider = jest.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="posthog-provider">{children}</div>
))
jest.mock('posthog-js/react', () => ({
    PostHogProvider: (props: any) => mockPostHogProvider(props),
}))

import posthogJs from 'posthog-js'

jest.mock('posthog-js', () => ({
    __esModule: true,
    default: {
        __loaded: false,
        init: jest.fn(),
    },
}))

const mockPostHogJs = posthogJs as jest.Mocked<typeof posthogJs> & { __loaded: boolean }

describe('ClientPostHogProvider', () => {
    beforeEach(() => {
        mockPostHogProvider.mockClear()
        ;(mockPostHogJs.init as jest.Mock).mockClear()
        mockPostHogJs.__loaded = false
    })

    it('renders children', () => {
        render(
            <ClientPostHogProvider apiKey="phc_test123">
                <div data-testid="child">Hello</div>
            </ClientPostHogProvider>
        )
        expect(screen.getByTestId('child')).toBeInTheDocument()
    })

    it('calls init with apiKey and options', () => {
        const options = { api_host: 'https://custom.posthog.com' }
        render(
            <ClientPostHogProvider apiKey="phc_test123" options={options}>
                <div>Child</div>
            </ClientPostHogProvider>
        )
        expect(mockPostHogJs.init).toHaveBeenCalledWith('phc_test123', options)
    })

    it('passes client to upstream provider', () => {
        render(
            <ClientPostHogProvider apiKey="phc_test123">
                <div>Child</div>
            </ClientPostHogProvider>
        )
        expect(mockPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({ client: mockPostHogJs })
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
        expect(mockPostHogJs.init).toHaveBeenCalledWith('phc_test123', { bootstrap })
    })

    it('merges bootstrap with existing options without overwriting', () => {
        const options = { api_host: 'https://custom.posthog.com' }
        const bootstrap = { featureFlags: { 'flag-a': true } }
        render(
            <ClientPostHogProvider apiKey="phc_test123" options={options} bootstrap={bootstrap}>
                <div>Child</div>
            </ClientPostHogProvider>
        )
        expect(mockPostHogJs.init).toHaveBeenCalledWith(
            'phc_test123',
            expect.objectContaining({
                api_host: 'https://custom.posthog.com',
                bootstrap,
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
        expect(mockPostHogJs.init).toHaveBeenCalledWith(
            'phc_test123',
            expect.objectContaining({
                bootstrap: expect.objectContaining({
                    sessionID: 'sess_123',
                    distinctID: 'user_abc',
                    featureFlags: { 'flag-a': true },
                }),
            })
        )
    })

    it('does not call init when already loaded', () => {
        mockPostHogJs.__loaded = true
        render(
            <ClientPostHogProvider apiKey="phc_test123">
                <div>Child</div>
            </ClientPostHogProvider>
        )
        expect(mockPostHogJs.init).not.toHaveBeenCalled()
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
