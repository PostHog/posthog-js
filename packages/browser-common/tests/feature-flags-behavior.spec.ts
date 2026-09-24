// @vitest-environment jsdom
import {
    filterActiveFeatureFlags,
    parseFlagsResponse as normalizeFlagsResponse,
    FeatureFlagError,
} from '../src/feature-flags'
import { isUndefined } from '@posthog/core'
import { createConfig, createFlagsClient, setupFlags, disposeFlags, type MutableConfig } from './helpers/feature-flags'
import type { TestClient } from './helpers/test-client'

beforeEach(() => {
    vi.useFakeTimers()
    window.POSTHOG_DEBUG = true
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
    disposeFlags()
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete window.POSTHOG_DEBUG
})

const parseFlagsResponse = (
    response: Parameters<typeof normalizeFlagsResponse>[0],
    persistence: { register(properties: Record<string, unknown>): void },
    currentFlags?: Parameters<typeof normalizeFlagsResponse>[1],
    currentPayloads?: Parameters<typeof normalizeFlagsResponse>[2],
    currentDetails?: Parameters<typeof normalizeFlagsResponse>[3],
    options?: Parameters<typeof normalizeFlagsResponse>[4]
): void => {
    const patch = normalizeFlagsResponse(response, currentFlags, currentPayloads, currentDetails, options)
    if (patch) {
        persistence.register(patch)
    }
}

