import * as React from 'react'
import { renderHook } from '@testing-library/react-hooks'
import { PostHogProvider } from '../../context'
import { useFeatureFlagPayload } from '../useFeatureFlagPayload'
import { useFeatureFlagEnabled } from '../useFeatureFlagEnabled'
import { useFeatureFlags } from '../useFeatureFlags'

jest.useFakeTimers()

const FEATURE_FLAG_STATUS = {
    example_feature_true: true,
    example_feature_false: false,
    multivariate_feature: 'string-value',
    example_feature_1_payload: true,
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
        isFeatureEnabled: (flag) => FEATURE_FLAG_STATUS[flag],
        getFeatureFlag: (flag) => FEATURE_FLAG_STATUS[flag],
        getFeatureFlagPayload: (flag) => FEATURE_FLAG_PAYLOADS[flag],
        onFeatureFlags: (callback) => {
            const activeFlags = []
            for (const flag in FEATURE_FLAG_STATUS) {
                if (FEATURE_FLAG_STATUS[flag]) {
                    activeFlags.push(flag)
                }
            }
            callback(activeFlags)
            return () => {}
        },
    }))

    it('should get the feature flag when present', () => {
        let { result: result_1 } = renderHook(() => useFeatureFlagEnabled('example_feature_true'), {
            wrapper: given.renderProvider,
        })
        expect(result_1.current).toEqual(true)

        let { result: result_2 } = renderHook(() => useFeatureFlagEnabled('example_feature_false'), {
            wrapper: given.renderProvider,
        })
        expect(result_2.current).toEqual(false)

        let { result: result_3 } = renderHook(() => useFeatureFlagEnabled('example_feature_random'), {
            wrapper: given.renderProvider,
        })
        expect(result_3.current).toEqual(undefined)
    })

    it('should get the feature flag payload', () => {
        let { result: result_1 } = renderHook(() => useFeatureFlagEnabled('example_feature_1_payload'), {
            wrapper: given.renderProvider,
        })
        expect(result_1.current).toEqual(true)

        let { result: result_2 } = renderHook(() => useFeatureFlagPayload('example_feature_1_payload'), {
            wrapper: given.renderProvider,
        })
        expect(result_2.current).toEqual(FEATURE_FLAG_PAYLOADS.example_feature_1_payload)

        let { result: result_3 } = renderHook(() => useFeatureFlagPayload('example_feature_true'), {
            wrapper: given.renderProvider,
        })
        expect(result_3.current).toEqual(undefined)
    })

    it('should return the active feature flags', () => {
        let { result } = renderHook(() => useFeatureFlags(), {
            wrapper: given.renderProvider,
        })
        expect(result.current).toEqual(['example_feature_true', 'multivariate_feature', 'example_feature_1_payload'])
    })
})
