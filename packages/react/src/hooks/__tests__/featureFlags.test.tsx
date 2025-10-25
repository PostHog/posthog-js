import * as React from 'react'
import { renderHook } from '@testing-library/react-hooks'
import { PostHogProvider, PostHog } from '../../context'
import { useFeatureFlagPayload, useFeatureFlagVariantKey, useFeatureFlagEnabled, useActiveFeatureFlags } from '../index'

jest.useFakeTimers()

const ACTIVE_FEATURE_FLAGS = ['example_feature_true', 'multivariate_feature', 'example_feature_payload']

const FEATURE_FLAG_STATUS: Record<string, string | boolean> = {
    example_feature_true: true,
    example_feature_false: false,
    multivariate_feature: 'string-value',
    example_feature_payload: 'test',
}

const FEATURE_FLAG_PAYLOADS: Record<string, any> = {
    example_feature_payload: {
        id: 1,
        name: 'example_feature_1_payload',
        key: 'example_feature_1_payload',
    },
}

describe('useFeatureFlagPayload hook', () => {
    let posthog: PostHog
    let renderProvider: React.FC<{ children: React.ReactNode }>

    beforeEach(() => {
        posthog = {
            isFeatureEnabled: (flag: string) => !!FEATURE_FLAG_STATUS[flag],
            getFeatureFlag: (flag: string) => FEATURE_FLAG_STATUS[flag],
            getFeatureFlagPayload: (flag: string) => FEATURE_FLAG_PAYLOADS[flag],
            onFeatureFlags: (callback: any) => {
                const activeFlags: string[] = []
                for (const flag in FEATURE_FLAG_STATUS) {
                    if (FEATURE_FLAG_STATUS[flag]) {
                        activeFlags.push(flag)
                    }
                }
                callback(activeFlags)
                return () => {}
            },
            featureFlags: {
                getFlags: () => ACTIVE_FEATURE_FLAGS,
            } as unknown as PostHog['featureFlags'],
        } as unknown as PostHog

        // eslint-disable-next-line react/display-name
        renderProvider = ({ children }) => <PostHogProvider client={posthog}>{children}</PostHogProvider>
    })

    it.each([
        ['example_feature_true', true],
        ['example_feature_false', false],
        ['missing', false],
        ['multivariate_feature', true],
        ['example_feature_payload', true],
    ])('should get the boolean feature flag', (flag, expected) => {
        const { result } = renderHook(() => useFeatureFlagEnabled(flag), {
            wrapper: renderProvider,
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
        const { result } = renderHook(() => useFeatureFlagPayload(flag), {
            wrapper: renderProvider,
        })
        expect(result.current).toEqual(expected)
    })

    it('should return the active feature flags', () => {
        const { result } = renderHook(() => useActiveFeatureFlags(), {
            wrapper: renderProvider,
        })
        expect(result.current).toEqual(['example_feature_true', 'multivariate_feature', 'example_feature_payload'])
    })

    it.each([
        ['example_feature_true', true],
        ['example_feature_false', false],
        ['missing', undefined],
        ['multivariate_feature', 'string-value'],
    ])('should get the feature flag variant key', (flag, expected) => {
        const { result } = renderHook(() => useFeatureFlagVariantKey(flag), {
            wrapper: renderProvider,
        })
        expect(result.current).toEqual(expected)
    })
})
