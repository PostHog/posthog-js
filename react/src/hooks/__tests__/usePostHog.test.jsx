import * as React from 'react'
import { renderHook } from '@testing-library/react-hooks'
import { PostHogProvider } from '../../context'
import { usePostHog } from '..'

jest.useFakeTimers()

const posthog = { posthog_client: true }

describe('usePostHog hook', () => {
    given('renderProvider', () => ({ children }) => (
        <PostHogProvider client={given.posthog}>{children}</PostHogProvider>
    ))

    given('posthog', () => posthog)

    it('should return the client', () => {
        let { result } = renderHook(() => usePostHog(), {
            wrapper: given.renderProvider,
        })
        expect(result.current).toEqual(posthog)
    })
})
