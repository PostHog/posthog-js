import React, { useContext } from 'react'
import { render, screen } from '@testing-library/react'
import { ClientPostHogProvider } from '../src/client/ClientPostHogProvider'
import { PostHogContext, useFeatureFlagEnabled } from '@posthog/react'
import { posthog as posthogJs } from 'posthog-js'

jest.mock('posthog-js', () => {
    const posthog = {
        __loaded: false,
        init: jest.fn(),
        isFeatureEnabled: jest.fn(() => undefined),
        onFeatureFlags: jest.fn(() => () => {}),
    }

    return {
        __esModule: true,
        // Native Node ESM resolves the posthog-js CommonJS default import to
        // the exports object. Model that shape so the provider must select the
        // named singleton instead of accidentally placing this object in context.
        default: { default: posthog, posthog },
        posthog,
    }
})

const mockPostHogJs = posthogJs as jest.Mocked<typeof posthogJs> & { __loaded: boolean }

/** Helper component that exposes the PostHogContext value for assertions. */
function ContextReader({ onContext }: { onContext: (ctx: { client: any; bootstrap?: any }) => void }) {
    const ctx = useContext(PostHogContext)
    onContext(ctx)
    return null
}

describe('ClientPostHogProvider', () => {
    beforeEach(() => {
        ;(mockPostHogJs.init as jest.Mock).mockClear()
        ;(mockPostHogJs.isFeatureEnabled as jest.Mock).mockClear()
        ;(mockPostHogJs.onFeatureFlags as jest.Mock).mockClear()
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
        expect(mockPostHogJs.init).toHaveBeenCalledWith(
            'phc_test123',
            expect.objectContaining({
                api_host: 'https://custom.posthog.com',
                tracing_headers: [window.location.hostname],
            })
        )
    })

    it.each([
        {
            name: 'defaults tracing headers to the current hostname',
            options: undefined,
            expectedOptions: expect.objectContaining({ tracing_headers: [window.location.hostname] }),
        },
        {
            name: 'preserves explicit tracing headers opt-out',
            options: { tracing_headers: [] },
            expectedOptions: { tracing_headers: [] },
        },
        {
            name: 'preserves deprecated addTracingHeaders alias',
            options: { addTracingHeaders: ['api.example.com'] } as any,
            expectedOptions: { addTracingHeaders: ['api.example.com'] },
        },
        {
            name: 'preserves deprecated __add_tracing_headers alias',
            options: { __add_tracing_headers: ['api.example.com'] } as any,
            expectedOptions: { __add_tracing_headers: ['api.example.com'] },
        },
    ])('$name', ({ options, expectedOptions }) => {
        render(
            <ClientPostHogProvider apiKey="phc_test123" options={options}>
                <div>Child</div>
            </ClientPostHogProvider>
        )
        expect(mockPostHogJs.init).toHaveBeenCalledWith('phc_test123', expectedOptions)
    })

    it('provides posthog client via context', () => {
        let contextValue: any
        render(
            <ClientPostHogProvider apiKey="phc_test123">
                <ContextReader onContext={(ctx) => (contextValue = ctx)} />
            </ClientPostHogProvider>
        )
        expect(contextValue.client).toBe(mockPostHogJs)
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
        expect(mockPostHogJs.init).toHaveBeenCalledWith(
            'phc_test123',
            expect.objectContaining({ bootstrap, tracing_headers: [window.location.hostname] })
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

    it('provides bootstrap via context for SSR hook access', () => {
        const bootstrap = {
            featureFlags: { 'flag-a': true, 'flag-b': 'variant-1' },
            featureFlagPayloads: { 'flag-b': { key: 'value' } },
        }
        let contextValue: any
        render(
            <ClientPostHogProvider apiKey="phc_test123" bootstrap={bootstrap}>
                <ContextReader onContext={(ctx) => (contextValue = ctx)} />
            </ClientPostHogProvider>
        )
        expect(contextValue.bootstrap).toEqual(bootstrap)
    })

    it('context bootstrap is undefined when no bootstrap prop provided', () => {
        let contextValue: any
        render(
            <ClientPostHogProvider apiKey="phc_test123">
                <ContextReader onContext={(ctx) => (contextValue = ctx)} />
            </ClientPostHogProvider>
        )
        expect(contextValue.bootstrap).toBeUndefined()
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

    it('useFeatureFlagEnabled returns bootstrapped value before client loads flags', () => {
        // Simulates SSR: posthog-js has no loaded flags, but bootstrap is provided.
        // The hook should fall back to the bootstrap value from context.
        const bootstrap = {
            featureFlags: { 'my-flag': true, 'my-experiment': 'variant-a' },
        }
        let flagValue: boolean | undefined
        function FlagReader() {
            flagValue = useFeatureFlagEnabled('my-flag')
            return <div data-testid="flag">{String(flagValue)}</div>
        }
        render(
            <ClientPostHogProvider apiKey="phc_test123" bootstrap={bootstrap}>
                <FlagReader />
            </ClientPostHogProvider>
        )
        expect(flagValue).toBe(true)
        expect(screen.getByTestId('flag')).toHaveTextContent('true')
    })

    it('useFeatureFlagEnabled returns undefined for unknown flag even with bootstrap', () => {
        const bootstrap = {
            featureFlags: { 'my-flag': true },
        }
        let flagValue: boolean | undefined
        function FlagReader() {
            flagValue = useFeatureFlagEnabled('unknown-flag')
            return null
        }
        render(
            <ClientPostHogProvider apiKey="phc_test123" bootstrap={bootstrap}>
                <FlagReader />
            </ClientPostHogProvider>
        )
        expect(flagValue).toBeUndefined()
    })

    it('renders children and warns when apiKey is empty', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
        render(
            <ClientPostHogProvider apiKey="">
                <div data-testid="child">Child</div>
            </ClientPostHogProvider>
        )
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('apiKey is required'))
        expect(screen.getByTestId('child')).toBeInTheDocument()
        warnSpy.mockRestore()
    })
})
