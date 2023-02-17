import * as React from 'react'
import { renderHook, act } from '@testing-library/react-hooks'
import { PostHogProvider } from '../../context'
import { useFeatureFlagEnabled } from '..'
import { useFeatureFlagPayload } from '../useFeatureFlagPayload'

jest.useFakeTimers()

const ACTIVE_FEATURE_FLAGS = ['example_feature_true', 'example_feature_2']
const ENABLED_FEATURE_FLAGS = {
    example_feature_true: true,
    example_feature_false: false,
    multivariate_feature: 'string-value',
}

const FEATURE_FLAG_PAYLOADS = {
    example_feature_1_payload: {
        id: 1,
        name: 'example_feature_1_payload',
        key: 'example_feature_1_payload',
    },
}

describe('useFeatureFlagPayload hook', () => {
    given('renderProvider', () => ({ children }) => (
        <PostHogProvider client={given.posthog}>{children}</PostHogProvider>
    ))

    given('posthog', () => ({
        isFeatureEnabled: (flag) =>
            flag === 'example_feature_1_payload' || flag === 'example_feature_2' || flag === 'multivariate_feature',
        getFeatureFlagPayload: (flag) => FEATURE_FLAG_PAYLOADS[flag],
        getFeatureFlag: (flag) => ENABLED_FEATURE_FLAGS[flag],
        onFeatureFlags: (callback) => {
            callback(ACTIVE_FEATURE_FLAGS)
            return () => {}
        },
    }))

    it('should get the feature flag when present', () => {
        let { result: result_1 } = renderHook(() => useFeatureFlagPayload('example_feature_1_payload'), {
            wrapper: given.renderProvider,
        })
        expect(result_1.current).toEqual(FEATURE_FLAG_PAYLOADS.example_feature_1_payload)

        let { result: result_2 } = renderHook(() => useFeatureFlagPayload('example_feature_2'), {
            wrapper: given.renderProvider,
        })
        expect(result_2.current).toEqual(undefined)
    })
})
