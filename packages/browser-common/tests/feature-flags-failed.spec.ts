import type { FeatureFlagDetail } from '@posthog/core'
import { parseFlagsResponse } from '../src/feature-flags'
import { createConfig, createFlagsClient, setupFlags, disposeFlags } from './helpers/feature-flags'
import {
    ENABLED_FEATURE_FLAGS,
    PERSISTENCE_FEATURE_FLAG_PAYLOADS,
    PERSISTENCE_FEATURE_FLAG_DETAILS,
    PERSISTENCE_FEATURE_FLAG_ERRORS,
    PERSISTENCE_ACTIVE_FEATURE_FLAGS,
    PERSISTENCE_OVERRIDE_FEATURE_FLAGS,
} from '../src/constants'

const failed = {
    key: 'failed',
    enabled: true,
    variant: 'placeholder',
    failed: true,
    metadata: { id: 42, payload: '{"remote":true}' },
    reason: { code: 'dependency_error' },
}
const healthy = { key: 'healthy', enabled: false, failed: false, metadata: {} }

describe('failed browser flag records', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => {
        disposeFlags()
        vi.useRealTimers()
    })

    it.each(
        [true, false, undefined].flatMap((errorsWhileComputingFlags) =>
            [true, false, undefined].map((defaultValue) => ({ errorsWhileComputingFlags, defaultValue }))
        )
    )('tracks an isolated persisted failed isFeatureEnabled read %j', ({ errorsWhileComputingFlags, defaultValue }) => {
        const client = createFlagsClient()
        client.kv.set({
            [ENABLED_FEATURE_FLAGS]: { failed: 'placeholder' },
            [PERSISTENCE_FEATURE_FLAG_DETAILS]: { failed },
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: { failed: '{"remote":true}' },
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['failed'],
            [PERSISTENCE_FEATURE_FLAG_ERRORS]: errorsWhileComputingFlags ? ['errors_while_computing_flags'] : [],
        })
        const flags = setupFlags(client, createConfig({ remoteRequestsDisabled: true }))
        expect(flags.isFeatureEnabled('failed', { defaultValue, fresh: true })).toBe(defaultValue)
        expect(flags.isFeatureEnabled('failed', { defaultValue, send_event: false })).toBe(defaultValue)
        expect(client.capture).not.toHaveBeenCalled()
        expect(flags.isFeatureEnabled('failed', { defaultValue })).toBe(defaultValue)
        expect(client.capture).toHaveBeenCalledTimes(1)
        expect(client.capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.objectContaining({
                $feature_flag_response: undefined,
                $feature_flag_error: errorsWhileComputingFlags
                    ? 'errors_while_computing_flags,evaluation_failed'
                    : 'evaluation_failed',
            })
        )
        expect(flags.isFeatureEnabled('failed', { defaultValue })).toBe(defaultValue)
        expect(client.capture).toHaveBeenCalledTimes(1)
        expect(flags.getFeatureFlagResult('failed', { send_event: false })).toBeUndefined()
        expect(flags.getFeatureFlag('failed')).toBeUndefined()
        expect(flags.getAllFeatureFlags()).toEqual([])
        expect(flags.getFlagPayloads()).toEqual({})
        expect(client.sendRequest).not.toHaveBeenCalled()
        vi.mocked(client.capture).mockRestore()
        client.capture('other')
        expect(client.capturedEvents[0]?.properties).not.toHaveProperty('$feature/failed')
        expect(client.capturedEvents[0]?.properties[PERSISTENCE_FEATURE_FLAG_PAYLOADS]).toEqual({})
        expect(client.capturedEvents[0]?.properties[PERSISTENCE_ACTIVE_FEATURE_FLAGS]).toEqual([])
        flags.updateFlags({ healthy: true }, undefined, { merge: true })
        expect(flags.getFlagVariants()).toEqual({ healthy: true })
        expect(flags.getFlagPayloads()).toEqual({})
    })

    it('preserves legacy, retained successful, overridden and bootstrapped values on startup', () => {
        const client = createFlagsClient()
        client.kv.set({
            [ENABLED_FEATURE_FLAGS]: { failed: 'placeholder', retained: 'cached', disabled: false, legacy: true },
            [PERSISTENCE_FEATURE_FLAG_DETAILS]: {
                failed,
                retained: { ...failed, key: 'retained', failed: false, variant: 'cached' },
            },
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: {
                failed: 'remote',
                retained: '{"cached":true}',
                legacy: '{"flat":true}',
            },
            [PERSISTENCE_FEATURE_FLAG_ERRORS]: ['errors_while_computing_flags'],
        })
        const flags = setupFlags(client, createConfig({ remoteRequestsDisabled: true }))
        expect(flags.getFlagVariants()).toEqual({ retained: 'cached', disabled: false, legacy: true })
        expect(flags.getFeatureFlagResult('retained')).toMatchObject({ variant: 'cached', payload: { cached: true } })
        expect(client.capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.objectContaining({ $feature_flag_error: 'errors_while_computing_flags' })
        )
        client.kv.set(PERSISTENCE_OVERRIDE_FEATURE_FLAGS, { failed: 'override' })
        expect(flags.getFeatureFlagResult('failed', { send_event: false })).toMatchObject({
            variant: 'override',
            payload: undefined,
        })
        client.kv.remove(PERSISTENCE_OVERRIDE_FEATURE_FLAGS)
        const bootstrapped = setupFlags(
            client,
            createConfig({
                remoteRequestsDisabled: true,
                bootstrap: {
                    featureFlags: { failed: 'bootstrap' },
                    featureFlagPayloads: { failed: { bootstrap: true } },
                },
            })
        )
        expect(bootstrapped.getFeatureFlagResult('failed', { send_event: false })).toMatchObject({
            variant: 'bootstrap',
            payload: { bootstrap: true },
        })
    })

    it.each([false, true])(
        'accepts a legacy array after a failed detail and reopen (pre-fix cache: %s)',
        (preFixCache) => {
            const client = createFlagsClient()
            const config = createConfig({ remoteRequestsDisabled: true })
            const flags = setupFlags(client, config)
            flags.receivedFeatureFlags({
                flags: {
                    failed,
                    unresolved: { ...failed, key: 'unresolved' },
                    healthy: { key: 'healthy', enabled: true, metadata: { payload: '{"healthy":true}' } },
                },
            })
            if (preFixCache) {
                client.kv.set(PERSISTENCE_FEATURE_FLAG_PAYLOADS, { failed: 'placeholder', healthy: '{"healthy":true}' })
            }
            const callback = vi.fn()
            flags.onFeatureFlags(callback)
            flags.receivedFeatureFlags({
                // @ts-expect-error Legacy v1 servers return an array rather than a value map.
                featureFlags: ['failed', 'healthy'],
            })
            expect(flags.getFeatureFlagResult('failed')).toEqual({
                key: 'failed',
                enabled: true,
                variant: undefined,
                payload: undefined,
            })
            expect(client.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.objectContaining({
                    $feature_flag_response: true,
                })
            )
            expect(vi.mocked(client.capture).mock.calls[0]?.[1]).not.toHaveProperty('$feature_flag_error')
            expect(vi.mocked(client.capture).mock.calls[0]?.[1]).not.toHaveProperty('$feature_flag_id')
            expect(vi.mocked(client.capture).mock.calls[0]?.[1]).not.toHaveProperty('$feature_flag_reason')
            expect(flags.getFeatureFlagDetails('failed')).toBeUndefined()
            expect(flags.getFeatureFlagDetails('unresolved')?.failed).toBe(true)
            expect(flags.getFlagVariants()).toEqual({ failed: true, healthy: true })
            expect(flags.getFlagPayloads()).toEqual({ healthy: '{"healthy":true}' })
            expect(callback).toHaveBeenLastCalledWith(
                ['failed', 'healthy'],
                { failed: true, healthy: true },
                { errorsLoading: undefined }
            )
            vi.mocked(client.capture).mockRestore()
            client.capture('other')
            expect(client.capturedEvents[0]?.properties).toMatchObject({
                '$feature/failed': true,
                [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['failed', 'healthy'],
                [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: { healthy: '{"healthy":true}' },
            })
            flags.dispose()
            const reopened = setupFlags(client, config)
            expect(reopened.getFeatureFlagResult('failed', { send_event: false })).toEqual({
                key: 'failed',
                enabled: true,
                variant: undefined,
                payload: undefined,
            })
            expect(reopened.getFeatureFlagResult('healthy', { send_event: false })?.payload).toEqual({ healthy: true })
            client.capture('reopened')
            expect(client.capturedEvents[1]?.properties['$feature/failed']).toBe(true)
        }
    )

    it('keeps overrides out of persisted legacy recovery values and payloads', () => {
        const client = createFlagsClient()
        const config = createConfig({ remoteRequestsDisabled: true })
        const flags = setupFlags(client, config)
        flags.receivedFeatureFlags({
            flags: { failed, healthy: { ...healthy, enabled: true, metadata: { payload: '{"healthy":true}' } } },
        })
        flags.overrideFeatureFlags({
            flags: { failed: 'override', healthy: false },
            payloads: { failed: { override: true }, healthy: { override: true } },
            suppressWarning: true,
        })
        flags.receivedFeatureFlags({
            // @ts-expect-error Legacy v1 servers return an array rather than a value map.
            featureFlags: ['failed', 'healthy'],
        })
        expect(flags.getFeatureFlagResult('failed', { send_event: false })).toMatchObject({
            variant: 'override',
            payload: { override: true },
        })
        flags.overrideFeatureFlags(false)
        flags.dispose()
        const reopened = setupFlags(client, config)
        expect(reopened.getFeatureFlagResult('failed', { send_event: false })).toEqual({
            key: 'failed',
            enabled: true,
            variant: undefined,
            payload: undefined,
        })
        expect(reopened.getFeatureFlagResult('healthy', { send_event: false })).toEqual({
            key: 'healthy',
            enabled: true,
            variant: undefined,
            payload: { healthy: true },
        })
        expect(reopened.getFeatureFlagDetails('healthy')?.original_enabled).toBeUndefined()
    })

    it.each([10, 1000].flatMap((count) => [false, true].map((failedSibling) => ({ count, failedSibling }))))(
        'does not rescan unrelated flag details on cached reads %j',
        ({ count, failedSibling }) => {
            const client = createFlagsClient()
            const flags = setupFlags(client, createConfig({ remoteRequestsDisabled: true }))
            const readFailure = vi.fn(() => failedSibling)
            const details: Record<string, FeatureFlagDetail> = {
                target: { key: 'target', enabled: false, metadata: { payload: '{"target":true}' } },
            }
            for (let i = 0; i < count; i++) {
                details[`sibling-${i}`] = {
                    key: `sibling-${i}`,
                    enabled: true,
                    get failed() {
                        return readFailure()
                    },
                }
            }
            flags.receivedFeatureFlags({ flags: details })
            readFailure.mockClear()
            for (let i = 0; i < 5; i++) {
                expect(flags.getFeatureFlagResult('target', { send_event: false })).toEqual({
                    key: 'target',
                    enabled: false,
                    variant: undefined,
                    payload: undefined,
                })
            }
            expect(readFailure.mock.calls.length).toBe(0)
            expect(client.capture).not.toHaveBeenCalled()
            flags.getFeatureFlagResult('target')
            expect(client.capture).toHaveBeenCalledTimes(1)
            readFailure.mockClear()
            for (let i = 0; i < 5; i++) {
                expect(flags.isFeatureEnabled('target')).toBe(false)
                expect(flags.getFeatureFlagResult('sibling-0', { send_event: false })?.enabled).toBe(
                    failedSibling ? undefined : true
                )
            }
            expect(readFailure.mock.calls.length).toBeLessThanOrEqual(5)
            expect(client.capture).toHaveBeenCalledTimes(1)
        }
    )

    it.each([
        { partialResponse: true, errorsWhileComputingFlags: false },
        { partialResponse: false, errorsWhileComputingFlags: true },
    ])('recovers failed details with a later legacy same-key pair and reopen %j', (mode) => {
        const client = createFlagsClient()
        const config = createConfig({ remoteRequestsDisabled: true })
        const flags = setupFlags(client, config)
        flags.receivedFeatureFlags({
            flags: { failed, disabled: { ...failed, key: 'disabled' }, unresolved: { ...failed, key: 'unresolved' } },
        })
        flags.receivedFeatureFlags(
            {
                featureFlags: { failed: 'legacy-success', disabled: false },
                featureFlagPayloads: { failed: '{"legacy":true}' },
                errorsWhileComputingFlags: mode.errorsWhileComputingFlags,
            },
            undefined,
            mode
        )
        expect(flags.getFeatureFlagResult('failed')).toMatchObject({
            variant: 'legacy-success',
            payload: { legacy: true },
        })
        expect(vi.mocked(client.capture).mock.calls[0]?.[1]?.$feature_flag_error).toBeUndefined()
        expect(flags.getFeatureFlagDetails('unresolved')?.failed).toBe(true)
        expect(flags.isFeatureEnabled('disabled', { defaultValue: true, send_event: false })).toBe(false)
        flags.dispose()
        const reopened = setupFlags(client, config)
        expect(reopened.getFeatureFlagResult('failed', { send_event: false })).toMatchObject({
            variant: 'legacy-success',
            payload: { legacy: true },
        })
        expect(reopened.getFeatureFlagResult('unresolved', { send_event: false })).toBeUndefined()
    })

    it.each([true, false])(
        'enrollment supersedes failed provenance without its payload and survives reopen (%s)',
        (isEnrolled) => {
            const client = createFlagsClient()
            const config = createConfig({ remoteRequestsDisabled: true })
            const flags = setupFlags(client, config)
            flags.receivedFeatureFlags({ flags: { failed, unresolved: { ...failed, key: 'unresolved' } } })
            client.kv.set(PERSISTENCE_FEATURE_FLAG_PAYLOADS, { failed: { remote: true } })
            const callback = vi.fn()
            flags.onFeatureFlags(callback)
            flags.updateEarlyAccessFeatureEnrollment('failed', isEnrolled)
            expect(flags.getFeatureFlagResult('failed')).toMatchObject({ enabled: isEnrolled, payload: undefined })
            expect(flags.getFlagPayloads()).not.toHaveProperty('failed')
            expect(flags.getFeatureFlagDetails('unresolved')?.failed).toBe(true)
            expect(
                vi.mocked(client.capture).mock.calls.find(([event]) => event === '$feature_flag_called')?.[1]
                    ?.$feature_flag_error
            ).toBeUndefined()
            expect(callback).toHaveBeenLastCalledWith(
                isEnrolled ? ['failed'] : [],
                isEnrolled ? { failed: true } : {},
                { errorsLoading: undefined }
            )
            flags.dispose()
            const reopened = setupFlags(client, config)
            expect(reopened.getFeatureFlagResult('failed', { send_event: false })).toMatchObject({
                enabled: isEnrolled,
                payload: undefined,
            })
        }
    )

    it.each([true, false, undefined])(
        'omits failures regardless of global errors (%s)',
        (errorsWhileComputingFlags) => {
            const patch = parseFlagsResponse({
                flags: { failed, healthy },
                errorsWhileComputingFlags,
                featureFlags: { failed: 'mirror' },
                featureFlagPayloads: { failed: 'mirror' },
            })!
            expect(patch[ENABLED_FEATURE_FLAGS]).toEqual({ healthy: false })
            expect(patch[PERSISTENCE_FEATURE_FLAG_PAYLOADS]).toEqual({})
        }
    )

    it.each([
        { partialResponse: true, errorsWhileComputingFlags: true },
        { partialResponse: true, errorsWhileComputingFlags: false },
        { partialResponse: true, errorsWhileComputingFlags: undefined },
        { partialResponse: false, errorsWhileComputingFlags: true },
        { partialResponse: false, errorsWhileComputingFlags: false },
        { partialResponse: false, errorsWhileComputingFlags: undefined },
    ])('applies refresh boundary %j', ({ partialResponse, errorsWhileComputingFlags }) => {
        const patch = parseFlagsResponse(
            { flags: { failed, healthy }, errorsWhileComputingFlags },
            { failed: 'cached', stale: true },
            { failed: { old: true }, stale: 'old' },
            { failed: { ...failed, failed: false, variant: 'cached', metadata: { payload: '{"old":true}' } } },
            { partialResponse }
        )!
        const merges = partialResponse || errorsWhileComputingFlags
        expect(patch[ENABLED_FEATURE_FLAGS]).toEqual(
            merges ? { failed: 'cached', stale: true, healthy: false } : { healthy: false }
        )
        expect(patch[PERSISTENCE_FEATURE_FLAG_PAYLOADS]).toEqual(merges ? { failed: { old: true }, stale: 'old' } : {})
        expect(patch[PERSISTENCE_FEATURE_FLAG_DETAILS]?.failed?.failed).toBe(merges ? false : true)
    })

    it.each(
        [true, false, undefined].flatMap((errorsWhileComputingFlags) =>
            [true, false].map((variantPlaceholder) => ({ errorsWhileComputingFlags, variantPlaceholder }))
        )
    )(
        'tracks failed reads with no-result sentinel and both errors (%j)',
        async ({ errorsWhileComputingFlags, variantPlaceholder }) => {
            const client = createFlagsClient()
            vi.mocked(client.sendRequest).mockResolvedValue({
                statusCode: 200,
                json: {
                    flags: {
                        failed: variantPlaceholder ? failed : { ...failed, enabled: false, variant: undefined },
                        healthy,
                    },
                    errorsWhileComputingFlags,
                },
            })
            const flags = setupFlags(client, createConfig())
            flags.ensureFlagsLoaded()
            await vi.advanceTimersByTimeAsync(5)
            expect(flags.getFeatureFlagResult('failed', { send_event: false })).toBeUndefined()
            expect(client.capture).not.toHaveBeenCalled()
            expect(flags.isFeatureEnabled('failed', { defaultValue: true })).toBe(true)
            expect(flags.getFeatureFlagResult('failed')).toBeUndefined()
            expect(client.capture).toHaveBeenCalledTimes(1)
            expect(client.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.objectContaining({
                    $feature_flag_response: undefined,
                    $feature_flag_payload: null,
                    $feature_flag_error: errorsWhileComputingFlags
                        ? 'errors_while_computing_flags,evaluation_failed'
                        : 'evaluation_failed',
                    $feature_flag_reason: 'dependency_error',
                    $feature_flag_id: 42,
                })
            )
            expect(flags.isFeatureEnabled('healthy', { defaultValue: true })).toBe(false)
            expect(flags.getAllFeatureFlags().map(({ key }) => key)).toEqual(['healthy'])
            expect(vi.mocked(client.capture).mock.calls[1]?.[1]?.$feature_flag_error).toBe(
                errorsWhileComputingFlags ? 'errors_while_computing_flags' : undefined
            )
            vi.mocked(client.capture).mockRestore()
            client.capture('other')
            expect(client.capturedEvents[0]?.properties).not.toHaveProperty('$feature/failed')
            expect(client.capturedEvents[0]?.properties).toHaveProperty('$feature/healthy', false)
        }
    )
})
