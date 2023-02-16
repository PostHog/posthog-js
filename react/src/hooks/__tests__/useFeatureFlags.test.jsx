import * as React from 'react'
import { renderHook, act } from '@testing-library/react-hooks'
import { PostHogProvider } from '../../context'
import { useFeatureFlag } from '..'

jest.useFakeTimers()

const ACTIVE_FEATURE_FLAGS = ['example_feature_1', 'example_feature_2', 'example_feature_3', 'multivariate_feature']
const ENABLED_FEATURE_FLAGS = {
    example_feature_true: true,
    example_feature_false: false,
    multivariate_feature: 'string-value',
}

describe('useFeatureFlags hook', () => {
    given('renderProvider', () => ({ children }) => (
        <PostHogProvider client={given.posthog}>{children}</PostHogProvider>
    ))

    given('posthog', () => ({
        isFeatureEnabled: (flag) =>
            flag === 'example_feature_1' || flag === 'example_feature_2' || flag === 'multivariate_feature',
        getFeatureFlag: (flag) => ENABLED_FEATURE_FLAGS[flag],
        onFeatureFlags: (callback) => {
            callback(ACTIVE_FEATURE_FLAGS)
            return () => {}
        },
    }))

    it('should evaluate the feature flag value', () => {
        let { result: result_1 } = renderHook(() => useFeatureFlag('example_feature_true'), {
            wrapper: given.renderProvider,
        })
        expect(result_1.current).toEqual(true)

        let { result: result_2 } = renderHook(() => useFeatureFlag('example_feature_false'), {
            wrapper: given.renderProvider,
        })
        expect(result_2.current).toEqual(false)

        let { result: result_3 } = renderHook(() => useFeatureFlag('multivariate_feature'), {
            wrapper: given.renderProvider,
        })
        expect(result_3.current).toEqual('string-value')
    })
})
