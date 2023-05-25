import * as React from 'react'
import { renderHook } from '@testing-library/react-hooks'
import { PostHogProvider } from '../../context'
import { useFeatureFlagPayload, useFeatureFlagVariantKey, useFeatureFlagEnabled, useActiveFeatureFlags } from '../index'

jest.useFakeTimers()

const FEATURE_FLAG_STATUS = {
    example_feature_true: true,
    example_feature_false: false,
    multivariate_feature: 'string-value',
    example_feature_payload: 'test',
}

const FEATURE_FLAG_PAYLOADS = {
    example_feature_payload: {
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
        isFeatureEnabled: (flag) => !!FEATURE_FLAG_STATUS[flag],
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

    it.each([
        ['example_feature_true', true],
        ['example_feature_false', false],
        ['missing', false],
        ['multivariate_feature', true],
        ['example_feature_payload', true],
    ])('should get the boolean feature flag', (flag, expected) => {
        let { result } = renderHook(() => useFeatureFlagEnabled(flag), {
            wrapper: given.renderProvider,
        })
        expect(result.current).toEqual(expected)
    })

    it.each([
        ['example_feature_true', undefined],
        ['example_feature_false', undefined],
        ['missing', undefined],
        ['multivariate_feature', undefined],
        ['example_feature_payload', FEATURE_FLAG_PAYLOADS.example_feature_payload],
    ])('should get the payload feature flag', (flag, expected) => {
        let { result } = renderHook(() => useFeatureFlagPayload(flag), {
            wrapper: given.renderProvider,
        })
        expect(result.current).toEqual(expected)
    })

    it('should return the active feature flags', () => {
        let { result } = renderHook(() => useActiveFeatureFlags(), {
            wrapper: given.renderProvider,
        })
        expect(result.current).toEqual(['example_feature_true', 'multivariate_feature', 'example_feature_payload'])
    })

    it.each([
        ['example_feature_true', true],
        ['example_feature_false', false],
        ['missing', undefined],
        ['multivariate_feature', 'string-value'],
    ])('should get the feature flag variant key', (flag, expected) => {
        let { result } = renderHook(() => useFeatureFlagVariantKey(flag), {
            wrapper: given.renderProvider,
        })
        expect(result.current).toEqual(expected)
    })
})
