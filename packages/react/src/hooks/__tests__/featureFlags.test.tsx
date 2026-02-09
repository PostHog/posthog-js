import * as React from 'react'
import { renderHook, act } from '@testing-library/react'
import { PostHogProvider, PostHog } from '../../context'
import { isUndefined } from '../../utils/type-utils'
import {
    useFeatureFlagPayload,
    useFeatureFlagVariantKey,
    useFeatureFlagEnabled,
    useFeatureFlagResult,
    useActiveFeatureFlags,
} from '../index'

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

describe('feature flag hooks', () => {
    let posthog: PostHog
    let renderProvider: React.FC<{ children: React.ReactNode }>

    beforeEach(() => {
        posthog = {
            isFeatureEnabled: (flag: string) => !!FEATURE_FLAG_STATUS[flag],
            getFeatureFlag: (flag: string) => FEATURE_FLAG_STATUS[flag],
            getFeatureFlagPayload: (flag: string) => FEATURE_FLAG_PAYLOADS[flag],
            getFeatureFlagResult: (flag: string) => {
                const value = FEATURE_FLAG_STATUS[flag]
                if (isUndefined(value)) {
                    return undefined
                }
                return {
                    key: flag,
                    enabled: !!value,
                    variant: typeof value === 'string' ? value : undefined,
                    payload: FEATURE_FLAG_PAYLOADS[flag],
                }
            },
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
                hasLoadedFlags: true,
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

    describe('useFeatureFlagResult', () => {
        describe('bootstrap fallback', () => {
            function renderWithBootstrap(
                bootstrapFlags: Record<string, string | boolean>,
                bootstrapPayloads?: Record<string, any>
            ) {
                const client = {
                    getFeatureFlagResult: () => undefined,
                    onFeatureFlags: () => () => {},
                    config: {
                        bootstrap: {
                            featureFlags: bootstrapFlags,
                            featureFlagPayloads: bootstrapPayloads,
                        },
                    },
                    featureFlags: {
                        hasLoadedFlags: false,
                    } as unknown as PostHog['featureFlags'],
                } as unknown as PostHog

                // eslint-disable-next-line react/display-name
                const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
                    <PostHogProvider client={client}>{children}</PostHogProvider>
                )

                return wrapper
            }

            it('returns result for a boolean bootstrap flag', () => {
                const wrapper = renderWithBootstrap({ my_flag: true })
                const { result } = renderHook(() => useFeatureFlagResult('my_flag'), { wrapper })
                expect(result.current).toEqual({
                    key: 'my_flag',
                    enabled: true,
                    variant: undefined,
                    payload: undefined,
                })
            })

            it('returns result for a multivariate bootstrap flag', () => {
                const wrapper = renderWithBootstrap({ my_flag: 'variant-a' })
                const { result } = renderHook(() => useFeatureFlagResult('my_flag'), { wrapper })
                expect(result.current).toEqual({
                    key: 'my_flag',
                    enabled: true,
                    variant: 'variant-a',
                    payload: undefined,
                })
            })

            it('returns result for a disabled bootstrap flag', () => {
                const wrapper = renderWithBootstrap({ my_flag: false })
                const { result } = renderHook(() => useFeatureFlagResult('my_flag'), { wrapper })
                expect(result.current).toEqual({
                    key: 'my_flag',
                    enabled: false,
                    variant: undefined,
                    payload: undefined,
                })
            })

            it('includes payload from bootstrap data', () => {
                const payload = { color: 'blue' }
                const wrapper = renderWithBootstrap({ my_flag: true }, { my_flag: payload })
                const { result } = renderHook(() => useFeatureFlagResult('my_flag'), { wrapper })
                expect(result.current).toEqual({
                    key: 'my_flag',
                    enabled: true,
                    variant: undefined,
                    payload,
                })
            })

            it('returns undefined for a missing flag', () => {
                const wrapper = renderWithBootstrap({ other_flag: true })
                const { result } = renderHook(() => useFeatureFlagResult('my_flag'), { wrapper })
                expect(result.current).toBeUndefined()
            })
        })

        describe('flag updates', () => {
            it('re-renders when onFeatureFlags fires', () => {
                let capturedCallback: (() => void) | undefined
                const client = {
                    getFeatureFlagResult: jest.fn().mockReturnValue({
                        key: 'flag',
                        enabled: true,
                        variant: undefined,
                        payload: undefined,
                    }),
                    onFeatureFlags: (cb: () => void) => {
                        capturedCallback = cb
                        return () => {}
                    },
                    featureFlags: {
                        hasLoadedFlags: true,
                    } as unknown as PostHog['featureFlags'],
                } as unknown as PostHog

                // eslint-disable-next-line react/display-name
                const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
                    <PostHogProvider client={client}>{children}</PostHogProvider>
                )

                const { result } = renderHook(() => useFeatureFlagResult('flag'), { wrapper })
                expect(result.current).toEqual({
                    key: 'flag',
                    enabled: true,
                    variant: undefined,
                    payload: undefined,
                })
                ;(client.getFeatureFlagResult as jest.Mock).mockReturnValue({
                    key: 'flag',
                    enabled: true,
                    variant: 'new-variant',
                    payload: undefined,
                })

                act(() => {
                    capturedCallback!()
                })

                expect(result.current).toEqual({
                    key: 'flag',
                    enabled: true,
                    variant: 'new-variant',
                    payload: undefined,
                })
            })
        })

        describe('cleanup', () => {
            it('unsubscribes from onFeatureFlags on unmount', () => {
                const unsubscribe = jest.fn()
                const client = {
                    getFeatureFlagResult: () => undefined,
                    onFeatureFlags: () => unsubscribe,
                    featureFlags: {
                        hasLoadedFlags: true,
                    } as unknown as PostHog['featureFlags'],
                } as unknown as PostHog

                // eslint-disable-next-line react/display-name
                const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
                    <PostHogProvider client={client}>{children}</PostHogProvider>
                )

                const { unmount } = renderHook(() => useFeatureFlagResult('flag'), { wrapper })
                expect(unsubscribe).not.toHaveBeenCalled()

                unmount()
                expect(unsubscribe).toHaveBeenCalledTimes(1)
            })
        })
    })
})