describe('featureflags', () => {
    let client: TestClient
    let config: MutableConfig
    let featureFlags: any

    let mockWarn

    beforeEach(() => {
        window.POSTHOG_DEBUG = true

        client = createFlagsClient()
        config = createConfig()
        featureFlags = setupFlags(client, config)

        vi.spyOn(client, 'capture').mockReturnValue(undefined)
        mockWarn = vi.spyOn(window.console, 'warn').mockImplementation(() => {})

        client.kv.set({
            $feature_flag_payloads: {
                'beta-feature': {
                    some: 'payload',
                },
                'alpha-feature-2': 200,
            },
            $active_feature_flags: ['beta-feature', 'alpha-feature-2', 'multivariate-flag'],
            $enabled_feature_flags: {
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
                'disabled-flag': false,
            },
            $override_feature_flags: false,
        })

        client.kv.remove('$flag_call_reported')
    })

    it('should return flags from persistence even if /flags endpoint was not hit', () => {
        featureFlags._hasLoadedFlags = false

        expect(featureFlags.getFlags()).toEqual([
            'beta-feature',
            'alpha-feature-2',
            'multivariate-flag',
            'disabled-flag',
        ])
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
    })

    it('getAllFeatureFlags returns all flags as results, including disabled ones', () => {
        expect(featureFlags.getAllFeatureFlags()).toEqual([
            { key: 'beta-feature', enabled: true, variant: undefined, payload: { some: 'payload' } },
            { key: 'alpha-feature-2', enabled: true, variant: undefined, payload: 200 },
            { key: 'multivariate-flag', enabled: true, variant: 'variant-1', payload: undefined },
            { key: 'disabled-flag', enabled: false, variant: undefined, payload: undefined },
        ])
    })

    it('getAllFeatureFlags does not send a $feature_flag_called event or report a flag call', () => {
        featureFlags.getAllFeatureFlags()
        expect(client.capture).not.toHaveBeenCalledWith('$feature_flag_called', expect.anything())
        expect(client.kv.get('$flag_call_reported')).toEqual(undefined)
    })

    it('should return flag details from persistence even if /flags endpoint was not hit', () => {
        client.kv.set({
            $feature_flag_details: {
                'beta-feature': {
                    key: 'beta-feature',
                    enabled: true,
                    variant: 'beta-variant-1',
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 4,
                        payload: { payload: 'test' },
                        id: 1,
                        description: 'test-description',
                    },
                },
            },
            $override_feature_flags: false,
        })
        featureFlags._hasLoadedFlags = false

        expect(featureFlags.getFlagsWithDetails()).toEqual({
            'beta-feature': {
                key: 'beta-feature',
                enabled: true,
                variant: 'beta-variant-1',
                reason: {
                    code: 'test-reason',
                    condition_index: 1,
                    description: undefined,
                },
                metadata: {
                    version: 4,
                    payload: { payload: 'test' },
                    id: 1,
                    description: 'test-description',
                },
            },
        })
    })

    it('should warn if /flags endpoint was not hit and no flags exist', () => {
        ;(window as any).POSTHOG_DEBUG = true
        featureFlags._hasLoadedFlags = false
        client.kv.remove('$enabled_feature_flags')
        client.kv.remove('$active_feature_flags')

        expect(featureFlags.getFlags()).toEqual([])
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(undefined)
        expect(window.console.warn).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            'isFeatureEnabled for key "beta-feature" failed. Feature flags didn\'t load in time.'
        )

        mockWarn.mockClear()

        expect(featureFlags.getFeatureFlag('beta-feature')).toEqual(undefined)
        expect(window.console.warn).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            'getFeatureFlag for key "beta-feature" failed. Feature flags didn\'t load in time.'
        )
    })

    describe('fresh option', () => {
        it('should return undefined when fresh: true and flags have not been loaded from remote', () => {
            // Flags exist in persistence (from previous session)
            featureFlags._hasLoadedFlags = true
            // But they haven't been loaded from the server yet
            featureFlags._flagsLoadedFromRemote = false

            expect(featureFlags.getFeatureFlag('beta-feature')).toEqual(true)
            expect(featureFlags.getFeatureFlag('beta-feature', { fresh: true })).toEqual(undefined)

            expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
            expect(featureFlags.isFeatureEnabled('beta-feature', { fresh: true })).toEqual(undefined)

            expect(featureFlags.getFeatureFlagResult('beta-feature')).toEqual({
                key: 'beta-feature',
                enabled: true,
                variant: undefined,
                payload: { some: 'payload' },
            })
            expect(featureFlags.getFeatureFlagResult('beta-feature', { fresh: true })).toEqual(undefined)
        })

        it('should return flag value when fresh: true and flags have been loaded from remote', () => {
            featureFlags._hasLoadedFlags = true
            featureFlags._flagsLoadedFromRemote = true

            expect(featureFlags.getFeatureFlag('beta-feature', { fresh: true })).toEqual(true)
            expect(featureFlags.isFeatureEnabled('beta-feature', { fresh: true })).toEqual(true)
            expect(featureFlags.getFeatureFlagResult('beta-feature', { fresh: true })).toEqual({
                key: 'beta-feature',
                enabled: true,
                variant: undefined,
                payload: { some: 'payload' },
            })
        })

        it('should return undefined for fresh: true when only localStorage cache exists', () => {
            // Simulate: flags exist in localStorage from previous session
            // but no network request has completed yet
            featureFlags._hasLoadedFlags = false
            featureFlags._flagsLoadedFromRemote = false

            // Without fresh option, cached values are returned
            expect(featureFlags.getFeatureFlag('beta-feature')).toEqual(true)

            // With fresh option, undefined is returned
            expect(featureFlags.getFeatureFlag('beta-feature', { fresh: true })).toEqual(undefined)
        })
    })

    describe('defaultValue option', () => {
        it('should return defaultValue for a missing flag', () => {
            expect(featureFlags.isFeatureEnabled('random', { defaultValue: true })).toEqual(true)
            expect(featureFlags.isFeatureEnabled('random', { defaultValue: false })).toEqual(false)
        })

        it('should be ignored when the flag has a value', () => {
            expect(featureFlags.isFeatureEnabled('disabled-flag', { defaultValue: true })).toEqual(false)
            expect(featureFlags.isFeatureEnabled('multivariate-flag', { defaultValue: false })).toEqual(true)
        })

        it('should return defaultValue when flags have not loaded', () => {
            featureFlags._hasLoadedFlags = false
            client.kv.remove('$enabled_feature_flags')
            client.kv.remove('$active_feature_flags')

            expect(featureFlags.isFeatureEnabled('beta-feature', { defaultValue: true })).toEqual(true)
        })

        it('should return defaultValue when fresh: true and flags have not been loaded from remote', () => {
            featureFlags._hasLoadedFlags = true
            featureFlags._flagsLoadedFromRemote = false

            expect(featureFlags.isFeatureEnabled('beta-feature', { fresh: true, defaultValue: false })).toEqual(false)
        })
    })

    it('should return the right feature flag and call capture', () => {
        featureFlags._hasLoadedFlags = false

        expect(featureFlags.getFlags()).toEqual([
            'beta-feature',
            'alpha-feature-2',
            'multivariate-flag',
            'disabled-flag',
        ])
        expect(featureFlags.getFlagVariants()).toEqual({
            'alpha-feature-2': true,
            'beta-feature': true,
            'multivariate-flag': 'variant-1',
            'disabled-flag': false,
        })
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(featureFlags.isFeatureEnabled('random')).toEqual(undefined)
        expect(featureFlags.isFeatureEnabled('multivariate-flag')).toEqual(true)

        expect(client.capture).toHaveBeenCalledTimes(3)

        // It should not call `capture` on subsequent calls
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(client.capture).toHaveBeenCalledTimes(3)
        expect(client.kv.get('$flag_call_reported')).toEqual({
            'beta-feature': ['true'],
            'multivariate-flag': ['variant-1'],
            random: ['undefined'],
        })
    })

    it('should call capture for every different flag response', () => {
        featureFlags._hasLoadedFlags = true

        client.kv.set({
            $enabled_feature_flags: {
                'beta-feature': true,
            },
        })
        expect(featureFlags.getFlags()).toEqual(['beta-feature'])
        expect(featureFlags.getFlagVariants()).toEqual({
            'beta-feature': true,
        })
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)

        expect(client.kv.get('$flag_call_reported')).toEqual({ 'beta-feature': ['true'] })

        expect(client.capture).toHaveBeenCalledTimes(1)

        // It should not call `capture` on subsequent calls
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(client.capture).toHaveBeenCalledTimes(1)

        client.kv.set({
            $enabled_feature_flags: {},
        })
        featureFlags._hasLoadedFlags = false
        expect(featureFlags.getFlagVariants()).toEqual({})
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(undefined)
        // no extra capture call because flags haven't loaded yet.
        expect(client.capture).toHaveBeenCalledTimes(1)

        featureFlags._hasLoadedFlags = true
        client.kv.set({
            $enabled_feature_flags: { x: 'y' },
        })
        expect(featureFlags.getFlagVariants()).toEqual({ x: 'y' })
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(undefined)
        expect(client.capture).toHaveBeenCalledTimes(2)

        client.kv.set({
            $enabled_feature_flags: {
                'beta-feature': 'variant-1',
            },
        })
        expect(featureFlags.getFlagVariants()).toEqual({ 'beta-feature': 'variant-1' })
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(client.capture).toHaveBeenCalledTimes(3)

        expect(client.kv.get('$flag_call_reported')).toEqual({
            'beta-feature': ['true', 'undefined', 'variant-1'],
        })
    })

    describe('advanced_feature_flags_dedup_per_session', () => {
        let currentSessionId: string

        beforeEach(() => {
            currentSessionId = 'session-1'
            config.deduplicateCallsPerSession = true
            Object.defineProperty(client, 'session', { get: () => ({ sessionId: currentSessionId }) })
        })

        it('should re-emit $feature_flag_called when session changes', () => {
            featureFlags._hasLoadedFlags = true

            expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
            expect(client.capture).toHaveBeenCalledTimes(1)
            expect(client.kv.get('$flag_call_reported')).toEqual({ 'beta-feature': ['true'] })
            expect(client.kv.get('$flag_call_reported_session_id')).toEqual('session-1')

            // Same session: should NOT re-emit
            expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
            expect(client.capture).toHaveBeenCalledTimes(1)

            // New session: should re-emit
            currentSessionId = 'session-2'
            expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
            expect(client.capture).toHaveBeenCalledTimes(2)
            expect(client.kv.get('$flag_call_reported')).toEqual({ 'beta-feature': ['true'] })
            expect(client.kv.get('$flag_call_reported_session_id')).toEqual('session-2')
        })

        it('should not re-emit when option is off (default behavior)', () => {
            config.deduplicateCallsPerSession = false
            featureFlags._hasLoadedFlags = true

            expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
            expect(client.capture).toHaveBeenCalledTimes(1)

            // Simulate session change
            currentSessionId = 'session-2'
            expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
            expect(client.capture).toHaveBeenCalledTimes(1) // still deduped
        })

        it('should track different flag values within a session', () => {
            featureFlags._hasLoadedFlags = true

            expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
            expect(client.capture).toHaveBeenCalledTimes(1)

            // Change flag value within same session
            client.kv.set({
                $enabled_feature_flags: { 'beta-feature': 'variant-1' },
            })
            expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
            expect(client.capture).toHaveBeenCalledTimes(2)
            expect(client.kv.get('$flag_call_reported')).toEqual({
                'beta-feature': ['true', 'variant-1'],
            })
        })

        it('should reset flag reports for all flags on session change', () => {
            featureFlags._hasLoadedFlags = true

            expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
            expect(featureFlags.isFeatureEnabled('multivariate-flag')).toEqual(true)
            expect(client.capture).toHaveBeenCalledTimes(2)
            expect(client.kv.get('$flag_call_reported')).toEqual({
                'beta-feature': ['true'],
                'multivariate-flag': ['variant-1'],
            })

            // New session: all flags should re-emit
            currentSessionId = 'session-2'
            expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
            expect(client.capture).toHaveBeenCalledTimes(3)
            // Previous session's multivariate-flag entry is gone
            expect(client.kv.get('$flag_call_reported')).toEqual({ 'beta-feature': ['true'] })

            expect(featureFlags.isFeatureEnabled('multivariate-flag')).toEqual(true)
            expect(client.capture).toHaveBeenCalledTimes(4)
            expect(client.kv.get('$flag_call_reported')).toEqual({
                'beta-feature': ['true'],
                'multivariate-flag': ['variant-1'],
            })
        })

        it('should not clear flag reports when session id is empty', () => {
            featureFlags._hasLoadedFlags = true
            currentSessionId = ''

            expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
            expect(client.capture).toHaveBeenCalledTimes(1)

            // With empty session id, dedup should work normally (not reset)
            expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
            expect(client.capture).toHaveBeenCalledTimes(1)
        })
    })

    it('should return the right feature flag and not call capture', () => {
        featureFlags._hasLoadedFlags = true

        expect(featureFlags.isFeatureEnabled('beta-feature', { send_event: false })).toEqual(true)
        expect(client.capture).not.toHaveBeenCalled()
    })

    it('should return the right payload', () => {
        expect(featureFlags.getFeatureFlagPayload('beta-feature')).toEqual({
            some: 'payload',
        })
        expect(featureFlags.getFeatureFlagPayload('alpha-feature-2')).toEqual(200)
        expect(featureFlags.getFeatureFlagPayload('multivariate-flag')).toEqual(undefined)
        expect(client.capture).not.toHaveBeenCalled()
    })

    it('returns undefined for non-existent or disabled flags', () => {
        featureFlags._hasLoadedFlags = true

        expect(featureFlags.isFeatureEnabled('non-existent-flag')).toEqual(undefined)

        // Despite being non-existent, the event will still be captured
        expect(client.capture).toHaveBeenCalled()
    })

    describe('getFeatureFlagResult', () => {
        it('should return the result with flag value and payload for boolean flags', () => {
            featureFlags._hasLoadedFlags = true

            const result = featureFlags.getFeatureFlagResult('beta-feature')

            expect(result).toEqual({
                key: 'beta-feature',
                enabled: true,
                variant: undefined,
                payload: { some: 'payload' },
            })
            expect(client.capture).toHaveBeenCalledWith('$feature_flag_called', expect.any(Object))
        })

        it('should return the result with variant for multivariate flags', () => {
            featureFlags._hasLoadedFlags = true

            const result = featureFlags.getFeatureFlagResult('multivariate-flag')

            expect(result).toEqual({
                key: 'multivariate-flag',
                enabled: true,
                variant: 'variant-1',
                payload: undefined,
            })
            expect(client.capture).toHaveBeenCalled()
        })

        it('should return undefined for non-existent flags', () => {
            featureFlags._hasLoadedFlags = true

            const result = featureFlags.getFeatureFlagResult('non-existent-flag')

            expect(result).toEqual(undefined)
        })

        it('should return result with enabled false for disabled flags', () => {
            featureFlags._hasLoadedFlags = true

            const result = featureFlags.getFeatureFlagResult('disabled-flag')

            expect(result).toEqual({
                key: 'disabled-flag',
                enabled: false,
                variant: undefined,
                payload: undefined,
            })
        })

        it('should respect send_event option', () => {
            featureFlags._hasLoadedFlags = true

            const result = featureFlags.getFeatureFlagResult('beta-feature', { send_event: false })

            expect(result).toEqual({
                key: 'beta-feature',
                enabled: true,
                variant: undefined,
                payload: { some: 'payload' },
            })
            expect(client.capture).not.toHaveBeenCalled()
        })

        it('should return raw string payload when JSON parsing fails', () => {
            featureFlags._hasLoadedFlags = true
            client.kv.set({
                $feature_flag_payloads: {
                    'invalid-json-flag': 'not valid json {{{',
                },
                $enabled_feature_flags: {
                    'invalid-json-flag': true,
                },
            })

            const result = featureFlags.getFeatureFlagResult('invalid-json-flag', { send_event: false })

            expect(result).toEqual({
                key: 'invalid-json-flag',
                enabled: true,
                variant: undefined,
                payload: 'not valid json {{{',
            })
        })

        it('should return override result when flag is overridden', () => {
            featureFlags._hasLoadedFlags = true
            featureFlags.overrideFeatureFlags({
                flags: { 'overridden-flag': 'override-variant' },
                payloads: { 'overridden-flag': { custom: 'payload' } },
                suppressWarning: true,
            })

            const result = featureFlags.getFeatureFlagResult('overridden-flag', { send_event: false })

            expect(result).toEqual({
                key: 'overridden-flag',
                enabled: true,
                variant: 'override-variant',
                payload: { custom: 'payload' },
            })
        })

        it('should return disabled result when flag is overridden to false', () => {
            featureFlags._hasLoadedFlags = true
            featureFlags.overrideFeatureFlags({
                flags: { 'disabled-override-flag': false },
                suppressWarning: true,
            })

            const result = featureFlags.getFeatureFlagResult('disabled-override-flag', { send_event: false })

            expect(result).toEqual({
                key: 'disabled-override-flag',
                enabled: false,
                variant: undefined,
                payload: undefined,
            })
        })

        it('should return payload even when flag is overridden to false', () => {
            featureFlags._hasLoadedFlags = true
            featureFlags.overrideFeatureFlags({
                flags: { 'disabled-with-payload': false },
                payloads: { 'disabled-with-payload': { some: 'data' } },
                suppressWarning: true,
            })

            const result = featureFlags.getFeatureFlagResult('disabled-with-payload', { send_event: false })

            expect(result).toEqual({
                key: 'disabled-with-payload',
                enabled: false,
                variant: undefined,
                payload: { some: 'data' },
            })
        })

        it('should return disabled result when flag is overridden to undefined', () => {
            featureFlags._hasLoadedFlags = true
            featureFlags.overrideFeatureFlags({
                flags: { 'undefined-override-flag': undefined as any },
                suppressWarning: true,
            })

            const result = featureFlags.getFeatureFlagResult('undefined-override-flag', { send_event: false })

            expect(result).toEqual({
                key: 'undefined-override-flag',
                enabled: false,
                variant: undefined,
                payload: undefined,
            })
        })
    })

    describe('feature flag overrides', () => {
        beforeEach(() => {
            // Common setup used across multiple tests

            client.kv.remove([
                '$active_feature_flags',
                '$enabled_feature_flags',
                '$feature_flag_payloads',
                '$override_feature_flags',
                '$feature_flag_details',
            ])
            client.kv.set({
                $active_feature_flags: ['beta-feature', 'alpha-feature-2'],
                $enabled_feature_flags: {
                    'beta-feature': true,
                    'alpha-feature-2': true,
                },
                $feature_flag_payloads: {
                    'beta-feature': { original: 'payload' },
                    'alpha-feature-2': 123,
                },
            })
        })

        describe('deprecated override method', () => {
            it('supports basic flag overrides with warning behavior', () => {
                // Test default warning behavior
                featureFlags.override({
                    'beta-feature': false,
                })

                expect(featureFlags.getFlagVariants()).toEqual({
                    'beta-feature': false,
                    'alpha-feature-2': true,
                })
                expect(window.console.warn).toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flags!',
                    expect.any(Object)
                )

                // Test suppressed warning behavior
                mockWarn.mockClear()
                featureFlags.override(
                    {
                        'alpha-feature-2': false,
                    },
                    { suppressWarning: true }
                )

                expect(window.console.warn).not.toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flags!'
                )
                expect(featureFlags.getFlagVariants()).toEqual({
                    'beta-feature': true,
                    'alpha-feature-2': false,
                })
            })

            it('shows deprecation warning', () => {
                featureFlags.override({ 'beta-feature': false })
                expect(window.console.warn).toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    'override is deprecated. Please use overrideFeatureFlags instead.'
                )
            })
        })

        describe('new overrideFeatureFlags method', () => {
            it('supports basic flag overrides with warning behavior', () => {
                // Test default warning behavior
                featureFlags.overrideFeatureFlags({
                    flags: {
                        'beta-feature': false,
                    },
                })

                expect(featureFlags.getFlagVariants()).toEqual({
                    'beta-feature': false,
                    'alpha-feature-2': true,
                })
                expect(window.console.warn).toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flags!',
                    expect.any(Object)
                )

                // Test suppressed warning behavior
                mockWarn.mockClear()
                featureFlags.overrideFeatureFlags({
                    flags: {
                        'alpha-feature-2': false,
                    },
                    suppressWarning: true,
                })

                expect(window.console.warn).not.toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flags!'
                )
                expect(featureFlags.getFlagVariants()).toEqual({
                    'beta-feature': true,
                    'alpha-feature-2': false,
                })
            })

            it('supports basic flag details overrides with warning behavior', () => {
                client.kv.remove([
                    '$active_feature_flags',
                    '$enabled_feature_flags',
                    '$feature_flag_payloads',
                    '$override_feature_flags',
                    '$feature_flag_details',
                ])
                client.kv.set({
                    $feature_flag_details: {
                        'beta-feature': {
                            key: 'beta-feature',
                            enabled: true,
                            variant: 'beta-variant-1',
                            reason: {
                                code: 'test-reason',
                                condition_index: 1,
                                description: undefined,
                            },
                            metadata: undefined,
                        },
                        'alpha-feature-2': {
                            key: 'alpha-feature-2',
                            enabled: true,
                            variant: undefined,
                            reason: undefined,
                            metadata: { payload: 200 },
                        },
                    },
                })

                // Test default warning behavior
                featureFlags.overrideFeatureFlags({
                    flags: {
                        'beta-feature': false,
                    },
                })

                expect(featureFlags.getFeatureFlagDetails('beta-feature')).toEqual({
                    key: 'beta-feature',
                    enabled: false,
                    original_enabled: true,
                    variant: undefined,
                    original_variant: 'beta-variant-1',
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: undefined,
                })
                expect(window.console.warn).toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flags!',
                    expect.any(Object)
                )

                // Test suppressed warning behavior
                mockWarn.mockClear()
                featureFlags.overrideFeatureFlags({
                    flags: {
                        'alpha-feature-2': false,
                    },
                    suppressWarning: true,
                })

                expect(window.console.warn).not.toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flags!'
                )
                expect(featureFlags.getFeatureFlagDetails('alpha-feature-2')).toEqual({
                    key: 'alpha-feature-2',
                    enabled: false,
                    original_enabled: true,
                    variant: undefined,
                    reason: undefined,
                    metadata: { payload: 200 },
                })
            })

            it('supports payload overrides', () => {
                // Test with warning suppressed
                featureFlags.overrideFeatureFlags({
                    payloads: {
                        'beta-feature': { data: 'overridden' },
                        'alpha-feature-2': 456,
                    },
                    suppressWarning: true,
                })

                expect(featureFlags.getFlagPayloads()).toEqual({
                    'beta-feature': { data: 'overridden' },
                    'alpha-feature-2': 456,
                })

                expect(window.console.warn).not.toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flag payloads!'
                )

                // Test without suppressing warning
                featureFlags.overrideFeatureFlags({
                    payloads: {
                        'beta-feature': { data: 'overridden-again' },
                    },
                    suppressWarning: false,
                })

                expect(featureFlags.getFlagPayloads()).toEqual({
                    'beta-feature': { data: 'overridden-again' },
                    'alpha-feature-2': 123,
                })
                expect(window.console.warn).toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flag payloads!',
                    expect.any(Object)
                )
            })

            it('supports payload overrides with details', () => {
                client.kv.remove([
                    '$active_feature_flags',
                    '$enabled_feature_flags',
                    '$feature_flag_payloads',
                    '$override_feature_flags',
                    '$feature_flag_details',
                ])
                client.kv.set({
                    $feature_flag_details: {
                        'beta-feature': {
                            key: 'beta-feature',
                            enabled: true,
                            variant: 'beta-variant-1',
                            reason: {
                                code: 'test-reason',
                                condition_index: 1,
                                description: undefined,
                            },
                            metadata: {
                                version: 4,
                                payload: { payload: 'test' },
                                id: 1,
                                description: 'test-description',
                            },
                        },
                    },
                })

                featureFlags.overrideFeatureFlags({
                    payloads: {
                        'beta-feature': { data: 'overridden' },
                    },
                })

                expect(featureFlags.getFlagsWithDetails()).toEqual({
                    'beta-feature': {
                        key: 'beta-feature',
                        enabled: true,
                        variant: 'beta-variant-1',
                        reason: {
                            code: 'test-reason',
                            condition_index: 1,
                            description: undefined,
                        },
                        metadata: {
                            version: 4,
                            payload: { data: 'overridden' },
                            original_payload: { payload: 'test' },
                            id: 1,
                            description: 'test-description',
                        },
                    },
                })
            })

            it('clears overrides when passed false', () => {
                // Set some overrides first
                featureFlags.overrideFeatureFlags({
                    flags: {
                        'beta-feature': false,
                    },
                    payloads: {
                        'beta-feature': { overridden: 'payload' },
                    },
                })

                // Clear overrides
                featureFlags.overrideFeatureFlags(false)

                expect(featureFlags.getFlagVariants()).toEqual({
                    'beta-feature': true,
                    'alpha-feature-2': true,
                })
                expect(featureFlags.getFlagPayloads()).toEqual({
                    'beta-feature': { original: 'payload' },
                    'alpha-feature-2': 123,
                })
            })

            it('clears structured flag and payload overrides independently or together', () => {
                const setOverrides = (): void => {
                    featureFlags.overrideFeatureFlags({
                        flags: { 'beta-feature': false },
                        payloads: { 'beta-feature': { overridden: 'payload' } },
                    })
                }

                setOverrides()
                featureFlags.overrideFeatureFlags({ flags: false })
                expect(featureFlags.getFlagVariants()['beta-feature']).toBe(true)
                expect(featureFlags.getFlagPayloads()['beta-feature']).toEqual({ overridden: 'payload' })

                setOverrides()
                featureFlags.overrideFeatureFlags({ payloads: false })
                expect(featureFlags.getFlagVariants()['beta-feature']).toBe(false)
                expect(featureFlags.getFlagPayloads()['beta-feature']).toEqual({ original: 'payload' })

                setOverrides()
                featureFlags.overrideFeatureFlags({ flags: false, payloads: false })
                expect(featureFlags.getFlagVariants()['beta-feature']).toBe(true)
                expect(featureFlags.getFlagPayloads()['beta-feature']).toEqual({ original: 'payload' })
            })

            it('includes overridden payload in feature flag called event', () => {
                featureFlags.overrideFeatureFlags({
                    flags: { 'beta-feature': true },
                    payloads: { 'beta-feature': { overridden: 'payload' } },
                })
                featureFlags._hasLoadedFlags = true

                featureFlags.getFeatureFlag('beta-feature')

                expect(client.capture).toHaveBeenCalledWith('$feature_flag_called', {
                    $feature_flag: 'beta-feature',
                    $feature_flag_response: true,
                    $feature_flag_payload: { overridden: 'payload' },
                    $feature_flag_bootstrapped_response: null,
                    $feature_flag_bootstrapped_payload: null,
                    $used_bootstrap_value: true,
                })
            })

            it('preserves falsy payload and bootstrap values in feature flag called events', () => {
                config.bootstrap = {
                    featureFlags: { 'beta-feature': false },
                    featureFlagPayloads: { 'beta-feature': false },
                }
                client.kv.set('$feature_flag_payloads', { 'beta-feature': false })
                client.capture = vi.fn()
                featureFlags._hasLoadedFlags = true

                featureFlags.getFeatureFlag('beta-feature')

                expect(client.capture).toHaveBeenCalledWith(
                    '$feature_flag_called',
                    expect.objectContaining({
                        $feature_flag_payload: false,
                        $feature_flag_bootstrapped_response: false,
                        $feature_flag_bootstrapped_payload: false,
                    })
                )
            })

            it('includes original values in feature flag called event when details are available', () => {
                client.kv.remove([
                    '$active_feature_flags',
                    '$enabled_feature_flags',
                    '$feature_flag_payloads',
                    '$override_feature_flags',
                    '$feature_flag_details',
                ])
                client.kv.set({
                    $feature_flag_details: {
                        'beta-feature': {
                            key: 'beta-feature',
                            enabled: false,
                            variant: undefined,
                            reason: undefined,
                            metadata: {
                                payload: { status: 'original' },
                            },
                        },
                        'alpha-feature-2': {
                            key: 'alpha-feature-2',
                            enabled: false,
                            variant: undefined,
                            reason: undefined,
                            metadata: undefined,
                        },
                        'multivariate-flag': {
                            key: 'multivariate-flag',
                            enabled: true,
                            variant: 'multivariate-variant-1',
                            reason: undefined,
                            metadata: undefined,
                        },
                    },
                })
                featureFlags.overrideFeatureFlags({
                    flags: { 'beta-feature': true, 'alpha-feature-2': 'variant-1', 'multivariate-flag': false },
                    payloads: { 'beta-feature': { overridden: { status: 'overridden' } } },
                })
                featureFlags._hasLoadedFlags = true

                featureFlags.getFeatureFlag('beta-feature')

                expect(client.capture).toHaveBeenCalledWith('$feature_flag_called', {
                    $feature_flag: 'beta-feature',
                    $feature_flag_response: true,
                    $feature_flag_payload: { overridden: { status: 'overridden' } },
                    $feature_flag_bootstrapped_response: null,
                    $feature_flag_bootstrapped_payload: null,
                    $used_bootstrap_value: true,
                    $feature_flag_original_response: false,
                    $feature_flag_original_payload: { status: 'original' },
                    $feature_flag_request_id: undefined,
                })

                client.capture.mockClear()

                featureFlags.getFeatureFlag('alpha-feature-2')

                expect(client.capture).toHaveBeenCalledWith('$feature_flag_called', {
                    $feature_flag: 'alpha-feature-2',
                    $feature_flag_response: 'variant-1',
                    $feature_flag_payload: null,
                    $feature_flag_bootstrapped_response: null,
                    $feature_flag_bootstrapped_payload: null,
                    $used_bootstrap_value: true,
                    $feature_flag_original_response: false,
                    $feature_flag_request_id: undefined,
                })

                client.capture.mockClear()

                featureFlags.getFeatureFlag('multivariate-flag')

                expect(client.capture).toHaveBeenCalledWith('$feature_flag_called', {
                    $feature_flag: 'multivariate-flag',
                    $feature_flag_response: false,
                    $feature_flag_payload: null,
                    $feature_flag_bootstrapped_response: null,
                    $feature_flag_bootstrapped_payload: null,
                    $used_bootstrap_value: true,
                    $feature_flag_original_response: 'multivariate-variant-1',
                    $feature_flag_request_id: undefined,
                })
            })
        })

        describe('plain array and object shorthand forms', () => {
            it.each([
                ['plain array', ['beta-feature', 'alpha-feature-2'], { 'beta-feature': true, 'alpha-feature-2': true }],
                [
                    'plain object',
                    { 'beta-feature': 'variant-1', 'alpha-feature-2': false },
                    { 'beta-feature': 'variant-1', 'alpha-feature-2': false },
                ],
            ])('supports %s shorthand form for flag overrides', (_, input, expected) => {
                featureFlags.overrideFeatureFlags(input as any)
                expect(featureFlags.getFlagVariants()).toEqual(expected)
            })

            it('plain object does not affect payloads', () => {
                featureFlags.overrideFeatureFlags({ 'beta-feature': 'variant-1' })

                expect(featureFlags.getFlagVariants()).toEqual({
                    'beta-feature': 'variant-1',
                    'alpha-feature-2': true,
                })
                expect(featureFlags.getFlagPayloads()).toEqual({
                    'beta-feature': { original: 'payload' },
                    'alpha-feature-2': 123,
                })
            })
        })

        describe('callback behavior', () => {
            let callbackSpy: vi.Mock

            beforeEach(() => {
                callbackSpy = vi.fn()
                featureFlags.onFeatureFlags(callbackSpy)
            })

            it('triggers callback with feature flag changes', () => {
                featureFlags.overrideFeatureFlags({
                    flags: {
                        'beta-feature': false,
                    },
                })
                expect(callbackSpy).toHaveBeenCalledWith(
                    ['alpha-feature-2'],
                    { 'alpha-feature-2': true },
                    expect.any(Object)
                )

                callbackSpy.mockClear()

                featureFlags.overrideFeatureFlags({
                    flags: {
                        'beta-feature': false,
                        'alpha-feature-2': 'variant-1',
                    },
                })

                expect(callbackSpy).toHaveBeenCalledWith(
                    ['alpha-feature-2'],
                    { 'alpha-feature-2': 'variant-1' },
                    expect.any(Object)
                )
            })
        })
    })

    describe('_callFlagsEndpoint via reloadFeatureFlags', () => {
        it('should call /flags via reloadFeatureFlags', async () => {
            featureFlags.reloadFeatureFlags()
            await vi.runOnlyPendingTimersAsync()

            expect(client.sendRequest).toHaveBeenCalledTimes(1)
            expect(client.sendRequest.mock.calls[0][1]).toEqual(
                expect.objectContaining({ method: 'POST', sentAt: 'body' })
            )
            expect(client.sendRequest.mock.calls[0][1].body.disable_flags).toBe(undefined)
        })

        it('builds a representative flags request', async () => {
            client.groups = { organization: 'org-42', project: 'project-7' }
            client.deviceId = 'device-123'
            featureFlags.setAnonymousDistinctId('anonymous-456')
            featureFlags.setPersonPropertiesForFlags({ plan: 'enterprise', seats: 25 }, false)
            featureFlags.setGroupPropertiesForFlags(
                {
                    organization: { industry: 'technology', employee_count: 120 },
                    project: { region: 'eu-west' },
                },
                false
            )
            config.evaluationContexts = ['production', 'web']
            config.flagKeys = ['checkout-redesign', 'new-dashboard']

            featureFlags.reloadFeatureFlags()
            await vi.runOnlyPendingTimersAsync()

            expect(client.sendRequest).toHaveBeenCalledTimes(1)
            const request = client.sendRequest.mock.calls[0][1]
            expect(client.sendRequest.mock.calls[0][0]).toBe('/flags/?v=2')
            expect(request.body.timezone).toEqual(expect.any(String))
            expect(request.body.person_properties.$lib_version).toEqual(expect.any(String))
            expect({
                ...request,
                body: {
                    ...request.body,
                    timezone: '<runtime-timezone>',
                    person_properties: {
                        ...request.body.person_properties,
                        $lib_version: '<sdk-version>',
                    },
                },
            }).toMatchSnapshot()
        })

        it('should call /flags with flags disabled if advanced_disable_feature_flags is set', async () => {
            config.featureFlagsDisabled = true
            // Call _callFlagsEndpoint directly because reloadFeatureFlags() returns early
            // when advanced_disable_feature_flags is true
            featureFlags._callFlagsEndpoint({ disableFlags: true })
            await vi.runOnlyPendingTimersAsync()

            expect(client.sendRequest).toHaveBeenCalledTimes(1)
            expect(client.sendRequest.mock.calls[0][1].body.disable_flags).toBe(true)
        })

        it('should always include timezone in request data', async () => {
            featureFlags.reloadFeatureFlags()
            await vi.runOnlyPendingTimersAsync()

            expect(client.sendRequest).toHaveBeenCalledTimes(1)
            expect(client.sendRequest.mock.calls[0][1].body.timezone).toBeDefined()
        })

        it('should call /flags with evaluation_contexts when configured', async () => {
            config.evaluationContexts = ['production', 'web']
            featureFlags.reloadFeatureFlags()
            await vi.runOnlyPendingTimersAsync()

            expect(client.sendRequest).toHaveBeenCalledTimes(1)
            expect(client.sendRequest.mock.calls[0][1].body.evaluation_contexts).toEqual(['production', 'web'])
        })

        it.each([
            [
                'configured with flag keys',
                ['beta-feature', 'checkout-redesign'],
                ['beta-feature', 'checkout-redesign'],
                0,
            ],
            ['configured as an empty array', [], [], 0],
            [
                'configured with invalid entries',
                ['beta-feature', '', null as any, 'checkout-redesign', '   '],
                ['beta-feature', 'checkout-redesign'],
                3,
            ],

            ['not configured', undefined, undefined, 0],
        ])(
            'should handle flag_keys when %s',
            async (_description, configuredFlagKeys, expectedFlagKeys, expectedErrors) => {
                const errorSpy = vi.spyOn(window.console, 'error').mockImplementation(() => {})
                if (!isUndefined(configuredFlagKeys)) {
                    config.flagKeys = configuredFlagKeys as any
                }

                featureFlags.reloadFeatureFlags()
                await vi.runOnlyPendingTimersAsync()

                expect(client.sendRequest).toHaveBeenCalledTimes(1)
                if (isUndefined(expectedFlagKeys)) {
                    expect(client.sendRequest.mock.calls[0][1].body).not.toHaveProperty('flag_keys')
                } else {
                    expect(client.sendRequest.mock.calls[0][1].body.flag_keys).toEqual(expectedFlagKeys)
                }
                expect(errorSpy).toHaveBeenCalledTimes(expectedErrors as number)

                errorSpy.mockRestore()
            }
        )

        it('should replace existing flags with the flag_keys response', async () => {
            const requestedFlagDetail = {
                key: 'checkout-redesign',
                enabled: true,
                variant: undefined,
                reason: { code: 'condition_match', condition_index: 0, description: undefined },
                metadata: { id: 42, version: 1, payload: undefined, description: undefined },
            }
            const unrequestedFlagDetail = {
                ...requestedFlagDetail,
                key: 'other-flag',
                metadata: { id: 43, version: 1, payload: undefined, description: undefined },
            }

            featureFlags.receivedFeatureFlags({
                flags: {
                    'checkout-redesign': requestedFlagDetail,
                    'other-flag': unrequestedFlagDetail,
                },
            })
            expect(client.kv.get('$enabled_feature_flags')).toEqual({
                'checkout-redesign': true,
                'other-flag': true,
            })

            config.flagKeys = ['checkout-redesign']
            client.sendRequest = vi.fn().mockImplementation(async () => ({
                statusCode: 200,
                json: {
                    flags: {
                        'checkout-redesign': requestedFlagDetail,
                    },
                },
            }))

            featureFlags.reloadFeatureFlags()
            await vi.runOnlyPendingTimersAsync()

            expect(client.kv.get('$enabled_feature_flags')).toEqual({
                'checkout-redesign': true,
            })
        })

        it('should not include evaluation_contexts when not configured', async () => {
            featureFlags.reloadFeatureFlags()
            await vi.runOnlyPendingTimersAsync()

            expect(client.sendRequest).toHaveBeenCalledTimes(1)
            expect(client.sendRequest.mock.calls[0][1].body.evaluation_contexts).toBe(undefined)
        })

        it('should not include evaluation_contexts when configured as empty array', async () => {
            config.evaluationContexts = []
            featureFlags.reloadFeatureFlags()
            await vi.runOnlyPendingTimersAsync()

            expect(client.sendRequest).toHaveBeenCalledTimes(1)
            expect(client.sendRequest.mock.calls[0][1].body.evaluation_contexts).toBe(undefined)
        })

        describe('status 0 circuit breaker', () => {
            const setOnline = (value: boolean) => {
                Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
            }

            const reloadWith = async (statusCode: number) => {
                client.sendRequest.mockImplementationOnce(async () => ({
                    statusCode,
                    json: statusCode === 200 ? {} : null,
                }))

                featureFlags.reloadFeatureFlags()
                await vi.advanceTimersByTimeAsync(10)
            }

            afterEach(() => {
                delete (window.navigator as any).onLine
            })

            it('stops refreshing feature flags after 3 consecutive online status-0 failures', async () => {
                for (let i = 0; i < 3; i++) {
                    await reloadWith(0)
                }
                expect(client.sendRequest).toHaveBeenCalledTimes(3)

                await reloadWith(0)

                expect(client.sendRequest).toHaveBeenCalledTimes(3)
            })

            it('resets the status-0 budget after any HTTP response', async () => {
                await reloadWith(0)
                await reloadWith(0)
                await reloadWith(500)
                await reloadWith(0)
                await reloadWith(0)

                await reloadWith(0)

                expect(client.sendRequest).toHaveBeenCalledTimes(6)
            })

            it('does not count status-0 failures while the browser reports itself offline', async () => {
                setOnline(false)
                for (let i = 0; i < 3; i++) {
                    await reloadWith(0)
                }
                setOnline(true)

                await reloadWith(0)

                expect(client.sendRequest).toHaveBeenCalledTimes(4)
            })

            it('retries on the online event', async () => {
                for (let i = 0; i < 3; i++) {
                    await reloadWith(0)
                }
                await reloadWith(0)
                expect(client.sendRequest).toHaveBeenCalledTimes(3)

                client.sendRequest.mockImplementationOnce(async () => ({ statusCode: 0, json: null }))
                window.dispatchEvent(new Event('online'))
                await vi.advanceTimersByTimeAsync(10)

                expect(client.sendRequest).toHaveBeenCalledTimes(4)
            })

            it('removes the online event listener on dispose', () => {
                const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

                featureFlags.dispose()

                expect(removeEventListenerSpy).toHaveBeenCalledWith('online', featureFlags['_onOnline'])
                removeEventListenerSpy.mockRestore()
            })
        })
    })

    describe('onFeatureFlags', () => {
        beforeEach(() => {
            client.sendRequest = vi.fn().mockImplementation(async () => ({
                statusCode: 200,
                json: {
                    featureFlags: {
                        first: 'variant-1',
                        second: true,
                        third: false,
                    },
                },
            }))
        })

        it('onFeatureFlags should not be called immediately if feature flags not loaded', async () => {
            let called = false
            let _flags = []
            let _variants = {}
            let _error = undefined

            featureFlags.onFeatureFlags((flags, variants, errors) => {
                called = true
                _flags = flags
                _variants = variants
                _error = errors?.errorsLoading
            })
            expect(called).toEqual(false)

            featureFlags.setAnonymousDistinctId('rando_id')
            featureFlags.reloadFeatureFlags()

            await vi.runAllTimersAsync()
            expect(called).toEqual(true)
            expect(_error).toEqual(false)
            expect(_flags).toEqual(['first', 'second'])
            expect(_variants).toEqual({
                first: 'variant-1',
                second: true,
            })
        })

        it('onFeatureFlags callback should be called immediately if feature flags were loaded', () => {
            featureFlags._hasLoadedFlags = true
            let called = false
            featureFlags.onFeatureFlags(() => (called = true))
            expect(called).toEqual(true)

            called = false
        })

        it('onFeatureFlags should not return flags that are off', () => {
            featureFlags._hasLoadedFlags = true
            let _flags = []
            let _variants = {}
            featureFlags.onFeatureFlags((flags, variants) => {
                _flags = flags
                _variants = variants
            })

            expect(_flags).toEqual(['beta-feature', 'alpha-feature-2', 'multivariate-flag'])
            expect(_variants).toEqual({
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            })
        })

        it('onFeatureFlags should return function to unsubscribe the function from onFeatureFlags', async () => {
            let called = false

            const unsubscribe = featureFlags.onFeatureFlags(() => {
                called = true
            })

            featureFlags.setAnonymousDistinctId('rando_id')
            featureFlags.reloadFeatureFlags()
            await vi.runAllTimersAsync()

            expect(called).toEqual(true)

            called = false

            unsubscribe()

            featureFlags.setAnonymousDistinctId('rando_id')
            featureFlags.reloadFeatureFlags()
            await vi.runAllTimersAsync()

            expect(called).toEqual(false)
        })

        it('should isolate a throwing callback so later callbacks still fire', () => {
            featureFlags._hasLoadedFlags = true

            const throwingCallback = vi.fn(() => {
                throw new Error('user callback blew up')
            })
            const laterCallback = vi.fn()

            featureFlags.onFeatureFlags(throwingCallback)
            featureFlags.onFeatureFlags(laterCallback)

            // Both are called immediately since flags are already loaded, so reset before re-firing.
            throwingCallback.mockClear()
            laterCallback.mockClear()

            expect(() => featureFlags._fireFeatureFlagsCallbacks()).not.toThrow()

            expect(throwingCallback).toHaveBeenCalledTimes(1)
            // The later callback still fires even though the earlier one threw.
            expect(laterCallback).toHaveBeenCalledTimes(1)
        })
    })

    describe('earlyAccessFeatures', () => {
        // actually early access feature response
        const EARLY_ACCESS_FEATURE_FIRST = {
            name: 'first',
            description: 'first description',
            stage: 'alpha',
            imageUrl: null,
            documentationUrl: 'http://example.com',
            flagKey: 'first-flag',
        }

        const EARLY_ACCESS_FEATURE_SECOND = {
            name: 'second',
            description: 'second description',
            stage: 'alpha',
            imageUrl: null,
            documentationUrl: 'http://example.com',
            flagKey: 'second-flag',
        }

        beforeEach(() => {
            client.sendRequest = vi.fn().mockImplementation(async () => ({
                statusCode: 200,
                json: {
                    earlyAccessFeatures: [EARLY_ACCESS_FEATURE_FIRST],
                },
            }))
        })

        it('getEarlyAccessFeatures requests early access features if not present', async () => {
            const callback = vi.fn()
            featureFlags.getEarlyAccessFeatures(callback)
            await vi.runAllTimersAsync()
            expect(callback).toHaveBeenCalledWith([EARLY_ACCESS_FEATURE_FIRST])

            expect(client.sendRequest).toHaveBeenCalledWith(
                '/api/early_access_features/?token=random fake token',
                expect.objectContaining({
                    method: 'GET',
                    sentAt: 'query',
                })
            )
            expect(client.sendRequest).toHaveBeenCalledTimes(1)

            expect(client.kv.get('$early_access_features')).toEqual([EARLY_ACCESS_FEATURE_FIRST])

            client.sendRequest = vi.fn().mockImplementation(async () => ({
                statusCode: 200,
                json: {
                    earlyAccessFeatures: [EARLY_ACCESS_FEATURE_SECOND],
                },
            }))

            // Request again from the cache.
            callback.mockClear()
            featureFlags.getEarlyAccessFeatures(callback)
            await vi.runAllTimersAsync()
            expect(callback).toHaveBeenCalledWith([EARLY_ACCESS_FEATURE_FIRST])
            expect(client.sendRequest).toHaveBeenCalledTimes(0)
        })

        it('getEarlyAccessFeatures force reloads early access features when asked to', async () => {
            const callback = vi.fn()
            featureFlags.getEarlyAccessFeatures(callback)
            await vi.runAllTimersAsync()
            expect(callback).toHaveBeenCalledWith([EARLY_ACCESS_FEATURE_FIRST])

            expect(client.sendRequest).toHaveBeenCalledWith(
                '/api/early_access_features/?token=random fake token',
                expect.objectContaining({
                    method: 'GET',
                    sentAt: 'query',
                })
            )
            expect(client.sendRequest).toHaveBeenCalledTimes(1)

            expect(client.kv.get('$early_access_features')).toEqual([EARLY_ACCESS_FEATURE_FIRST])

            client.sendRequest = vi.fn().mockImplementation(async () => ({
                statusCode: 200,
                json: {
                    earlyAccessFeatures: [EARLY_ACCESS_FEATURE_SECOND],
                },
            }))

            // Request again with a forced reload.
            callback.mockClear()
            featureFlags.getEarlyAccessFeatures(callback, true)
            await vi.runAllTimersAsync()
            expect(callback).toHaveBeenCalledWith([EARLY_ACCESS_FEATURE_SECOND])
            expect(client.sendRequest).toHaveBeenCalledTimes(1)
        })

        it('getEarlyAccessFeatures can request specific stages', async () => {
            const callback = vi.fn()
            featureFlags.getEarlyAccessFeatures(callback, false, ['concept', 'beta'])
            await vi.runAllTimersAsync()
            expect(callback).toHaveBeenCalledWith([EARLY_ACCESS_FEATURE_FIRST])

            expect(client.sendRequest).toHaveBeenCalledWith(
                '/api/early_access_features/?token=random fake token&stage=concept&stage=beta',
                expect.objectContaining({
                    method: 'GET',
                    sentAt: 'query',
                })
            )
        })

        it('continues requesting early access features when automatic flag requests are disabled', async () => {
            config.remoteRequestsDisabled = true
            const callback = vi.fn()

            featureFlags.getEarlyAccessFeatures(callback)
            await vi.runAllTimersAsync()

            expect(client.sendRequest).toHaveBeenCalledTimes(1)
            expect(callback).toHaveBeenCalledWith([EARLY_ACCESS_FEATURE_FIRST])
        })

        it('isolates early access feature callback failures', async () => {
            const callbackError = new Error('callback failed')
            const error = vi.spyOn(window.console, 'error').mockImplementation(() => {})

            featureFlags.getEarlyAccessFeatures(() => {
                throw callbackError
            })
            await vi.runAllTimersAsync()

            expect(error).toHaveBeenCalledWith(
                '[PostHog.js] [FeatureFlags]',
                'Early access feature callback failed',
                callbackError
            )
            expect(error).not.toHaveBeenCalledWith(
                '[PostHog.js] [FeatureFlags]',
                'Early access feature request failed',
                callbackError
            )
        })

        it('getEarlyAccessFeatures replaces existing features completely instead of merging', async () => {
            client.kv.set('$early_access_features', [
                EARLY_ACCESS_FEATURE_FIRST,
                { ...EARLY_ACCESS_FEATURE_SECOND, flagKey: 'old-feature' },
            ])
            const registerSpy = vi.spyOn(client.kv, 'set')

            const callback = vi.fn()
            featureFlags.getEarlyAccessFeatures(callback, true)
            await vi.runAllTimersAsync()
            expect(callback).toHaveBeenCalledWith([EARLY_ACCESS_FEATURE_FIRST])

            expect(registerSpy).toHaveBeenCalledWith({
                $early_access_features: [EARLY_ACCESS_FEATURE_FIRST],
            })
            expect(client.kv.get('$early_access_features')).toEqual([EARLY_ACCESS_FEATURE_FIRST])
            expect(client.kv.get('$early_access_features')).not.toContainEqual(
                expect.objectContaining({ flagKey: 'old-feature' })
            )
        })

        it('update enrollment should update the early access feature enrollment', () => {
            featureFlags.updateEarlyAccessFeatureEnrollment('first-flag', true)

            expect(client.capture).toHaveBeenCalledTimes(1)
            expect(client.capture).toHaveBeenCalledWith('$feature_enrollment_update', {
                $feature_enrollment: true,
                $feature_flag: 'first-flag',
                $set: {
                    '$feature_enrollment/first-flag': true,
                },
            })

            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
                // early access feature flag is added to list of flags
                'first-flag': true,
            })

            // now enrollment is turned off
            featureFlags.updateEarlyAccessFeatureEnrollment('first-flag', false)

            expect(client.capture).toHaveBeenCalledTimes(2)
            expect(client.capture).toHaveBeenCalledWith('$feature_enrollment_update', {
                $feature_enrollment: false,
                $feature_flag: 'first-flag',
                $set: {
                    '$feature_enrollment/first-flag': false,
                },
            })

            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
                // early access feature flag is added to list of flags
                'first-flag': false,
            })
        })

        it('update enrollment with stage should include stage in event', () => {
            featureFlags.updateEarlyAccessFeatureEnrollment('stage-flag', true, 'beta')

            expect(client.capture).toHaveBeenCalledTimes(1)
            expect(client.capture).toHaveBeenCalledWith('$feature_enrollment_update', {
                $feature_enrollment: true,
                $feature_flag: 'stage-flag',
                $feature_enrollment_stage: 'beta',
                $set: {
                    '$feature_enrollment/stage-flag': true,
                },
            })

            // Test with different stage
            featureFlags.updateEarlyAccessFeatureEnrollment('concept-flag', false, 'concept')

            expect(client.capture).toHaveBeenCalledTimes(2)
            expect(client.capture).toHaveBeenLastCalledWith('$feature_enrollment_update', {
                $feature_enrollment: false,
                $feature_flag: 'concept-flag',
                $feature_enrollment_stage: 'concept',
                $set: {
                    '$feature_enrollment/concept-flag': false,
                },
            })

            // Test without stage (backward compatibility)
            featureFlags.updateEarlyAccessFeatureEnrollment('no-stage-flag', true)

            expect(client.capture).toHaveBeenCalledTimes(3)
            expect(client.capture).toHaveBeenLastCalledWith('$feature_enrollment_update', {
                $feature_enrollment: true,
                $feature_flag: 'no-stage-flag',
                $set: {
                    '$feature_enrollment/no-stage-flag': true,
                },
            })
            // Should not have stage property when not provided
            expect(client.capture.mock.calls[2][1]).not.toHaveProperty('$feature_enrollment_stage')
        })

        it('reloading flags after update enrollment should send properties', async () => {
            featureFlags.updateEarlyAccessFeatureEnrollment('x-flag', true)

            expect(client.capture).toHaveBeenCalledTimes(1)
            expect(client.capture).toHaveBeenCalledWith('$feature_enrollment_update', {
                $feature_enrollment: true,
                $feature_flag: 'x-flag',
                $set: {
                    '$feature_enrollment/x-flag': true,
                },
            })

            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
                // early access feature flag is added to list of flags
                'x-flag': true,
            })

            featureFlags.reloadFeatureFlags()
            await vi.runAllTimersAsync()
            // check the request sent person properties
            expect(client.sendRequest.mock.calls[0][1].body).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: {},
                group_properties: undefined,
                person_properties: {
                    '$feature_enrollment/x-flag': true,
                    $lib: 'posthog-test',
                    $lib_version: expect.any(String),
                },
                timezone: expect.any(String),
            })
        })
    })

    describe('device_id in flags requests', () => {
        beforeEach(() => {
            // Clear persistence before each test in this suite
            client.deviceId = undefined
            client.kv.remove('$stored_person_properties')
            client.kv.remove('$stored_group_properties')

            client.sendRequest = vi.fn().mockImplementation(async () => ({
                statusCode: 200,
                json: {
                    featureFlags: {
                        first: 'variant-1',
                        second: true,
                    },
                },
            }))
        })

        afterEach(() => {
            // Clean up after each test
            client.deviceId = undefined
            client.kv.remove('$stored_person_properties')
            client.kv.remove('$stored_group_properties')
        })

        it('should include device_id in flags request when available', async () => {
            client.deviceId = 'test-device-uuid-123'

            featureFlags.reloadFeatureFlags()
            await vi.runAllTimersAsync()

            expect(client.sendRequest).toHaveBeenCalledTimes(1)
            expect(client.sendRequest.mock.calls[0][1].body).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                $device_id: 'test-device-uuid-123',
                groups: {},
                group_properties: undefined,
                person_properties: {
                    $lib: 'posthog-test',
                    $lib_version: expect.any(String),
                },
                timezone: expect.any(String),
            })
        })

        it('should omit device_id when it is undefined', async () => {
            // Don't register device_id at all
            featureFlags.reloadFeatureFlags()
            await vi.runAllTimersAsync()

            expect(client.sendRequest).toHaveBeenCalledTimes(1)
            expect(client.sendRequest.mock.calls[0][1].body).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: {},
                group_properties: undefined,
                person_properties: {
                    $lib: 'posthog-test',
                    $lib_version: expect.any(String),
                },
                timezone: expect.any(String),
            })
            expect(client.sendRequest.mock.calls[0][1].body).not.toHaveProperty('$device_id')
        })

        it('should include device_id along with $anon_distinct_id on identify', async () => {
            client.deviceId = 'device-uuid-456'

            featureFlags.setAnonymousDistinctId('anon_id_789')
            featureFlags.reloadFeatureFlags()
            await vi.runAllTimersAsync()

            expect(client.sendRequest).toHaveBeenCalledTimes(1)
            expect(client.sendRequest.mock.calls[0][1].body).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $device_id: 'device-uuid-456',
                $anon_distinct_id: 'anon_id_789',
                groups: {},
                group_properties: undefined,
                person_properties: {
                    $lib: 'posthog-test',
                    $lib_version: expect.any(String),
                },
                timezone: expect.any(String),
            })
        })

        it('should include device_id with person_properties', async () => {
            client.deviceId = 'device-uuid-999'

            featureFlags.setPersonPropertiesForFlags({ plan: 'pro', beta_tester: true })
            await vi.runAllTimersAsync()

            expect(client.sendRequest).toHaveBeenCalledTimes(1)
            expect(client.sendRequest.mock.calls[0][1].body).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                $device_id: 'device-uuid-999',
                groups: {},
                group_properties: undefined,
                person_properties: {
                    plan: 'pro',
                    beta_tester: true,
                    $lib: 'posthog-test',
                    $lib_version: expect.any(String),
                },
                timezone: expect.any(String),
            })
        })

        it('should include device_id with group_properties', async () => {
            client.deviceId = 'device-uuid-888'

            featureFlags.setGroupPropertiesForFlags({ company: { name: 'Acme', seats: 50 } })
            await vi.runAllTimersAsync()

            expect(client.sendRequest).toHaveBeenCalledTimes(1)
            expect(client.sendRequest.mock.calls[0][1].body).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                $device_id: 'device-uuid-888',
                groups: {},
                person_properties: {
                    $lib: 'posthog-test',
                    $lib_version: expect.any(String),
                },
                group_properties: { company: { name: 'Acme', seats: 50 } },
                timezone: expect.any(String),
            })
        })
    })

    describe('reloadFeatureFlags', () => {
        beforeEach(() => {
            client.sendRequest = vi.fn().mockImplementation(async () => ({
                statusCode: 200,
                json: {
                    featureFlags: {
                        first: 'variant-1',
                        second: true,
                    },
                },
            }))
        })

        it('on providing anonDistinctId', async () => {
            featureFlags.setAnonymousDistinctId('rando_id')
            featureFlags.reloadFeatureFlags()

            await vi.runAllTimersAsync()

            expect(featureFlags.getFlagVariants()).toEqual({
                first: 'variant-1',
                second: true,
            })

            // check the request sent $anon_distinct_id
            expect(client.sendRequest.mock.calls[0][1].body).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: 'rando_id',
                groups: {},
                group_properties: undefined,
                person_properties: {
                    $lib: 'posthog-test',
                    $lib_version: expect.any(String),
                },
                timezone: expect.any(String),
            })
        })

        it('on providing anonDistinctId and calling reload multiple times', async () => {
            featureFlags.setAnonymousDistinctId('rando_id')
            featureFlags.reloadFeatureFlags()
            featureFlags.reloadFeatureFlags()

            await vi.runAllTimersAsync()

            expect(featureFlags.getFlagVariants()).toEqual({
                first: 'variant-1',
                second: true,
            })

            // check the request sent $anon_distinct_id
            expect(client.sendRequest.mock.calls[0][1].body).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: 'rando_id',
                groups: {},
                group_properties: undefined,
                person_properties: {
                    $lib: 'posthog-test',
                    $lib_version: expect.any(String),
                },
                timezone: expect.any(String),
            })

            featureFlags.reloadFeatureFlags()
            featureFlags.reloadFeatureFlags()
            await vi.runAllTimersAsync()

            // check the request didn't send $anon_distinct_id the second time around
            expect(client.sendRequest.mock.calls[1][1].body).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: {},
                group_properties: undefined,
                person_properties: {
                    $lib: 'posthog-test',
                    $lib_version: expect.any(String),
                },
                timezone: expect.any(String),
            })

            featureFlags.reloadFeatureFlags()
            await vi.runAllTimersAsync()

            // check the request didn't send $anon_distinct_id the second time around
            expect(client.sendRequest.mock.calls[2][1].body).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: {},
                group_properties: undefined,
                person_properties: {
                    $lib: 'posthog-test',
                    $lib_version: expect.any(String),
                },
                timezone: expect.any(String),
            })
        })

        it('on providing personProperties runs reload automatically', async () => {
            featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' })

            await vi.runAllTimersAsync()

            expect(featureFlags.getFlagVariants()).toEqual({
                first: 'variant-1',
                second: true,
            })

            // check right compression is sent
            expect(client.sendRequest.mock.calls[0][1].compression).toEqual('best-available')

            // check the request sent person properties
            expect(client.sendRequest.mock.calls[0][1].body).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: {},
                group_properties: undefined,
                person_properties: {
                    a: 'b',
                    c: 'd',
                    $lib: 'posthog-test',
                    $lib_version: expect.any(String),
                },
                timezone: expect.any(String),
            })
        })

        it('on providing config advanced_disable_feature_flags', async () => {
            config.featureFlagsDisabled = true
            client.kv.set({
                $enabled_feature_flags: {
                    'beta-feature': true,
                    'random-feature': 'xatu',
                },
            })

            featureFlags.reloadFeatureFlags()
            await vi.runAllTimersAsync()

            expect(featureFlags.getFlagVariants()).toEqual({
                'beta-feature': true,
                'random-feature': 'xatu',
            })

            // check reload request was not sent
            expect(client.sendRequest).not.toHaveBeenCalled()

            // check the same for other ways to call reload flags

            featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' })

            await vi.runAllTimersAsync()

            expect(featureFlags.getFlagVariants()).toEqual({
                'beta-feature': true,
                'random-feature': 'xatu',
            })

            // check reload request was not sent
            expect(client.sendRequest).not.toHaveBeenCalled()
        })

        it('on providing config disable_compression', async () => {
            config.compression = undefined

            featureFlags.reloadFeatureFlags()
            await vi.runAllTimersAsync()

            expect(client.sendRequest.mock.calls[0][1].compression).toEqual(undefined)
        })
    })

    describe('override person and group properties', () => {
        beforeEach(() => {
            client.sendRequest = vi.fn().mockImplementation(async () => ({
                statusCode: 200,
                json: {
                    featureFlags: {
                        first: 'variant-1',
                        second: true,
                    },
                },
            }))
        })

        it('on providing personProperties updates properties successively', async () => {
            featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' })
            featureFlags.setPersonPropertiesForFlags({ x: 'y', c: 'e' })

            await vi.runAllTimersAsync()

            expect(featureFlags.getFlagVariants()).toEqual({
                first: 'variant-1',
                second: true,
            })

            // check the request sent person properties
            expect(client.sendRequest.mock.calls[0][1].body).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: {},
                group_properties: undefined,
                person_properties: {
                    a: 'b',
                    c: 'e',
                    x: 'y',
                    $lib: 'posthog-test',
                    $lib_version: expect.any(String),
                },
                timezone: expect.any(String),
            })
        })

        it('doesnt reload flags if explicitly asked not to', async () => {
            featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' }, false)

            await vi.runAllTimersAsync()

            // still old flags
            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
            })

            expect(client.sendRequest).not.toHaveBeenCalled()
        })

        it('resetPersonProperties resets all properties and reloads flags by default', async () => {
            featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' }, false)
            featureFlags.setPersonPropertiesForFlags({ x: 'y', c: 'e' }, false)
            await vi.runAllTimersAsync()

            expect(client.kv.get('$stored_person_properties')).toEqual({ a: 'b', c: 'e', x: 'y' })

            featureFlags.resetPersonPropertiesForFlags()
            await vi.runAllTimersAsync()

            expect(client.kv.get('$stored_person_properties')).toEqual(undefined)

            // check the request did not send person properties
            expect(client.sendRequest.mock.calls[0][1].body).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: {},
                group_properties: undefined,
                person_properties: {
                    $lib: 'posthog-test',
                    $lib_version: expect.any(String),
                },
                timezone: expect.any(String),
            })
        })

        it('doesnt reload flags when resetting person properties if explicitly asked not to', async () => {
            featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' }, false)
            await vi.runAllTimersAsync()

            expect(client.kv.get('$stored_person_properties')).toEqual({ a: 'b', c: 'd' })

            featureFlags.resetPersonPropertiesForFlags(false)
            await vi.runAllTimersAsync()

            expect(client.kv.get('$stored_person_properties')).toEqual(undefined)
            expect(client.sendRequest).not.toHaveBeenCalled()
        })

        it('coalesces the default reset reload with an explicit reloadFeatureFlags call', async () => {
            featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' }, false)
            await vi.runAllTimersAsync()

            expect(client.kv.get('$stored_person_properties')).toEqual({ a: 'b', c: 'd' })

            featureFlags.resetPersonPropertiesForFlags()
            featureFlags.reloadFeatureFlags()
            await vi.runAllTimersAsync()

            // this ensures backwards compatibility with users who would previously call
            // resetPersonPropertiesForFlags followed by reloadFeatureFlags. we will still
            // guarantee a single /flags request.
            expect(client.sendRequest).toHaveBeenCalledTimes(1)
            expect(client.sendRequest.mock.calls[0][1].body.person_properties).toEqual({
                $lib: 'posthog-test',
                $lib_version: expect.any(String),
            })
        })

        it('set_once properties skip keys that already exist in the cache', () => {
            featureFlags.resetPersonPropertiesForFlags(false)
            featureFlags.setPersonPropertiesForFlags({ $set_once: { first_date: '2025-01-01', plan: 'free' } }, false)

            expect(client.kv.get('$stored_person_properties')).toEqual({
                first_date: '2025-01-01',
                plan: 'free',
            })

            // Calling again with set_once should NOT overwrite existing keys
            featureFlags.setPersonPropertiesForFlags(
                { $set_once: { first_date: '2026-03-30', new_key: 'hello' } },
                false
            )

            expect(client.kv.get('$stored_person_properties')).toEqual({
                first_date: '2025-01-01',
                plan: 'free',
                new_key: 'hello',
            })
        })

        it('set properties overwrite existing keys even when set_once does not', () => {
            featureFlags.resetPersonPropertiesForFlags(false)
            featureFlags.setPersonPropertiesForFlags({ $set_once: { first_date: '2025-01-01' } }, false)

            expect(client.kv.get('$stored_person_properties')).toEqual({
                first_date: '2025-01-01',
            })

            // $set should overwrite, $set_once should not
            featureFlags.setPersonPropertiesForFlags(
                { $set: { first_date: 'overwritten' }, $set_once: { first_date: 'ignored-by-set-once' } },
                false
            )

            expect(client.kv.get('$stored_person_properties')).toEqual({
                first_date: 'overwritten',
            })
        })

        it('set_once properties are included in /flags request', async () => {
            featureFlags.resetPersonPropertiesForFlags(false)
            featureFlags.setPersonPropertiesForFlags(
                { $set: { plan: 'pro' }, $set_once: { first_date: '2025-01-01' } },
                false
            )

            expect(client.kv.get('$stored_person_properties')).toEqual({
                plan: 'pro',
                first_date: '2025-01-01',
            })

            featureFlags.reloadFeatureFlags()
            await vi.runAllTimersAsync()

            expect(client.sendRequest.mock.calls[0][1].body).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: {},
                group_properties: undefined,
                person_properties: {
                    plan: 'pro',
                    first_date: '2025-01-01',
                    $lib: 'posthog-test',
                    $lib_version: expect.any(String),
                },
                timezone: expect.any(String),
            })

            // Clean up to avoid leaking into subsequent tests
            featureFlags.resetPersonPropertiesForFlags(false)
        })

        it('on providing groupProperties updates properties successively', async () => {
            featureFlags.setGroupPropertiesForFlags({ orgs: { a: 'b', c: 'd' }, projects: { x: 'y', c: 'e' } })

            expect(client.kv.get('$stored_group_properties')).toEqual({
                orgs: { a: 'b', c: 'd' },
                projects: { x: 'y', c: 'e' },
            })

            await vi.runAllTimersAsync()

            expect(featureFlags.getFlagVariants()).toEqual({
                first: 'variant-1',
                second: true,
            })

            // check the request sent person properties
            expect(client.sendRequest.mock.calls[0][1].body).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: {},
                person_properties: {
                    $lib: 'posthog-test',
                    $lib_version: expect.any(String),
                },
                group_properties: { orgs: { a: 'b', c: 'd' }, projects: { x: 'y', c: 'e' } },
                timezone: expect.any(String),
            })
        })

        it('handles groupProperties updates', async () => {
            featureFlags.setGroupPropertiesForFlags({ orgs: { a: 'b', c: 'd' }, projects: { x: 'y', c: 'e' } })

            expect(client.kv.get('$stored_group_properties')).toEqual({
                orgs: { a: 'b', c: 'd' },
                projects: { x: 'y', c: 'e' },
            })

            featureFlags.setGroupPropertiesForFlags({ orgs: { w: '1' }, other: { z: '2' } })

            expect(client.kv.get('$stored_group_properties')).toEqual({
                orgs: { a: 'b', c: 'd', w: '1' },
                projects: { x: 'y', c: 'e' },
                other: { z: '2' },
            })

            featureFlags.resetGroupPropertiesForFlags('orgs')

            expect(client.kv.get('$stored_group_properties')).toEqual({
                orgs: {},
                projects: { x: 'y', c: 'e' },
                other: { z: '2' },
            })

            featureFlags.resetGroupPropertiesForFlags()

            expect(client.kv.get('$stored_group_properties')).toEqual(undefined)

            await vi.runAllTimersAsync()
        })

        it('doesnt reload group flags if explicitly asked not to', async () => {
            featureFlags.setGroupPropertiesForFlags({ orgs: { a: 'b', c: 'd' } }, false)

            await vi.runAllTimersAsync()

            // still old flags
            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
            })

            expect(client.sendRequest).not.toHaveBeenCalled()
        })
    })

    describe('when subsequent /flags?v=1 calls return partial results', () => {
        beforeEach(() => {
            client.sendRequest = vi.fn().mockImplementation(async () => ({
                statusCode: 200,
                json: {
                    featureFlags: { 'x-flag': 'x-value', 'feature-1': false },
                    errorsWhileComputingFlags: true,
                },
            }))
        })

        it('should return combined results', async () => {
            featureFlags.reloadFeatureFlags()

            await vi.runAllTimersAsync()

            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'multivariate-flag': 'variant-1',
                'x-flag': 'x-value',
                'feature-1': false,
                'disabled-flag': false,
            })
        })
    })

    describe('when subsequent /flags?v=2 calls return partial results', () => {
        beforeEach(() => {
            // Need to register v2 flags to test v2 behavior.
            client.kv.set({
                $feature_flag_payloads: {
                    'beta-feature': {
                        some: 'payload',
                    },
                    'alpha-feature-2': 200,
                },
                $active_feature_flags: ['beta-feature', 'alpha-feature-2', 'multivariate-flag'],
                $enabled_feature_flags: {
                    'beta-feature': true,
                    'alpha-feature-2': true,
                    'multivariate-flag': 'variant-1',
                    'disabled-flag': false,
                },
                $feature_flag_details: {
                    'beta-feature': {
                        key: 'beta-feature',
                        enabled: true,
                        variant: undefined,
                        metadata: { payload: { some: 'payload' } },
                    },
                    'alpha-feature-2': {
                        key: 'alpha-feature-2',
                        enabled: true,
                        variant: undefined,
                        metadata: { payload: 200 },
                    },
                    'multivariate-flag': {
                        key: 'multivariate-flag',
                        enabled: true,
                        variant: 'variant-1',
                        metadata: { payload: undefined },
                    },
                    'disabled-flag': {
                        key: 'disabled-flag',
                        enabled: false,
                        variant: undefined,
                        metadata: undefined,
                    },
                },
                $override_feature_flags: false,
            })
            client.sendRequest = vi.fn().mockImplementation(async () => ({
                statusCode: 200,
                json: {
                    flags: {
                        'x-flag': { key: 'x-flag', enabled: true, variant: 'x-value', metadata: undefined },
                        'feature-1': { key: 'feature-1', enabled: false, variant: undefined, metadata: undefined },
                    },
                    errorsWhileComputingFlags: true,
                },
            }))
        })

        it('should return combined results', async () => {
            featureFlags.reloadFeatureFlags()

            await vi.runAllTimersAsync()

            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'feature-1': false,
                'multivariate-flag': 'variant-1',
                'x-flag': 'x-value',
            })
        })
    })

    describe('when subsequent /flags?v=2 calls return failed flags with errorsWhileComputingFlags', () => {
        beforeEach(() => {
            client.kv.set({
                $feature_flag_payloads: {
                    'beta-feature': {
                        some: 'payload',
                    },
                    'alpha-feature-2': 200,
                    'x-flag': 'stale-payload',
                },
                $active_feature_flags: ['beta-feature', 'alpha-feature-2', 'multivariate-flag'],
                $enabled_feature_flags: {
                    'beta-feature': true,
                    'alpha-feature-2': true,
                    'multivariate-flag': 'variant-1',
                    'disabled-flag': false,
                },
                $feature_flag_details: {
                    'beta-feature': {
                        key: 'beta-feature',
                        enabled: true,
                        variant: undefined,
                        metadata: { payload: { some: 'payload' } },
                    },
                    'alpha-feature-2': {
                        key: 'alpha-feature-2',
                        enabled: true,
                        variant: undefined,
                        metadata: { payload: 200 },
                    },
                    'multivariate-flag': {
                        key: 'multivariate-flag',
                        enabled: true,
                        variant: 'variant-1',
                        metadata: { payload: undefined },
                    },
                    'disabled-flag': {
                        key: 'disabled-flag',
                        enabled: false,
                        variant: undefined,
                        metadata: undefined,
                    },
                },
                $override_feature_flags: false,
            })
            client.sendRequest = vi.fn().mockImplementation(async () => ({
                statusCode: 200,
                json: {
                    flags: {
                        'x-flag': {
                            key: 'x-flag',
                            enabled: true,
                            variant: 'x-value',
                            failed: false,
                            reason: { code: 'condition_match', description: 'Matched condition set 1' },
                            metadata: { id: 10, version: 1 },
                        },
                        'beta-feature': {
                            key: 'beta-feature',
                            enabled: false,
                            variant: undefined,
                            failed: true,
                            reason: { code: 'database_error', description: 'Database connection error' },
                            metadata: { id: 2, version: 1 },
                        },
                    },
                    errorsWhileComputingFlags: true,
                },
            }))
        })

        it('should filter out failed flags and preserve their cached values', async () => {
            featureFlags.reloadFeatureFlags()

            await vi.runAllTimersAsync()

            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true, // preserved from cache, not overwritten by failed evaluation
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
                'x-flag': 'x-value', // new successful flag merged in
            })
            expect(featureFlags.getFlagPayloads()).toEqual({
                'alpha-feature-2': 200,
                'beta-feature': { some: 'payload' },
            })
        })
    })

    describe('when subsequent /flags?v=1 calls return results without errors', () => {
        beforeEach(() => {
            client.sendRequest = vi.fn().mockImplementation(async () => ({
                statusCode: 200,
                json: {
                    featureFlags: { 'x-flag': 'x-value', 'feature-1': false },
                    errorsWhileComputingFlags: false,
                },
            }))
        })

        it('should return combined results', async () => {
            featureFlags.reloadFeatureFlags()

            await vi.runAllTimersAsync()

            expect(featureFlags.getFlagVariants()).toEqual({
                'x-flag': 'x-value',
                'feature-1': false,
            })
        })
    })

    describe('when /flags times out or errors out', () => {
        beforeEach(() => {
            client.sendRequest = vi.fn().mockImplementation(async () => ({
                statusCode: 500,
                text: 'Internal Server Error',
            }))
        })

        it('should not change the existing flags', async () => {
            client.kv.set({
                $enabled_feature_flags: {
                    'beta-feature': true,
                    'random-feature': 'xatu',
                },
            })

            featureFlags.reloadFeatureFlags()
            await vi.runAllTimersAsync()

            expect(featureFlags.getFlagVariants()).toEqual({
                'beta-feature': true,
                'random-feature': 'xatu',
            })
        })

        it('should call onFeatureFlags even when /flags errors out', async () => {
            let called = false
            let _flags = []
            let _variants = {}
            let _errors = undefined

            client.kv.set({
                $enabled_feature_flags: {},
            })

            featureFlags.onFeatureFlags((flags, variants, errors) => {
                called = true
                _flags = flags
                _variants = variants
                _errors = errors?.errorsLoading
            })
            expect(called).toEqual(false)

            featureFlags.reloadFeatureFlags()

            await vi.runAllTimersAsync()
            expect(called).toEqual(true)
            expect(_errors).toEqual(true)
            expect(_flags).toEqual([])
            expect(_variants).toEqual({})
        })

        it('should call onFeatureFlags with existing flags', async () => {
            let called = false
            let _flags = []
            let _variants = {}
            let _errors = undefined

            featureFlags.onFeatureFlags((flags, variants, errors) => {
                called = true
                _flags = flags
                _variants = variants
                _errors = errors?.errorsLoading
            })
            expect(called).toEqual(false)

            featureFlags.reloadFeatureFlags()

            await vi.runAllTimersAsync()
            expect(called).toEqual(true)
            expect(_errors).toEqual(true)
            expect(_flags).toEqual(['beta-feature', 'alpha-feature-2', 'multivariate-flag'])
            expect(_variants).toEqual({
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            })
        })

        it('should call onFeatureFlags with existing flags on timeouts', async () => {
            client.sendRequest = vi.fn().mockImplementation(async () => ({
                statusCode: 0,
                text: '',
            }))

            let called = false
            let _flags = []
            let _variants = {}
            let _errors = undefined

            featureFlags.onFeatureFlags((flags, variants, errors) => {
                called = true
                _flags = flags
                _variants = variants
                _errors = errors?.errorsLoading
            })
            expect(called).toEqual(false)

            featureFlags.reloadFeatureFlags()

            await vi.runAllTimersAsync()
            expect(called).toEqual(true)
            expect(_errors).toEqual(true)
            expect(_flags).toEqual(['beta-feature', 'alpha-feature-2', 'multivariate-flag'])
            expect(_variants).toEqual({
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            })
        })
    })

    describe('Feature Flag Request ID and Evaluated At', () => {
        const TEST_REQUEST_ID = 'test-request-id-123'
        const TEST_EVALUATED_AT = 1234567890

        it('saves requestId from /flags response', () => {
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                requestId: TEST_REQUEST_ID,
            })

            expect(client.kv.get('$feature_flag_request_id')).toEqual(TEST_REQUEST_ID)
        })

        it('saves evaluatedAt from /flags response', () => {
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                evaluatedAt: TEST_EVALUATED_AT,
            })

            expect(client.kv.get('$feature_flag_evaluated_at')).toEqual(TEST_EVALUATED_AT)
        })

        it('includes requestId in feature flag called event', () => {
            // Setup flags with requestId
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                requestId: TEST_REQUEST_ID,
            })
            featureFlags._hasLoadedFlags = true

            // Test flag call
            featureFlags.getFeatureFlag('test-flag')

            // Verify capture call includes requestId
            expect(client.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.objectContaining({
                    $feature_flag: 'test-flag',
                    $feature_flag_response: true,
                    $feature_flag_request_id: TEST_REQUEST_ID,
                })
            )
        })

        it('includes evaluatedAt in feature flag called event', () => {
            // Setup flags with evaluatedAt
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                evaluatedAt: TEST_EVALUATED_AT,
            })
            featureFlags._hasLoadedFlags = true

            // Test flag call
            featureFlags.getFeatureFlag('test-flag')

            // Verify capture call includes evaluatedAt
            expect(client.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.objectContaining({
                    $feature_flag: 'test-flag',
                    $feature_flag_response: true,
                    $feature_flag_evaluated_at: TEST_EVALUATED_AT,
                })
            )
        })

        it('captures rich feature flag called event properties', () => {
            // Setup flags with requestId and evaluatedAt
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: { 'test-flag': { layout: 'compact', max_items: 12 } },
                requestId: TEST_REQUEST_ID,
                evaluatedAt: TEST_EVALUATED_AT,
                flags: {
                    'test-flag': {
                        key: 'test-flag',
                        id: 23,
                        enabled: true,
                        variant: 'variant-1',
                        reason: {
                            description: 'Matched condition set 1',
                            code: 'test-code',
                            condition_index: 1,
                        },
                        metadata: {
                            id: 23,
                            version: 42,
                            description: 'Compact dashboard experiment',
                            payload: { layout: 'compact', max_items: 12 },
                            has_experiment: true,
                        },
                    },
                },
            })
            featureFlags._hasLoadedFlags = true
            featureFlags._flagsLoadedFromRemote = true
            client.kv.remove('$feature_flag_errors')

            // Test flag call
            featureFlags.getFeatureFlag('test-flag')

            expect(client.capture).toHaveBeenCalledTimes(1)
            expect(client.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.objectContaining({
                    $feature_flag: 'test-flag',
                    $feature_flag_response: 'variant-1',
                    $feature_flag_request_id: TEST_REQUEST_ID,
                    $feature_flag_evaluated_at: TEST_EVALUATED_AT,
                    $feature_flag_version: 42,
                    $feature_flag_reason: 'Matched condition set 1',
                    $feature_flag_id: 23,
                })
            )
            expect(client.capture.mock.calls[0]).toMatchSnapshot()
        })

        it('updates requestId when new /flags response is received', () => {
            // First /flags response
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                requestId: TEST_REQUEST_ID,
            })

            expect(client.kv.get('$feature_flag_request_id')).toEqual(TEST_REQUEST_ID)

            // Second /flags response with new ID
            const NEW_REQUEST_ID = 'new-request-id-456'
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                requestId: NEW_REQUEST_ID,
            })

            expect(client.kv.get('$feature_flag_request_id')).toEqual(NEW_REQUEST_ID)

            // Verify new ID is used in events
            featureFlags._hasLoadedFlags = true
            featureFlags.getFeatureFlag('test-flag')

            expect(client.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.objectContaining({
                    $feature_flag_request_id: NEW_REQUEST_ID,
                })
            )
        })

        it('updates evaluatedAt when new /flags response is received', () => {
            // First /flags response
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                evaluatedAt: TEST_EVALUATED_AT,
            })

            expect(client.kv.get('$feature_flag_evaluated_at')).toEqual(TEST_EVALUATED_AT)

            // Second /flags response with new timestamp
            const NEW_EVALUATED_AT = 9876543210
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                evaluatedAt: NEW_EVALUATED_AT,
            })

            expect(client.kv.get('$feature_flag_evaluated_at')).toEqual(NEW_EVALUATED_AT)

            // Verify new timestamp is used in events
            featureFlags._hasLoadedFlags = true
            featureFlags.getFeatureFlag('test-flag')

            expect(client.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.objectContaining({
                    $feature_flag_evaluated_at: NEW_EVALUATED_AT,
                })
            )
        })
    })

    describe('Feature Flag Has Experiment', () => {
        const receiveFlagWithMetadata = (metadata?: Record<string, any>) => {
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                flags: {
                    'test-flag': {
                        key: 'test-flag',
                        enabled: true,
                        variant: undefined,
                        reason: undefined,
                        metadata,
                    },
                },
            })
            featureFlags._hasLoadedFlags = true
        }

        it('includes $feature_flag_has_experiment true when server reports has_experiment true', () => {
            receiveFlagWithMetadata({ id: 1, version: 2, has_experiment: true })

            featureFlags.getFeatureFlag('test-flag')

            expect(client.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.objectContaining({
                    $feature_flag: 'test-flag',
                    $feature_flag_has_experiment: true,
                })
            )
        })

        it('includes $feature_flag_has_experiment false when server reports has_experiment false', () => {
            receiveFlagWithMetadata({ id: 1, version: 2, has_experiment: false })

            featureFlags.getFeatureFlag('test-flag')

            expect(client.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.objectContaining({
                    $feature_flag: 'test-flag',
                    $feature_flag_has_experiment: false,
                })
            )
        })

        it('omits $feature_flag_has_experiment when server omits has_experiment', () => {
            receiveFlagWithMetadata({ id: 1, version: 2 })

            featureFlags.getFeatureFlag('test-flag')

            expect(client.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.not.objectContaining({
                    $feature_flag_has_experiment: expect.anything(),
                })
            )
        })
    })

    describe('minimal flag called events gate persistence', () => {
        const receiveFlags = (response: Record<string, any>) => {
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                flags: {
                    'test-flag': {
                        key: 'test-flag',
                        enabled: true,
                        variant: undefined,
                        reason: undefined,
                        metadata: undefined,
                    },
                },
                ...response,
            })
        }

        it('flips the gate off when a new flags response omits the field', () => {
            receiveFlags({ minimalFlagCalledEvents: true })
            receiveFlags({})

            expect(client.kv.get('$minimal_flag_called_events')).toBe(false)
        })

        it('flips the gate off on a legacy v1 array response', () => {
            receiveFlags({ minimalFlagCalledEvents: true })
            featureFlags.receivedFeatureFlags({ featureFlags: ['test-flag'] } as any)

            expect(client.kv.get('$minimal_flag_called_events')).toBe(false)
        })
    })
})

