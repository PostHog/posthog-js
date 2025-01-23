import * as React from 'react'
import { render, act } from '@testing-library/react'
import { PostHogProvider } from '..'
import posthogJs from 'posthog-js'

// Mock posthog-js
jest.mock('posthog-js', () => ({
    __esModule: true,
    default: {
        init: jest.fn(),
        set_config: jest.fn(),
        __loaded: false,
    },
}))

describe('PostHogProvider component', () => {
    it('should render children components', () => {
        const posthog = {}
        const { getByText } = render(
            <PostHogProvider client={posthog}>
                <div>Test</div>
            </PostHogProvider>
        )
        expect(getByText('Test')).toBeTruthy()
    })

    describe('when using apiKey initialization', () => {
        const apiKey = 'test-api-key'
        const initialOptions = { api_host: 'https://app.posthog.com' }
        const updatedOptions = { api_host: 'https://eu.posthog.com' }

        beforeEach(() => {
            jest.clearAllMocks()
        })

        it('should call set_config when options change', () => {
            const { rerender } = render(
                <PostHogProvider apiKey={apiKey} options={initialOptions}>
                    <div>Test</div>
                </PostHogProvider>
            )

            // First render should initialize
            expect(posthogJs.init).toHaveBeenCalledWith(apiKey, initialOptions)

            // Rerender with new options
            act(() => {
                rerender(
                    <PostHogProvider apiKey={apiKey} options={updatedOptions}>
                        <div>Test</div>
                    </PostHogProvider>
                )
            })

            // Should call set_config with new options
            expect(posthogJs.set_config).toHaveBeenCalledWith(updatedOptions)
        })

        it('should warn when attempting to change apiKey', () => {
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
            const newApiKey = 'different-api-key'

            const { rerender } = render(
                <PostHogProvider apiKey={apiKey} options={initialOptions}>
                    <div>Test</div>
                </PostHogProvider>
            )

            // First render should initialize
            expect(posthogJs.init).toHaveBeenCalledWith(apiKey, initialOptions)

            // Rerender with new apiKey
            act(() => {
                rerender(
                    <PostHogProvider apiKey={newApiKey} options={initialOptions}>
                        <div>Test</div>
                    </PostHogProvider>
                )
            })

            // Should warn about apiKey change
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('You have provided a different `apiKey` to `PostHogProvider`')
            )

            consoleSpy.mockRestore()
        })

        it('warns if posthogJs has been loaded elsewhere', () => {
            posthogJs.__loaded = true // Pretend it's initialized

            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
            render(
                <PostHogProvider apiKey={apiKey} options={initialOptions}>
                    <div>Test</div>
                </PostHogProvider>
            )

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('`posthog` was already loaded elsewhere. This may cause issues.')
            )

            consoleSpy.mockRestore()
            posthogJs.__loaded = false
        })
    })
})
