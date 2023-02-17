import * as React from 'react'
import { renderHook, act } from '@testing-library/react-hooks'
import { PostHogProvider } from '../../context'
import { useFeatureFlag, usePostHog } from '..'

jest.useFakeTimers()

const posthog = { posthog_client: true }

describe('useFeatureFlags hook', () => {
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