describe('parseFlagsResponse', () => {
    let persistence

    beforeEach(() => {
        window.POSTHOG_DEBUG = true
        persistence = { register: vi.fn(), unregister: vi.fn() }
    })

    it('enables multivariate feature flags from /flags?v=2 response', () => {
        const flagsResponse = {
            featureFlags: {
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            },
            featureFlagPayloads: {
                'beta-feature': 300,
                'alpha-feature-2': 'fake-payload',
            },
        }
        vi.spyOn(window.console, 'warn').mockImplementation(() => {})

        parseFlagsResponse(flagsResponse, persistence)

        expect(persistence.register).toHaveBeenCalledWith({
            $minimal_flag_called_events: false,
            $active_feature_flags: ['beta-feature', 'alpha-feature-2', 'multivariate-flag'],
            $enabled_feature_flags: {
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            },
            $feature_flag_payloads: {
                'beta-feature': 300,
                'alpha-feature-2': 'fake-payload',
            },
            $feature_flag_details: {},
        })
        expect(window.console.warn).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            'Using an older version of the feature flags endpoint. Please upgrade your PostHog server to the latest version'
        )
    })

    it('preserves falsy payloads from detailed flag responses', () => {
        parseFlagsResponse(
            {
                flags: {
                    'beta-feature': {
                        key: 'beta-feature',
                        enabled: true,
                        metadata: { payload: false },
                    },
                },
            },
            persistence
        )

        expect(persistence.register).toHaveBeenCalledWith(
            expect.objectContaining({
                $feature_flag_payloads: { 'beta-feature': false },
            })
        )
    })

    it('enables feature flag details from /flags?v=1 response', () => {
        const flagsResponse = {
            featureFlags: {
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            },
            featureFlagPayloads: {
                'beta-feature': 300,
                'alpha-feature-2': '"fake-payload"',
            },
        }
        vi.spyOn(window.console, 'warn').mockImplementation(() => {})

        parseFlagsResponse(flagsResponse, persistence)

        expect(persistence.register).toHaveBeenCalledWith({
            $minimal_flag_called_events: false,
            $active_feature_flags: ['beta-feature', 'alpha-feature-2', 'multivariate-flag'],
            $enabled_feature_flags: {
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            },
            $feature_flag_payloads: {
                'beta-feature': 300,
                'alpha-feature-2': '"fake-payload"',
            },
            $feature_flag_details: {},
        })
        expect(window.console.warn).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            'Using an older version of the feature flags endpoint. Please upgrade your PostHog server to the latest version'
        )
    })

    it('enables feature flag details from /flags?v=2 response', () => {
        const flagsResponse = {
            flags: {
                'beta-feature': {
                    key: 'beta-feature',
                    enabled: true,
                    variant: 'beta-variant-1',
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 2,
                        payload: 300,
                        id: 1,
                        description: 'test-description',
                    },
                },
                'alpha-feature': {
                    key: 'alpha-feature',
                    enabled: true,
                    variant: undefined,
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 21,
                        payload: undefined,
                        id: 2,
                        description: 'test-description',
                    },
                },
                'multivariate-flag': {
                    key: 'multivariate-flag',
                    enabled: true,
                    variant: 'multi-variant-2',
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 32,
                        payload: '"fake-payload"',
                        id: 3,
                        description: 'test-description',
                    },
                },
                'disabled-feature': {
                    key: 'disabled-feature',
                    enabled: false,
                    variant: undefined,
                    reason: {
                        code: 'no_matching_condition',
                        condition_index: undefined,
                        description: undefined,
                    },
                    metadata: {
                        version: 9,
                        payload: undefined,
                        id: 4,
                        description: 'not ready yet',
                    },
                },
            },
        }
        parseFlagsResponse(flagsResponse, persistence)

        expect(persistence.register).toHaveBeenCalledWith({
            $minimal_flag_called_events: false,
            $active_feature_flags: ['beta-feature', 'alpha-feature', 'multivariate-flag'],
            $enabled_feature_flags: {
                'alpha-feature': true,
                'beta-feature': 'beta-variant-1',
                'disabled-feature': false,
                'multivariate-flag': 'multi-variant-2',
            },
            $feature_flag_payloads: {
                'beta-feature': 300,
                'multivariate-flag': '"fake-payload"',
            },
            $feature_flag_details: {
                'beta-feature': {
                    key: 'beta-feature',
                    enabled: true,
                    variant: 'beta-variant-1',
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 2,
                        payload: 300,
                        id: 1,
                        description: 'test-description',
                    },
                },
                'alpha-feature': {
                    key: 'alpha-feature',
                    enabled: true,
                    variant: undefined,
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 21,
                        payload: undefined,
                        id: 2,
                        description: 'test-description',
                    },
                },
                'multivariate-flag': {
                    key: 'multivariate-flag',
                    enabled: true,
                    variant: 'multi-variant-2',
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 32,
                        payload: '"fake-payload"',
                        id: 3,
                        description: 'test-description',
                    },
                },
                'disabled-feature': {
                    key: 'disabled-feature',
                    enabled: false,
                    variant: undefined,
                    reason: {
                        code: 'no_matching_condition',
                        condition_index: undefined,
                        description: undefined,
                    },
                    metadata: {
                        version: 9,
                        payload: undefined,
                        id: 4,
                        description: 'not ready yet',
                    },
                },
            },
        })
    })

    it('enables feature flags from /flags response (v1 backwards compatibility)', () => {
        // checks that nothing fails when asking for ?v=2 and getting a ?v=1 response
        const flagsResponse = { featureFlags: ['beta-feature', 'alpha-feature-2'] }
        vi.spyOn(window.console, 'warn').mockImplementation(() => {})

        // @ts-expect-error testing backwards compatibility
        parseFlagsResponse(flagsResponse, persistence)

        expect(persistence.register).toHaveBeenLastCalledWith({
            $minimal_flag_called_events: false,
            $active_feature_flags: ['beta-feature', 'alpha-feature-2'],
            $enabled_feature_flags: { 'beta-feature': true, 'alpha-feature-2': true },
        })
        expect(window.console.warn).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            'v1 of the feature flags endpoint is deprecated. Please use the latest version.'
        )
    })

    it('doesnt remove existing feature flags when no flags are returned', () => {
        vi.spyOn(window.console, 'warn').mockImplementation(() => {})
        parseFlagsResponse({}, persistence)

        expect(persistence.register).not.toHaveBeenCalled()
        expect(persistence.unregister).not.toHaveBeenCalled()
    })

    const OLD_ENDPOINT_WARNING =
        'Using an older version of the feature flags endpoint. Please upgrade your PostHog server to the latest version'

    it.each([
        // A modern v2 response carries `flags` and must not warn.
        { name: 'v2 response with flags', response: { flags: { f: { key: 'f', enabled: true } } }, shouldWarn: false },
        // Only a genuinely old server returns the v1 shape (`featureFlags`, no `flags`) — keep the warning there.
        {
            name: 'v1-shaped response (featureFlags present)',
            response: { featureFlags: { f: true } },
            shouldWarn: true,
        },
        // A project with no feature flags returns a valid v2 response that omits `flags` — must not warn.
        { name: 'valid v2 response with no flags', response: {}, shouldWarn: false },
    ])('older-endpoint warning — $name (warns: $shouldWarn)', ({ response, shouldWarn }) => {
        // Ensure warnings would actually be emitted so the assertions below are meaningful, and
        // restore the previous value so this test stays self-contained.
        const previousDebug = (window as any).POSTHOG_DEBUG
        ;(window as any).POSTHOG_DEBUG = true
        vi.spyOn(window.console, 'warn').mockImplementation(() => {})

        // @ts-expect-error testing partial/legacy response shapes
        parseFlagsResponse(response, persistence)

        const expectation = expect(window.console.warn)
        if (shouldWarn) {
            expectation.toHaveBeenCalledWith('[PostHog.js] [FeatureFlags]', OLD_ENDPOINT_WARNING)
        } else {
            expectation.not.toHaveBeenCalledWith('[PostHog.js] [FeatureFlags]', OLD_ENDPOINT_WARNING)
        }
        ;(window as any).POSTHOG_DEBUG = previousDebug
    })

    it('parses the requestId from the /flags?v=1 response', () => {
        const flagsResponse = {
            featureFlags: { 'test-flag': true },
            requestId: 'test-request-id-123',
        }
        vi.spyOn(window.console, 'warn').mockImplementation(() => {})

        parseFlagsResponse(flagsResponse, persistence)

        expect(persistence.register).toHaveBeenCalledWith({
            $minimal_flag_called_events: false,
            $active_feature_flags: ['test-flag'],
            $enabled_feature_flags: { 'test-flag': true },
            $feature_flag_details: {},
            $feature_flag_payloads: {},
            $feature_flag_request_id: 'test-request-id-123',
        })
        expect(window.console.warn).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            'Using an older version of the feature flags endpoint. Please upgrade your PostHog server to the latest version'
        )
    })

    it('parses the requestId from the /flags?v=2 response', () => {
        const flagsResponse = {
            flags: {
                'test-flag': {
                    key: 'test-flag',
                    enabled: true,
                    variant: undefined,
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 4,
                        payload: undefined,
                        id: 1,
                        description: 'test-description',
                    },
                },
            },
            requestId: 'test-request-id-123',
        }

        parseFlagsResponse(flagsResponse, persistence)

        expect(persistence.register).toHaveBeenCalledWith({
            $minimal_flag_called_events: false,
            $active_feature_flags: ['test-flag'],
            $enabled_feature_flags: { 'test-flag': true },
            $feature_flag_details: {
                'test-flag': {
                    key: 'test-flag',
                    enabled: true,
                    variant: undefined,
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 4,
                        payload: undefined,
                        id: 1,
                        description: 'test-description',
                    },
                },
            },
            $feature_flag_payloads: {},
            $feature_flag_request_id: 'test-request-id-123',
        })
    })

    describe('partialResponse option', () => {
        const surveyFlagDetail = {
            key: 'survey-flag',
            enabled: true,
            variant: undefined,
            reason: { code: 'condition_match', condition_index: 0, description: undefined },
            metadata: { id: 1, version: 1, payload: undefined, description: undefined },
        }

        const bootstrapDetail = {
            key: 'bootstrapped-flag',
            enabled: true,
            variant: undefined,
            reason: { code: 'condition_match', condition_index: 0, description: undefined },
            metadata: { id: 10, version: 1, payload: 'bootstrap-payload', description: undefined },
        }

        it.each([
            {
                name: 'merges partial response with existing flags',
                existingFlags: { 'bootstrapped-flag': true, 'session-recording': true },
                existingPayloads: { 'bootstrapped-flag': 'bootstrap-payload' },
                existingDetails: { 'bootstrapped-flag': bootstrapDetail },
                options: { partialResponse: true },
                expectedFlags: { 'bootstrapped-flag': true, 'session-recording': true, 'survey-flag': true },
                expectedPayloads: { 'bootstrapped-flag': 'bootstrap-payload' },
                expectedDetails: { 'bootstrapped-flag': bootstrapDetail, 'survey-flag': surveyFlagDetail },
            },
            {
                name: 'partial response overwrites values for overlapping flag keys',
                existingFlags: { 'survey-flag': false, 'other-flag': true },
                existingPayloads: {},
                existingDetails: {},
                options: { partialResponse: true },
                expectedFlags: { 'survey-flag': true, 'other-flag': true },
                expectedPayloads: {},
                expectedDetails: { 'survey-flag': surveyFlagDetail },
            },
            {
                name: 'partial response removes stale payloads for reevaluated flags',
                existingFlags: { 'survey-flag': false, 'other-flag': true },
                existingPayloads: { 'survey-flag': 'stale-payload', 'other-flag': 'preserved-payload' },
                existingDetails: {},
                options: { partialResponse: true },
                expectedFlags: { 'survey-flag': true, 'other-flag': true },
                expectedPayloads: { 'other-flag': 'preserved-payload' },
                expectedDetails: { 'survey-flag': surveyFlagDetail },
            },
            {
                name: 'without partialResponse, response overwrites existing flags entirely',
                existingFlags: { 'bootstrapped-flag': true, 'session-recording': true },
                existingPayloads: {},
                existingDetails: {},
                options: undefined,
                expectedFlags: { 'survey-flag': true },
                expectedPayloads: {},
                expectedDetails: { 'survey-flag': surveyFlagDetail },
            },
        ])(
            '$name',
            ({
                existingFlags,
                existingPayloads,
                existingDetails,
                options,
                expectedFlags,
                expectedPayloads,
                expectedDetails,
            }) => {
                const flagsResponse = { flags: { 'survey-flag': surveyFlagDetail } }

                parseFlagsResponse(
                    flagsResponse,
                    persistence,
                    existingFlags,
                    existingPayloads,
                    existingDetails,
                    options
                )

                expect(persistence.register).toHaveBeenCalledWith(
                    expect.objectContaining({
                        $enabled_feature_flags: expectedFlags,
                        $feature_flag_payloads: expectedPayloads,
                        $feature_flag_details: expectedDetails,
                    })
                )
            }
        )
    })
})

