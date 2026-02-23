import React from 'react'
import { render, screen } from '@testing-library/react'
import { withPostHogApp } from '../src/pages/withPostHogApp'

// Mock posthog-js/react
const mockPostHogProvider = jest.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="posthog-provider">{children}</div>
))
jest.mock('posthog-js/react', () => ({
    PostHogProvider: (props: any) => mockPostHogProvider(props),
}))

// Simple mock App component for Page Router
function MockApp({ Component, pageProps }: any) {
    return <Component {...pageProps} />
}

function MockPage() {
    return <div data-testid="page-content">Hello from Page Router</div>
}

describe('withPostHogApp', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('wraps the App with PostHogProvider', () => {
        const WrappedApp = withPostHogApp(MockApp, { apiKey: 'phc_test123' })
        render(<WrappedApp Component={MockPage} pageProps={{}} router={{} as any} />)

        expect(screen.getByTestId('posthog-provider')).toBeInTheDocument()
        expect(screen.getByTestId('page-content')).toBeInTheDocument()
    })

    it('passes apiKey to the provider', () => {
        const WrappedApp = withPostHogApp(MockApp, { apiKey: 'phc_test123' })
        render(<WrappedApp Component={MockPage} pageProps={{}} router={{} as any} />)

        expect(mockPostHogProvider).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'phc_test123' }))
    })

    it('passes options to the provider', () => {
        const options = { api_host: 'https://custom.posthog.com' }
        const WrappedApp = withPostHogApp(MockApp, { apiKey: 'phc_test123', options })
        render(<WrappedApp Component={MockPage} pageProps={{}} router={{} as any} />)

        expect(mockPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({ options: expect.objectContaining(options) })
        )
    })

    it('applies Next.js-specific defaults', () => {
        const WrappedApp = withPostHogApp(MockApp, { apiKey: 'phc_test123' })
        render(<WrappedApp Component={MockPage} pageProps={{}} router={{} as any} />)

        expect(mockPostHogProvider).toHaveBeenCalledWith(
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
        const WrappedApp = withPostHogApp(MockApp, {
            apiKey: 'phc_test123',
            options: { persistence: 'memory', opt_out_persistence_by_default: false },
        })
        render(<WrappedApp Component={MockPage} pageProps={{}} router={{} as any} />)

        expect(mockPostHogProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    persistence: 'memory',
                    opt_out_capturing_persistence_type: 'cookie',
                    opt_out_persistence_by_default: false,
                }),
            })
        )
    })

    it('forwards all props to the wrapped App', () => {
        const WrappedApp = withPostHogApp(MockApp, { apiKey: 'phc_test123' })
        const customPageProps = { customProp: 'value' }
        render(<WrappedApp Component={MockPage} pageProps={customPageProps} router={{} as any} />)

        expect(screen.getByTestId('page-content')).toBeInTheDocument()
    })

    it('sets displayName on the wrapped component', () => {
        const WrappedApp = withPostHogApp(MockApp, { apiKey: 'phc_test123' })
        expect(WrappedApp.displayName).toBe('withPostHogApp(MockApp)')
    })
})
