import React from 'react'
import { mocked } from 'ts-jest/utils'
import { renderHook, act } from '@testing-library/react-hooks'
import posthog from 'posthog-js'
import { PostHogProvider } from '../../context'
import { useFeatureFlags } from '..'

describe('useFeatureFlags hook', () => {
    const ACTIVE_FEATURE_FLAGS = ['example_feature_1', 'example_feature_2', 'example_feature_3']
    const ENABLED_FEATURE_FLAGS = {
        example_feature_1: true,
        example_feature_2: true,
        example_feature_3: false,
    }

    const wrapper = ({ children }) => <PostHogProvider client={posthog}>{children}</PostHogProvider>

    beforeEach(() => {
        posthog.init('test_token', {
            api_host: 'https://test.com',
        })
    })

    it('should return an empty `enabled` object by default', () => {
        const mockedPosthog = mocked(posthog)
        jest.spyOn(mockedPosthog, 'onFeatureFlags').mockImplementationOnce(() => undefined)

        const { result } = renderHook(() => useFeatureFlags(), { wrapper })
        expect(result.current).toEqual({
            enabled: {},
        })
    })

    it('should return `active` and `enabled` features when feature flags are changed', async () => {
        const mockedPosthog = mocked(posthog)
        jest.spyOn(mockedPosthog, 'onFeatureFlags').mockImplementationOnce((callback) => {
            callback(ACTIVE_FEATURE_FLAGS)
            return undefined
        })
        jest.spyOn(mockedPosthog, 'isFeatureEnabled').mockImplementation((flag) => {
            return ENABLED_FEATURE_FLAGS[flag]
        })

        const { result } = renderHook(() => useFeatureFlags(), { wrapper })
        expect(result.current).toEqual({
            active: ACTIVE_FEATURE_FLAGS,
            enabled: ENABLED_FEATURE_FLAGS,
        })
    })

    it('should refresh feature flags on an interval if a non-zero refreshInterval is provided', () => {
        jest.useFakeTimers()

        const mockedPosthog = mocked(posthog)
        jest.spyOn(mockedPosthog, 'onFeatureFlags').mockImplementationOnce(() => undefined)
        jest.spyOn(mockedPosthog.featureFlags, 'reloadFeatureFlags').mockImplementation(() => undefined)

        renderHook(() => useFeatureFlags({ refreshInterval: 1 }), { wrapper })

        act(() => {
            expect(mockedPosthog.featureFlags.reloadFeatureFlags).toHaveBeenCalledTimes(0)
            jest.advanceTimersByTime(1000)
            expect(mockedPosthog.featureFlags.reloadFeatureFlags).toHaveBeenCalledTimes(1)
            jest.advanceTimersByTime(1000)
            expect(mockedPosthog.featureFlags.reloadFeatureFlags).toHaveBeenCalledTimes(2)
            jest.advanceTimersByTime(3000)
            expect(mockedPosthog.featureFlags.reloadFeatureFlags).toHaveBeenCalledTimes(5)
        })
    })
})