describe('filterActiveFeatureFlags', () => {
    it('should return empty if no flags are passed', () => {
        expect(filterActiveFeatureFlags({})).toEqual({})
    })

    it('should return empty if nothing is passed', () => {
        expect(filterActiveFeatureFlags()).toEqual({})
    })

    it('should filter flags', () => {
        expect(
            filterActiveFeatureFlags({
                'flag-1': true,
                'flag-2': false,
                'flag-3': 'variant-1',
            })
        ).toEqual({
            'flag-1': true,
            'flag-3': 'variant-1',
        })
    })
})

describe('getRemoteConfigPayload', () => {
    let client: TestClient
    let config: MutableConfig
    let featureFlags: any

    beforeEach(() => {
        window.POSTHOG_DEBUG = true
        client = createFlagsClient({ projectToken: 'test-token', distinctId: 'test-distinct-id' })
        config = createConfig()
        featureFlags = setupFlags(client, config)
    })

    it('should include evaluation_contexts when configured', () => {
        config.evaluationContexts = ['staging', 'backend']

        const callback = vi.fn()
        featureFlags.getRemoteConfigPayload('test-flag', callback)

        const requestData = client.sendRequest.mock.calls[0][1].body
        expect(requestData.person_properties).toEqual({
            $lib: 'posthog-test',
            $lib_version: expect.any(String),
        })
        expect(requestData).not.toHaveProperty('$lib')
        expect(requestData).not.toHaveProperty('$lib_version')
        expect(client.sendRequest).toHaveBeenCalledWith(
            '/flags/?v=2',
            expect.objectContaining({
                method: 'POST',
                target: 'flags',
                compression: 'best-available',
                body: expect.objectContaining({
                    distinct_id: 'test-distinct-id',
                    token: 'test-token',
                    evaluation_contexts: ['staging', 'backend'],
                }),
            })
        )
    })

    it.each([
        ['configured with flag keys', ['remote-config-flag'], ['remote-config-flag']],
        ['configured as an empty array', [], []],
        ['not configured', undefined, undefined],
    ])('should handle flag_keys when %s', (_description, configuredFlagKeys, expectedFlagKeys) => {
        if (!isUndefined(configuredFlagKeys)) {
            config.flagKeys = configuredFlagKeys as any
        }

        const callback = vi.fn()
        featureFlags.getRemoteConfigPayload('test-flag', callback)

        expect(client.sendRequest).toHaveBeenCalledWith(
            '/flags/?v=2',
            expect.objectContaining({
                method: 'POST',
                target: 'flags',
                body: expect.objectContaining({
                    distinct_id: 'test-distinct-id',
                    token: 'test-token',
                }),
            })
        )

        if (isUndefined(expectedFlagKeys)) {
            expect(client.sendRequest.mock.calls[0][1].body).not.toHaveProperty('flag_keys')
        } else {
            expect(client.sendRequest.mock.calls[0][1].body.flag_keys).toEqual(expectedFlagKeys)
        }
    })

    it('continues requesting remote config payloads when automatic flag requests are disabled', async () => {
        featureFlags.dispose()
        config.remoteRequestsDisabled = true
        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 200,
            json: { featureFlagPayloads: { 'test-flag': 'payload' } },
        }))
        featureFlags = setupFlags(client, config)
        const callback = vi.fn()

        featureFlags.getRemoteConfigPayload('test-flag', callback)
        await vi.runAllTimersAsync()

        expect(client.sendRequest).toHaveBeenCalledTimes(1)
        expect(callback).toHaveBeenCalledWith('payload')
    })

    it('isolates remote config payload callback failures', async () => {
        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 200,
            json: { featureFlagPayloads: { 'test-flag': 'payload' } },
        }))
        const callbackError = new Error('callback failed')
        const error = vi.spyOn(window.console, 'error').mockImplementation(() => {})

        featureFlags.getRemoteConfigPayload('test-flag', () => {
            throw callbackError
        })
        await vi.runAllTimersAsync()

        expect(error).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            'Remote config feature flag callback failed',
            callbackError
        )
        expect(error).not.toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            'Remote config feature flag request failed',
            callbackError
        )
    })

    it('should not include evaluation_contexts when not configured', () => {
        const callback = vi.fn()
        featureFlags.getRemoteConfigPayload('test-flag', callback)

        expect(client.sendRequest).toHaveBeenCalledWith(
            '/flags/?v=2',
            expect.objectContaining({
                method: 'POST',
                target: 'flags',
                body: expect.objectContaining({
                    distinct_id: 'test-distinct-id',
                    token: 'test-token',
                }),
            })
        )

        // Verify evaluation_contexts is not in the data
        expect(client.sendRequest.mock.calls[0][1].body.evaluation_contexts).toBeUndefined()
    })

    it('should not include evaluation_contexts when configured as empty array', () => {
        config.evaluationContexts = []

        const callback = vi.fn()
        featureFlags.getRemoteConfigPayload('test-flag', callback)

        expect(client.sendRequest).toHaveBeenCalledWith(
            '/flags/?v=2',
            expect.objectContaining({
                method: 'POST',
                target: 'flags',
                body: expect.objectContaining({
                    distinct_id: 'test-distinct-id',
                    token: 'test-token',
                }),
            })
        )

        // Verify evaluation_contexts is not in the data
        expect(client.sendRequest.mock.calls[0][1].body.evaluation_contexts).toBeUndefined()
    })
})

