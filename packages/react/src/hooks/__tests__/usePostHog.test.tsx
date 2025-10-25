import * as React from 'react'
import { renderHook } from '@testing-library/react-hooks'
import { PostHogProvider, PostHog } from '../../context'
import { usePostHog } from '..'

jest.useFakeTimers()

const posthog = { posthog_client: true } as unknown as PostHog

describe('usePostHog hook', () => {
    it('should return the client', () => {
        const { result } = renderHook(() => usePostHog(), {
            wrapper: ({ children }: { children: React.ReactNode }) => (
                <PostHogProvider client={posthog}>{children}</PostHogProvider>
            ),
        })
        expect(result.current).toEqual(posthog)
    })
})
