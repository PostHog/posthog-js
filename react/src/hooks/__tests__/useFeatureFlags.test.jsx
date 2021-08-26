import * as React from 'react'
import { renderHook, act } from '@testing-library/react-hooks'
import { PostHogProvider } from '../../context'
import { useFeatureFlags } from '..'

jest.useFakeTimers()

const ACTIVE_FEATURE_FLAGS = ['example_feature_1', 'example_feature_2', 'example_feature_3']
const ENABLED_FEATURE_FLAGS = {
    example_feature_1: true,
    example_feature_2: true,
    example_feature_3: false,
}

describe('useFeatureFlags hook', () => {
    given('renderProvider', () => ({ children }) => (
        <PostHogProvider client={given.posthog}>{children}</PostHogProvider>
    ))

    given('props', () => undefined)

    given('subject', () => () => renderHook(() => useFeatureFlags(given.props), { wrapper: given.renderProvider }))

    given('onFeatureFlags', () => (callback) => callback(ACTIVE_FEATURE_FLAGS))

    given('posthog', () => ({
        onFeatureFlags: given.onFeatureFlags,
        isFeatureEnabled: (flag) => flag !== 'example_feature_3',
        getFeatureFlag: (flag) => ENABLED_FEATURE_FLAGS[flag],
        featureFlags: { reloadFeatureFlags: jest.fn() },
    }))

    it('should return an empty `enabled` object by default', () => {
        given('onFeatureFlags', () => () => {})

        expect(given.subject().result.current).toEqual({
            enabled: {},
        })
    })

    it('should return `active` and `enabled` features when feature flags are changed', async () => {
        expect(given.subject().result.current).toEqual({
            active: ACTIVE_FEATURE_FLAGS,
            enabled: ENABLED_FEATURE_FLAGS,
        })
    })

    it('should not refresh feature flags on an interval if no refreshInterval is provided', () => {
        given.subject()

        act(() => {
            const reloadFeatureFlags = given.posthog.featureFlags.reloadFeatureFlags
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(0)
            jest.advanceTimersByTime(1000)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(0)
            jest.advanceTimersByTime(3000)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(0)
        })
    })

    it('should refresh feature flags on an interval if a non-zero refreshInterval is provided', () => {
        given('props', () => ({ refreshInterval: 1 }))
        given.subject()

        act(() => {
            const reloadFeatureFlags = given.posthog.featureFlags.reloadFeatureFlags
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(0)
            jest.advanceTimersByTime(1000)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
            jest.advanceTimersByTime(1000)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(2)
            jest.advanceTimersByTime(3000)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(5)
        })
    })
})
