import React from 'react'
import { render, screen } from '@testing-library/react'
import { PostHogProvider } from '../src/pages/PostHogProvider'

const mockClientPostHogProvider = vi.hoisted(() => vi.fn())
vi.mock('../src/client/ClientPostHogProvider', () => ({
    ClientPostHogProvider: (props: any) => mockClientPostHogProvider(props),
}))

describe('Pages PostHogProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockClientPostHogProvider.mockImplementation(({ children }: { children: React.ReactNode }) => (
            <div data-testid="client-provider">{children}</div>
        ))
    })

    it('renders children inside ClientPostHogProvider', () => {
        render(
            <PostHogProvider projectToken="phc_test123">
                <div data-testid="child">Hello</div>
            </PostHogProvider>
        )
        expect(screen.getByTestId('client-provider')).toBeInTheDocument()
        expect(screen.getByTestId('child')).toBeInTheDocument()
    })

    it('passes projectToken to ClientPostHogProvider', () => {
        render(
            <PostHogProvider projectToken="phc_test123">
                <div>Child</div>
            </PostHogProvider>
        )
        expect(mockClientPostHogProvider).toHaveBeenCalledWith(expect.objectContaining({ projectToken: 'phc_test123' }))
    })

    it('warns and renders children without ClientPostHogProvider when projectToken is empty and env var is not set', () => {
        delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation()

        render(
            <PostHogProvider projectToken="">
                <div data-testid="child">Child</div>
            </PostHogProvider>
        )

        expect(screen.getByTestId('child')).toBeInTheDocument()
        expect(mockClientPostHogProvider).not.toHaveBeenCalled()
        expect(warnSpy).toHaveBeenCalledWith(
            '[PostHog Next.js] projectToken is required — set NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN or pass projectToken. PostHog will not be initialized'
        )
        warnSpy.mockRestore()
    })

    it('trims projectToken and api_host before passing them to ClientPostHogProvider', () => {
        render(
            <PostHogProvider
                projectToken={'  phc_test123\n'}
                clientOptions={{ api_host: '  https://custom.posthog.com/\t ' }}
            >
                <div>Child</div>
            </PostHogProvider>
        )
        expect(mockClientPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                projectToken: 'phc_test123',
                options: expect.objectContaining({ api_host: 'https://custom.posthog.com/' }),
            })
        )
    })

    it('applies NEXTJS_CLIENT_DEFAULTS to options', () => {
        render(
            <PostHogProvider projectToken="phc_test123">
                <div>Child</div>
            </PostHogProvider>
        )
        expect(mockClientPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    api_host: 'https://us.i.posthog.com',
                    capture_exceptions: true,
                    persistence: 'localStorage+cookie',
                    opt_out_capturing_persistence_type: 'cookie',
                    opt_out_persistence_by_default: true,
                }),
            })
        )
    })

    it('allows user clientOptions to override defaults', () => {
        render(
            <PostHogProvider
                projectToken="phc_test123"
                clientOptions={{ capture_exceptions: false, persistence: 'memory' }}
            >
                <div>Child</div>
            </PostHogProvider>
        )
        expect(mockClientPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    capture_exceptions: false,
                    persistence: 'memory',
                    opt_out_capturing_persistence_type: 'cookie',
                }),
            })
        )
    })

    it('resolves api_host from env when not provided', () => {
        process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://env-host.posthog.com'
        render(
            <PostHogProvider projectToken="phc_test123">
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

    it('trims projectToken and api_host from env vars', () => {
        process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = '  phc_from_env\n'
        process.env.NEXT_PUBLIC_POSTHOG_HOST = '  https://env-host.posthog.com/\t '
        render(
            <PostHogProvider>
                <div>Child</div>
            </PostHogProvider>
        )
        expect(mockClientPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                projectToken: 'phc_from_env',
                options: expect.objectContaining({
                    api_host: 'https://env-host.posthog.com/',
                }),
            })
        )
        delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
        delete process.env.NEXT_PUBLIC_POSTHOG_HOST
    })

    it('passes clientOptions.bootstrap to ClientPostHogProvider', () => {
        const bootstrap = { featureFlags: { 'flag-a': true } }
        render(
            <PostHogProvider projectToken="phc_test123" clientOptions={{ bootstrap }}>
                <div>Child</div>
            </PostHogProvider>
        )
        expect(mockClientPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({ options: expect.objectContaining({ bootstrap }) })
        )
    })
})