describe('updateFlags', () => {
    beforeEach(() => {
        vi.spyOn(window.console, 'warn').mockImplementation(() => {})
    })

    it('should update feature flags without making a network request', async () => {
        const client = createFlagsClient()
        const posthog = setupFlags(client, createConfig())

        posthog.updateFlags({
            'test-flag': true,
            'variant-flag': 'control',
        })

        expect(posthog.getFeatureFlag('test-flag')).toBe(true)
        expect(posthog.getFeatureFlag('variant-flag')).toBe('control')
        expect(posthog.isFeatureEnabled('test-flag')).toBe(true)
    })

    it('merge does not bake an active override into the stored flags', async () => {
        const client = createFlagsClient()
        const posthog = setupFlags(client, createConfig())
        posthog.updateFlags({ 'base-flag': 'control' })
        posthog.overrideFeatureFlags({ flags: { 'base-flag': 'test' } })
        expect(posthog.getFeatureFlag('base-flag')).toBe('test')

        // Merging an unrelated flag must not fold the override into the base.
        posthog.updateFlags({ 'other-flag': true }, undefined, { merge: true })
        posthog.overrideFeatureFlags(false) // clear the override

        expect(posthog.getFeatureFlag('base-flag')).toBe('control')
        expect(posthog.getFeatureFlag('other-flag')).toBe(true)
    })

    it('should update feature flags with payloads', async () => {
        const client = createFlagsClient()
        const posthog = setupFlags(client, createConfig())

        posthog.updateFlags({ 'test-flag': true }, { 'test-flag': { some: 'payload' } })

        expect(posthog.getFeatureFlagPayload('test-flag')).toEqual({ some: 'payload' })
    })

    it('should return flag result with value and payload via getFeatureFlagResult', async () => {
        const client = createFlagsClient()
        const posthog = setupFlags(client, createConfig())

        posthog.updateFlags(
            { 'boolean-flag': true, 'variant-flag': 'control', 'disabled-flag': false },
            { 'boolean-flag': { discount: 10 }, 'variant-flag': { version: 'a' } }
        )

        const booleanResult = posthog.getFeatureFlagResult('boolean-flag', { send_event: false })
        expect(booleanResult).toEqual({
            key: 'boolean-flag',
            enabled: true,
            variant: undefined,
            payload: { discount: 10 },
        })

        const variantResult = posthog.getFeatureFlagResult('variant-flag', { send_event: false })
        expect(variantResult).toEqual({
            key: 'variant-flag',
            enabled: true,
            variant: 'control',
            payload: { version: 'a' },
        })

        const disabledResult = posthog.getFeatureFlagResult('disabled-flag', { send_event: false })
        expect(disabledResult).toEqual({
            key: 'disabled-flag',
            enabled: false,
            variant: undefined,
            payload: undefined,
        })

        const missingResult = posthog.getFeatureFlagResult('non-existent', { send_event: false })
        expect(missingResult).toBeUndefined()
    })

    // Note: Falsy payload values (null, 0, false, '') are filtered out by normalizeFlagsResponse
    // This is consistent with existing SDK behavior for all feature flag payloads

    it('should fire onFeatureFlags callbacks when flags are updated', async () => {
        const client = createFlagsClient()
        const posthog = setupFlags(client, createConfig())
        const callback = vi.fn()
        posthog.onFeatureFlags(callback)

        posthog.updateFlags({ 'new-flag': true })

        expect(callback).toHaveBeenCalledWith(['new-flag'], { 'new-flag': true }, { errorsLoading: undefined })
    })

    it('should replace existing flags by default', async () => {
        const client = createFlagsClient()
        const posthog = setupFlags(client, createConfig())

        // Set initial flags
        posthog.updateFlags({ 'flag-a': true, 'flag-b': true })

        expect(posthog.getFeatureFlag('flag-a')).toBe(true)
        expect(posthog.getFeatureFlag('flag-b')).toBe(true)

        // Update without merge - should replace
        posthog.updateFlags({ 'flag-c': true })

        expect(posthog.getFeatureFlag('flag-c')).toBe(true)
        expect(posthog.getFeatureFlag('flag-a')).toBe(undefined)
        expect(posthog.getFeatureFlag('flag-b')).toBe(undefined)
    })

    it('should merge flags when merge option is true', async () => {
        const client = createFlagsClient()
        const posthog = setupFlags(client, createConfig())

        // Set initial flags
        posthog.updateFlags({ 'flag-a': true, 'flag-b': true })

        expect(posthog.getFeatureFlag('flag-a')).toBe(true)
        expect(posthog.getFeatureFlag('flag-b')).toBe(true)

        // Update with merge - should keep existing flags
        posthog.updateFlags({ 'flag-c': true }, undefined, { merge: true })

        expect(posthog.getFeatureFlag('flag-a')).toBe(true)
        expect(posthog.getFeatureFlag('flag-b')).toBe(true)
        expect(posthog.getFeatureFlag('flag-c')).toBe(true)
    })

    it('should merge payloads when merge option is true', async () => {
        const client = createFlagsClient()
        const posthog = setupFlags(client, createConfig())

        // Set initial flags with payloads
        posthog.updateFlags({ 'flag-a': true, 'flag-b': true }, { 'flag-a': { data: 'a' }, 'flag-b': { data: 'b' } })

        expect(posthog.getFeatureFlagPayload('flag-a')).toEqual({ data: 'a' })
        expect(posthog.getFeatureFlagPayload('flag-b')).toEqual({ data: 'b' })

        // Update with merge - should keep existing payloads
        posthog.updateFlags({ 'flag-c': true }, { 'flag-c': { data: 'c' } }, { merge: true })

        expect(posthog.getFeatureFlagPayload('flag-a')).toEqual({ data: 'a' })
        expect(posthog.getFeatureFlagPayload('flag-b')).toEqual({ data: 'b' })
        expect(posthog.getFeatureFlagPayload('flag-c')).toEqual({ data: 'c' })
    })

    it('should override existing flag values when merging', async () => {
        const client = createFlagsClient()
        const posthog = setupFlags(client, createConfig())

        // Set initial flags
        posthog.updateFlags({ 'flag-a': true, 'flag-b': 'variant-1' })

        // Update flag-a with merge - should override just flag-a
        posthog.updateFlags({ 'flag-a': false }, undefined, { merge: true })

        expect(posthog.getFeatureFlag('flag-a')).toBe(false)
        expect(posthog.getFeatureFlag('flag-b')).toBe('variant-1')
    })

    it('should mark flags as loaded after update', async () => {
        const client = createFlagsClient()
        const posthog = setupFlags(client, createConfig())

        posthog.updateFlags({ 'test-flag': true })

        expect(posthog._hasLoadedFlags).toBe(true)
    })

    it('should not make any network requests', async () => {
        const client = createFlagsClient()
        const posthog = setupFlags(client, createConfig())
        const sendRequestSpy = vi.spyOn(client, 'sendRequest')

        posthog.updateFlags({ 'test-flag': true })

        expect(sendRequestSpy).not.toHaveBeenCalled()
    })

    it('should handle empty flags object', async () => {
        const client = createFlagsClient()
        const posthog = setupFlags(client, createConfig())

        // Set initial flags
        posthog.updateFlags({ 'flag-a': true, 'flag-b': 'variant-1' })
        expect(posthog.getFeatureFlag('flag-a')).toBe(true)

        // Update with empty object - should clear all flags
        posthog.updateFlags({})

        expect(posthog.getFeatureFlag('flag-a')).toBe(undefined)
        expect(posthog.getFeatureFlag('flag-b')).toBe(undefined)
        expect(posthog.getFlags()).toEqual([])
    })

    it('should persist flags to storage', async () => {
        const client = createFlagsClient()
        const posthog = setupFlags(client, createConfig())

        posthog.updateFlags(
            { 'persisted-flag': true, 'variant-flag': 'control' },
            { 'persisted-flag': { data: 'test' } }
        )

        // Verify persistence was updated with correct data
        expect(client.kv.get('$feature_flag_details')).toEqual({
            'persisted-flag': {
                key: 'persisted-flag',
                enabled: true,
                variant: undefined,
                reason: undefined,
                metadata: {
                    id: 0,
                    version: undefined,
                    description: undefined,
                    payload: { data: 'test' },
                },
            },
            'variant-flag': {
                key: 'variant-flag',
                enabled: true,
                variant: 'control',
                reason: undefined,
                metadata: undefined,
            },
        })
        expect(client.kv.get('$enabled_feature_flags')).toEqual({
            'persisted-flag': true,
            'variant-flag': 'control',
        })
        expect(client.kv.get('$active_feature_flags')).toEqual(['persisted-flag', 'variant-flag'])
    })
})

