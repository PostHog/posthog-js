import { PostHog } from '../posthog-core'
import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { USER_STATE } from '../constants'

describe('reset()', () => {
    let instance: PostHog
    let beforeSendMock: jest.Mock

    beforeEach(async () => {
        beforeSendMock = jest.fn().mockImplementation((e) => e)

        instance = await createPosthogInstance(uuidv7(), {
            api_host: 'https://test.com',
            token: 'testtoken',
            before_send: beforeSendMock,
        })
    })

    it('clears persistence', () => {
        instance.persistence!.register({ $enabled_feature_flags: { flag: 'variant', other: true } })
        expect(instance.persistence!.props['$enabled_feature_flags']).toEqual({ flag: 'variant', other: true })

        instance.reset()

        expect(instance.persistence!.props['$enabled_feature_flags']).toEqual(undefined)
    })

    it('resets the session_id and window_id', () => {
        const initialSessionAndWindowId = instance.sessionManager!.checkAndGetSessionAndWindowId()

        instance.reset()

        const nextSessionAndWindowId = instance.sessionManager!.checkAndGetSessionAndWindowId()
        expect(initialSessionAndWindowId.sessionId).not.toEqual(nextSessionAndWindowId.sessionId)
        expect(initialSessionAndWindowId.windowId).not.toEqual(nextSessionAndWindowId.windowId)
    })

    it('sets the user as anonymous', () => {
        instance.persistence!.set_property(USER_STATE, 'identified')

        instance.reset()

        expect(instance.persistence!.get_property(USER_STATE)).toEqual('anonymous')
    })

    it('does not reset the device id', () => {
        const initialDeviceId = instance.get_property('$device_id')

        instance.reset()

        const nextDeviceId = instance.get_property('$device_id')
        expect(initialDeviceId).toEqual(nextDeviceId)
    })

    it('sets last reset date', () => {
        instance.capture('probe 1')
        expect(beforeSendMock).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'probe 1',
                properties: expect.not.objectContaining({
                    $last_posthog_reset: expect.any(String),
                }),
            })
        )

        instance.reset()

        instance.capture('probe 2')
        expect(beforeSendMock).toHaveBeenLastCalledWith(
            expect.objectContaining({
                event: 'probe 2',
                properties: expect.objectContaining({
                    $last_posthog_reset: expect.any(String),
                }),
            })
        )
    })

    it('resets feature flags internal state', () => {
        instance.featureFlags.receivedFeatureFlags({
            featureFlags: { 'test-flag': true, 'another-flag': 'variant' },
            featureFlagPayloads: {},
        })

        expect(instance.featureFlags.hasLoadedFlags).toBe(true)
        expect(instance.featureFlags.getFlags()).toEqual(['test-flag', 'another-flag'])

        instance.reset()

        expect(instance.featureFlags.hasLoadedFlags).toBe(false)
        expect(instance.featureFlags.getFlags()).toEqual([])

        const mockCallback = jest.fn()
        instance.featureFlags.onFeatureFlags(mockCallback)

        expect(mockCallback).not.toHaveBeenCalled()
    })

    describe('when calling reset(true)', () => {
        it('does reset the device id', () => {
            const initialDeviceId = instance.get_property('$device_id')

            instance.reset(true)

            const nextDeviceId = instance.get_property('$device_id')
            expect(initialDeviceId).not.toEqual(nextDeviceId)
        })
    })

    describe('when calling reset with ResetOptions', () => {
        it('resets device id when resetDeviceID is true', () => {
            const initialDeviceId = instance.get_property('$device_id')

            instance.reset({ resetDeviceID: true })

            const nextDeviceId = instance.get_property('$device_id')
            expect(initialDeviceId).not.toEqual(nextDeviceId)
        })

        it('preserves device id when resetDeviceID is false', () => {
            const initialDeviceId = instance.get_property('$device_id')

            instance.reset({ resetDeviceID: false })

            const nextDeviceId = instance.get_property('$device_id')
            expect(initialDeviceId).toEqual(nextDeviceId)
        })

        it('sets a custom distinct_id from bootstrap', () => {
            instance.reset({ bootstrap: { distinctID: 'custom-anon-id' } })

            expect(instance.get_distinct_id()).toEqual('custom-anon-id')
        })

        it('sets device_id to distinctID for anonymous users', () => {
            instance.reset({ bootstrap: { distinctID: 'custom-anon-id', isIdentifiedID: false } })

            expect(instance.get_distinct_id()).toEqual('custom-anon-id')
            expect(instance.get_property('$device_id')).toEqual('custom-anon-id')
            expect(instance.persistence!.get_property(USER_STATE)).toEqual('anonymous')
        })

        it('generates new device_id for identified users', () => {
            instance.reset({ bootstrap: { distinctID: 'user@example.com', isIdentifiedID: true } })

            expect(instance.get_distinct_id()).toEqual('user@example.com')
            expect(instance.get_property('$device_id')).not.toEqual('user@example.com')
            expect(instance.persistence!.get_property(USER_STATE)).toEqual('identified')
        })

        it('bootstraps feature flags', () => {
            instance.reset({
                bootstrap: {
                    featureFlags: { 'new-flag': true, 'variant-flag': 'control' },
                },
            })

            expect(instance.featureFlags.getFlags()).toEqual(['new-flag', 'variant-flag'])
            expect(instance.featureFlags.getFlagVariants()).toEqual({ 'new-flag': true, 'variant-flag': 'control' })
        })

        it('bootstraps feature flag payloads for active flags only', () => {
            instance.reset({
                bootstrap: {
                    featureFlags: { 'active-flag': true, 'inactive-flag': false },
                    featureFlagPayloads: {
                        'active-flag': { key: 'value' },
                        'inactive-flag': { should: 'not appear' },
                    },
                },
            })

            expect(instance.featureFlags.getFlags()).toEqual(['active-flag'])
            expect(instance.featureFlags.getFeatureFlagPayload('active-flag')).toEqual({ key: 'value' })
            expect(instance.featureFlags.getFeatureFlagPayload('inactive-flag')).toEqual(undefined)
        })

        it('clears pre-reset feature flags when no bootstrap flags provided', () => {
            instance.featureFlags.receivedFeatureFlags({
                featureFlags: { 'old-flag': true, 'another-old-flag': 'variant' },
                featureFlagPayloads: { 'old-flag': { old: 'payload' } },
            })

            expect(instance.featureFlags.getFlags()).toEqual(['old-flag', 'another-old-flag'])

            instance.reset()

            expect(instance.featureFlags.getFlags()).toEqual([])
            expect(instance.featureFlags.getFeatureFlagPayload('old-flag')).toEqual(undefined)
        })

        it('does not restore pre-reset flags when bootstrap has distinctID but no featureFlags', () => {
            instance.featureFlags.receivedFeatureFlags({
                featureFlags: { 'old-flag': true },
                featureFlagPayloads: {},
            })

            instance.reset({ bootstrap: { distinctID: 'new-user' } })

            expect(instance.featureFlags.getFlags()).toEqual([])
            expect(instance.get_distinct_id()).toEqual('new-user')
        })

        it('does not restore pre-reset flags when bootstrap has empty featureFlags', () => {
            instance.featureFlags.receivedFeatureFlags({
                featureFlags: { 'old-flag': true },
                featureFlagPayloads: {},
            })

            instance.reset({ bootstrap: { featureFlags: {} } })

            expect(instance.featureFlags.getFlags()).toEqual([])
        })

        it('only applies bootstrapped flags, not pre-reset flags', () => {
            instance.featureFlags.receivedFeatureFlags({
                featureFlags: { 'old-flag': true, 'shared-flag': 'old-variant' },
                featureFlagPayloads: {},
            })

            instance.reset({
                bootstrap: {
                    featureFlags: { 'shared-flag': 'new-variant', 'new-flag': true },
                },
            })

            expect(instance.featureFlags.getFlags()).toEqual(['shared-flag', 'new-flag'])
            expect(instance.featureFlags.getFlagVariants()).toEqual({
                'shared-flag': 'new-variant',
                'new-flag': true,
            })
        })

        it('combines resetDeviceID and bootstrap options', () => {
            const initialDeviceId = instance.get_property('$device_id')

            instance.reset({
                resetDeviceID: true,
                bootstrap: { distinctID: 'custom-id' },
            })

            expect(instance.get_distinct_id()).toEqual('custom-id')
            // bootstrap sets device_id to distinctID for anonymous user, overriding the reset
            expect(instance.get_property('$device_id')).toEqual('custom-id')
            expect(instance.get_property('$device_id')).not.toEqual(initialDeviceId)
        })

        it('bootstraps session ID', () => {
            const sessionUUID = uuidv7()

            instance.reset({ bootstrap: { sessionID: sessionUUID } })

            const { sessionId } = instance.sessionManager!.checkAndGetSessionAndWindowId()
            expect(sessionId).toEqual(sessionUUID)
        })
    })
})
