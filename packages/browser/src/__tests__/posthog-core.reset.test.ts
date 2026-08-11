import { PostHog } from '../posthog-core'
import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { COOKIELESS_SENTINEL_VALUE, USER_STATE } from '../constants'

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

    it('warns through the real console path when reset opts out with debug disabled', async () => {
        instance = await createPosthogInstance(uuidv7(), {
            api_host: 'https://test.com',
            token: 'testtoken',
            before_send: beforeSendMock,
            debug: false,
            opt_out_capturing_by_default: true,
        })
        instance.opt_in_capturing({ captureEventName: false })
        console.warn = jest.fn()

        instance.reset()

        expect(instance.config.debug).toBe(false)
        expect(console.warn).toHaveBeenCalledWith(
            '[PostHog.js]',
            expect.stringContaining('reset() cleared the stored consent')
        )
    })

    it('resets the logs extension so buffered logs are dropped', () => {
        const logsReset = jest.spyOn(instance.logs, 'reset')

        instance.reset()

        expect(logsReset).toHaveBeenCalled()
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

    it('reloads feature flags for the new anonymous user', async () => {
        const callFlags = jest.spyOn(instance.featureFlags, '_callFlagsEndpoint')

        instance.reset()
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(callFlags).toHaveBeenCalledTimes(1)
    })

    it('does not reload twice in existing call sites which manually invoke reloadFeatureFlags', async () => {
        const callFlags = jest.spyOn(instance.featureFlags, '_callFlagsEndpoint')

        instance.reset()
        instance.reloadFeatureFlags()
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(callFlags).toHaveBeenCalledTimes(1)
    })

    describe('when calling reset(true)', () => {
        it('does reset the device id', () => {
            const initialDeviceId = instance.get_property('$device_id')

            instance.reset(true)

            const nextDeviceId = instance.get_property('$device_id')
            expect(initialDeviceId).not.toEqual(nextDeviceId)
        })
    })

    describe('when calling reset with options', () => {
        it('resets the device id when resetDeviceID is true', () => {
            const initialDeviceId = instance.get_property('$device_id')

            instance.reset({ resetDeviceID: true })

            expect(instance.get_property('$device_id')).not.toEqual(initialDeviceId)
        })

        it('preserves the device id when resetDeviceID is false', () => {
            const initialDeviceId = instance.get_property('$device_id')

            instance.reset({ resetDeviceID: false })

            expect(instance.get_property('$device_id')).toEqual(initialDeviceId)
        })

        it('applies a custom anonymous distinct ID and preserves the device ID', () => {
            const initialDeviceId = instance.get_property('$device_id')

            instance.reset({ bootstrap: { distinctID: 'custom-anon-id', isIdentifiedID: false } })

            expect(instance.get_distinct_id()).toEqual('custom-anon-id')
            expect(instance.get_property('$device_id')).toEqual(initialDeviceId)
            expect(instance.persistence!.get_property(USER_STATE)).toEqual('anonymous')
        })

        it('applies a custom identified distinct ID and preserves the device ID', () => {
            const initialDeviceId = instance.get_property('$device_id')

            instance.reset({ bootstrap: { distinctID: 'user@example.com', isIdentifiedID: true } })

            expect(instance.get_distinct_id()).toEqual('user@example.com')
            expect(instance.get_property('$device_id')).toEqual(initialDeviceId)
            expect(instance.persistence!.get_property(USER_STATE)).toEqual('identified')
        })

        it('resets the device ID when combined with bootstrap options', () => {
            const initialDeviceId = instance.get_property('$device_id')

            instance.reset({
                resetDeviceID: true,
                bootstrap: { distinctID: 'custom-anon-id', isIdentifiedID: false },
            })

            expect(instance.get_distinct_id()).toEqual('custom-anon-id')
            expect(instance.get_property('$device_id')).not.toEqual(initialDeviceId)
            expect(instance.get_property('$device_id')).not.toEqual('custom-anon-id')
        })

        it('applies bootstrapped feature flags and payloads', () => {
            instance.reset({
                bootstrap: {
                    featureFlags: {
                        'active-flag': true,
                        'variant-flag': 'control',
                        'false-payload-flag': true,
                        'zero-payload-flag': true,
                        'empty-payload-flag': true,
                        'inactive-flag': false,
                    },
                    featureFlagPayloads: {
                        'active-flag': { key: 'value' },
                        'false-payload-flag': false,
                        'zero-payload-flag': 0,
                        'empty-payload-flag': '',
                        'inactive-flag': { should: 'not appear' },
                    },
                },
            })

            expect(instance.featureFlags.getFlags()).toEqual([
                'active-flag',
                'variant-flag',
                'false-payload-flag',
                'zero-payload-flag',
                'empty-payload-flag',
            ])
            expect(instance.featureFlags.getFlagVariants()).toEqual({
                'active-flag': true,
                'variant-flag': 'control',
                'false-payload-flag': true,
                'zero-payload-flag': true,
                'empty-payload-flag': true,
            })
            expect(instance.featureFlags.getFeatureFlagPayload('active-flag')).toEqual({ key: 'value' })
            expect(instance.featureFlags.getFeatureFlagPayload('false-payload-flag')).toBe(false)
            expect(instance.featureFlags.getFeatureFlagPayload('zero-payload-flag')).toBe(0)
            expect(instance.featureFlags.getFeatureFlagPayload('empty-payload-flag')).toBe('')
            expect(instance.featureFlags.getFeatureFlagPayload('inactive-flag')).toEqual(undefined)
        })

        it('clears earlier bootstrap values on a later plain reset', () => {
            instance.reset({
                bootstrap: {
                    distinctID: 'custom-anon-id',
                    featureFlags: { 'active-flag': true },
                    sessionID: uuidv7(),
                },
            })

            instance.reset()

            expect(instance.config.bootstrap).toEqual({})
            expect(instance.featureFlags.getFlags()).toEqual([])
        })

        it('rejects an invalid bootstrap session ID before clearing state', () => {
            const initialDistinctId = instance.get_distinct_id()
            const initialSessionId = instance.sessionManager!.checkAndGetSessionAndWindowId().sessionId

            expect(() => instance.reset({ bootstrap: { sessionID: 'invalid-session-id' } })).toThrow('Not a valid UUID')

            expect(instance.get_distinct_id()).toEqual(initialDistinctId)
            expect(instance.sessionManager!.checkAndGetSessionAndWindowId().sessionId).toEqual(initialSessionId)
        })

        it('rejects a future bootstrap session ID before clearing state', () => {
            const initialDistinctId = instance.get_distinct_id()
            const futureTimestampHex = (Date.now() + 23 * 60 * 60 * 1000).toString(16).padStart(12, '0')
            const futureSessionID = `${futureTimestampHex.slice(0, 8)}-${futureTimestampHex.slice(
                8
            )}-7000-8000-000000000000`

            expect(() => instance.reset({ bootstrap: { sessionID: futureSessionID } })).toThrow(
                'Bootstrap sessionID cannot be in the future'
            )

            expect(instance.get_distinct_id()).toEqual(initialDistinctId)
        })

        it('applies a bootstrapped session ID and rotates the window', () => {
            const initialIds = instance.sessionManager!.checkAndGetSessionAndWindowId()
            const onSessionId = jest.fn()
            instance.onSessionId(onSessionId)
            onSessionId.mockClear()
            const sessionID = uuidv7()

            instance.reset({ bootstrap: { sessionID } })

            const nextIds = instance.sessionManager!.checkAndGetSessionAndWindowId()
            expect(nextIds.sessionId).toEqual(sessionID)
            expect(nextIds.windowId).not.toEqual(initialIds.windowId)
            expect(onSessionId).toHaveBeenCalledWith(sessionID, nextIds.windowId, {
                noSessionId: true,
                activityTimeout: false,
                sessionPastMaximumLength: false,
                crossTabAdoption: false,
            })
        })

        it('does not replace the cookieless sentinel with a bootstrapped distinct ID', async () => {
            instance = await createPosthogInstance(uuidv7(), {
                api_host: 'https://test.com',
                token: 'testtoken',
                cookieless_mode: 'always',
            })

            instance.reset({ bootstrap: { distinctID: 'custom-anon-id' } })

            expect(instance.get_distinct_id()).toEqual(COOKIELESS_SENTINEL_VALUE)
        })
    })
})
