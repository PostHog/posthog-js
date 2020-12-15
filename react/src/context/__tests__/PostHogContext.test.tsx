import React from 'react'
import { render, cleanup } from '@testing-library/react'
import posthog from 'posthog-js'
import { usePostHogContext, PostHogProvider } from '../'

describe('usePostHogContext hook', () => {
    beforeEach(() => {
        posthog.init('test_token', {
            api_host: 'https://test.com',
        })
    })

    afterEach(() => {
        cleanup()
    })

    it('should return a client instance from the context if available', () => {
        function App() {
            const context = usePostHogContext()
            expect(context.client).toEqual(posthog)
            return null
        }

        render(
            <PostHogProvider client={posthog}>
                <App />
            </PostHogProvider>
        )
    })
})
