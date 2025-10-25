import * as React from 'react'
import { renderHook } from '@testing-library/react-hooks'
import { PostHogProvider } from '../../context'
import { usePostHog } from '..'

jest.useFakeTimers()

const posthog = { posthog_client: true }

describe('usePostHog hook', () => {
    it('should return the client', () => {
        let { result } = renderHook(() => usePostHog(), {
            wrapper: ({ children }) => <PostHogProvider client={posthog}>{children}</PostHogProvider>,
        })
        expect(result.current).toEqual(posthog)
    })
})