describe('$feature_flag_error tracking', () => {
    let client: TestClient
    let config: MutableConfig
    let featureFlags: any
    let mockWarn: vi.SpyInstance

    beforeEach(() => {
        client = createFlagsClient()
        config = createConfig()
        featureFlags = setupFlags(client, config)
        mockWarn = vi.spyOn(window.console, 'warn').mockImplementation(() => {})
        client.kv.remove('$flag_call_reported')
        client.kv.remove('$feature_flag_errors')
    })

    afterEach(() => {
        mockWarn.mockRestore()
        delete window.POSTHOG_DEBUG
        vi.clearAllMocks()
    })

    it('should set $feature_flag_error to api_error_{status} on server error', async () => {
        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 500,
            json: {},
        }))

        featureFlags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(10)

        expect(client.kv.get('$feature_flag_errors')).toEqual(['api_error_500'])
    })

    it('should set $feature_flag_error to connection_error on network failure', async () => {
        const networkError = new Error('Network request failed')
        networkError.name = 'TypeError'

        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 0,
            error: networkError,
            json: null,
        }))

        featureFlags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(10)

        expect(client.kv.get('$feature_flag_errors')).toEqual([FeatureFlagError.CONNECTION_ERROR])
    })

    it('should set $feature_flag_error to timeout when request times out (AbortError)', async () => {
        const abortError = new Error('Aborted')
        abortError.name = 'AbortError'

        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 0,
            error: abortError,
            json: null,
        }))

        featureFlags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(1000)

        expect(client.kv.get('$feature_flag_errors')).toEqual([FeatureFlagError.TIMEOUT])
    })

    it('should set $feature_flag_error to errors_while_computing_flags when errorsWhileComputingFlags is true', async () => {
        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 200,
            json: {
                flags: {
                    'test-flag': { key: 'test-flag', enabled: true },
                },
                errorsWhileComputingFlags: true,
            },
        }))

        featureFlags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(10)

        expect(client.kv.get('$feature_flag_errors')).toEqual([FeatureFlagError.ERRORS_WHILE_COMPUTING])
    })

    it('should set $feature_flag_error to quota_limited when quota limited', async () => {
        window.POSTHOG_DEBUG = true
        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 200,
            json: {
                flags: {},
                quotaLimited: ['feature_flags'],
            },
        }))

        featureFlags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(10)

        expect(client.kv.get('$feature_flag_errors')).toEqual([FeatureFlagError.QUOTA_LIMITED])
        expect(mockWarn).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            expect.stringContaining('You have hit your feature flags quota limit')
        )
    })

    it('should set $feature_flag_error to unknown_error when error is not an Error instance', async () => {
        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 0,
            error: 'String error message',
            json: null,
        }))

        featureFlags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(10)

        expect(client.kv.get('$feature_flag_errors')).toEqual([FeatureFlagError.UNKNOWN_ERROR])
    })

    it.each([401, 403, 404, 502, 503])(
        'should set $feature_flag_error to api_error_%i for status %i',
        async (status) => {
            client.sendRequest = vi.fn().mockImplementation(async () => ({ statusCode: status, json: {} }))

            featureFlags.reloadFeatureFlags()
            await vi.advanceTimersByTimeAsync(1000)

            expect(client.kv.get('$feature_flag_errors')).toEqual([`api_error_${status}`])
        }
    )

    it('should include $feature_flag_error in $feature_flag_called event capture', async () => {
        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 200,
            json: {
                flags: {
                    'test-flag': { key: 'test-flag', enabled: true },
                },
                errorsWhileComputingFlags: true,
            },
        }))

        featureFlags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(10)

        featureFlags.getFeatureFlag('test-flag')

        expect(client.capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.objectContaining({
                $feature_flag: 'test-flag',
                $feature_flag_response: true,
                $feature_flag_error: FeatureFlagError.ERRORS_WHILE_COMPUTING,
            })
        )
    })

    it('should set $feature_flag_error to flag_missing when flag is not in response', async () => {
        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 200,
            json: {
                flags: {
                    'other-flag': { key: 'other-flag', enabled: true },
                },
            },
        }))

        featureFlags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(10)

        featureFlags.getFeatureFlag('non-existent-flag')

        expect(client.capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.objectContaining({
                $feature_flag: 'non-existent-flag',
                $feature_flag_response: undefined,
                $feature_flag_error: FeatureFlagError.FLAG_MISSING,
            })
        )
    })

    it('should join multiple errors with commas', async () => {
        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 200,
            json: {
                flags: {},
                errorsWhileComputingFlags: true,
            },
        }))

        featureFlags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(10)

        // Flag is not in response, and errorsWhileComputingFlags is true
        featureFlags.getFeatureFlag('missing-flag')

        expect(client.capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.objectContaining({
                $feature_flag: 'missing-flag',
                $feature_flag_response: undefined,
                $feature_flag_error: `${FeatureFlagError.ERRORS_WHILE_COMPUTING},${FeatureFlagError.FLAG_MISSING}`,
            })
        )
    })

    it('should not include $feature_flag_error when there are no errors', async () => {
        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 200,
            json: {
                flags: {
                    'success-flag': { key: 'success-flag', enabled: true },
                },
                errorsWhileComputingFlags: false,
            },
        }))

        featureFlags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(10)

        featureFlags.getFeatureFlag('success-flag')

        expect(client.capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.not.objectContaining({
                $feature_flag_error: expect.anything(),
            })
        )
    })

    it('should clear errors on successful subsequent request', async () => {
        // First request with error
        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 500,
            json: {},
        }))

        featureFlags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(10)

        expect(client.kv.get('$feature_flag_errors')).toEqual(['api_error_500'])

        // Second successful request
        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 200,
            json: {
                flags: {
                    'success-flag': { key: 'success-flag', enabled: true },
                },
            },
        }))

        featureFlags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(10)

        expect(client.kv.get('$feature_flag_errors')).toEqual([])
    })

    it('should track quota_limited and flag_missing together', async () => {
        featureFlags.receivedFeatureFlags({ flags: {} })
        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 200,
            json: {
                flags: {},
                quotaLimited: ['feature_flags'],
            },
        }))

        featureFlags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(10)

        featureFlags.getFeatureFlag('some-flag')

        expect(client.capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.objectContaining({
                $feature_flag: 'some-flag',
                $feature_flag_response: undefined,
                $feature_flag_error: `${FeatureFlagError.QUOTA_LIMITED},${FeatureFlagError.FLAG_MISSING}`,
            })
        )
    })

    it('should include persisted errors in $feature_flag_called event after reload', async () => {
        // Setup: flags loaded with errors_while_computing
        client.sendRequest = vi.fn().mockImplementation(async () => ({
            statusCode: 200,
            json: {
                flags: { 'test-flag': { key: 'test-flag', enabled: true } },
                errorsWhileComputingFlags: true,
            },
        }))
        featureFlags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(10)

        // Simulate reload - new FeatureFlags instance with same persistence
        const newFeatureFlags = setupFlags(client, config)
        featureFlags.dispose()

        // Getting flag should include persisted error
        newFeatureFlags.getFeatureFlag('test-flag')

        expect(client.capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.objectContaining({
                $feature_flag: 'test-flag',
                $feature_flag_error: FeatureFlagError.ERRORS_WHILE_COMPUTING,
            })
        )
    })

    describe('feature flag cache TTL', () => {
        beforeEach(() => {
            window.POSTHOG_DEBUG = true

            // Set up flags in persistence for TTL tests
            client.kv.set({
                $enabled_feature_flags: {
                    'beta-feature': true,
                    'alpha-feature-2': true,
                    'multivariate-flag': 'variant-1',
                },
            })
        })

        it('should return undefined when cache is stale and TTL is configured', () => {
            // Set TTL to 1 hour
            config.cacheTtlMs = 60 * 60 * 1000

            // Set evaluated_at to 2 hours ago (stale)
            const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
            client.kv.set({
                $feature_flag_evaluated_at: twoHoursAgo,
            })

            featureFlags._hasLoadedFlags = true

            expect(featureFlags.getFeatureFlag('beta-feature')).toBeUndefined()
            expect(mockWarn).toHaveBeenCalledWith(
                '[PostHog.js] [FeatureFlags]',
                expect.stringContaining('Feature flag cache is stale')
            )
        })

        it('should return flag value when cache is fresh', () => {
            // Set TTL to 1 hour
            config.cacheTtlMs = 60 * 60 * 1000

            // Set evaluated_at to 30 minutes ago (fresh)
            const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000
            client.kv.set({
                $feature_flag_evaluated_at: thirtyMinutesAgo,
            })

            featureFlags._hasLoadedFlags = true

            expect(featureFlags.getFeatureFlag('beta-feature')).toEqual(true)
        })

        it('should return flag value when TTL is not configured (default behavior)', () => {
            // No TTL configured (default)
            config.cacheTtlMs = undefined

            // Set evaluated_at to a long time ago
            const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000
            client.kv.set({
                $feature_flag_evaluated_at: oneYearAgo,
            })

            featureFlags._hasLoadedFlags = true

            // Should still return flag value since TTL is not configured
            expect(featureFlags.getFeatureFlag('beta-feature')).toEqual(true)
        })

        it('should return flag value when TTL is 0 (disabled)', () => {
            // TTL explicitly disabled
            config.cacheTtlMs = 0

            // Set evaluated_at to a long time ago
            const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000
            client.kv.set({
                $feature_flag_evaluated_at: oneYearAgo,
            })

            featureFlags._hasLoadedFlags = true

            // Should still return flag value since TTL is disabled
            expect(featureFlags.getFeatureFlag('beta-feature')).toEqual(true)
        })

        it('should treat missing evaluated_at as stale when TTL is configured', () => {
            // Set TTL to 1 hour
            config.cacheTtlMs = 60 * 60 * 1000

            // No evaluated_at set
            client.kv.remove('$feature_flag_evaluated_at')

            featureFlags._hasLoadedFlags = true

            expect(featureFlags.getFeatureFlag('beta-feature')).toBeUndefined()
            expect(mockWarn).toHaveBeenCalledWith(
                '[PostHog.js] [FeatureFlags]',
                expect.stringContaining('Feature flag cache is stale')
            )
        })

        it('should return undefined for getFeatureFlagResult when cache is stale', () => {
            // Set TTL to 1 hour
            config.cacheTtlMs = 60 * 60 * 1000

            // Set evaluated_at to 2 hours ago (stale)
            const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
            client.kv.set({
                $feature_flag_evaluated_at: twoHoursAgo,
            })

            featureFlags._hasLoadedFlags = true

            expect(featureFlags.getFeatureFlagResult('beta-feature')).toBeUndefined()
        })

        it('should trigger reloadFeatureFlags when cache is stale', () => {
            const reloadSpy = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            // Set TTL to 1 hour
            config.cacheTtlMs = 60 * 60 * 1000

            // Set evaluated_at to 2 hours ago (stale)
            const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
            client.kv.set({
                $feature_flag_evaluated_at: twoHoursAgo,
            })

            featureFlags._hasLoadedFlags = true

            // First call should trigger reload
            featureFlags.getFeatureFlag('beta-feature')
            expect(reloadSpy).toHaveBeenCalledTimes(1)

            // Second call should NOT trigger another reload (already triggered)
            featureFlags.getFeatureFlag('beta-feature')
            expect(reloadSpy).toHaveBeenCalledTimes(1)

            reloadSpy.mockRestore()
        })

        it('should reset staleCacheRefreshTriggered after successful flag load', () => {
            const reloadSpy = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            // Set TTL to 1 hour
            config.cacheTtlMs = 60 * 60 * 1000

            // Set evaluated_at to 2 hours ago (stale)
            const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
            client.kv.set({
                $feature_flag_evaluated_at: twoHoursAgo,
            })

            featureFlags._hasLoadedFlags = true

            // First stale detection triggers reload
            featureFlags.getFeatureFlag('beta-feature')
            expect(reloadSpy).toHaveBeenCalledTimes(1)

            // Simulate successful flag load with fresh timestamp
            const now = Date.now()
            client.kv.set({
                $feature_flag_evaluated_at: now,
            })
            featureFlags.receivedFeatureFlags({ featureFlags: { 'beta-feature': true } }, false)

            // Make cache stale again
            client.kv.set({
                $feature_flag_evaluated_at: twoHoursAgo,
            })

            // Should trigger reload again since flag was reset
            featureFlags.getFeatureFlag('beta-feature')
            expect(reloadSpy).toHaveBeenCalledTimes(2)

            reloadSpy.mockRestore()
        })
    })
})
