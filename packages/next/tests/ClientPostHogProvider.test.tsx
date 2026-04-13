import React, { useContext } from 'react'
import { render, screen } from '@testing-library/react'
import { ClientPostHogProvider } from '../src/client/ClientPostHogProvider'
import { PostHogContext, useFeatureFlagEnabled } from 'posthog-js/react'
import posthogJs from 'posthog-js'

jest.mock('posthog-js', () => ({
    __esModule: true,
    default: {
        __loaded: false,
        init: jest.fn(),
        isFeatureEnabled: jest.fn(() => undefined),
        onFeatureFlags: jest.fn(() => () => {}),
    },
}))

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
