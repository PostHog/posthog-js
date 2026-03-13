import { PostHog } from '../posthog-core'
import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { USER_STATE } from '../constants'

describe('reset()', () => {
    let instance: PostHog
    let beforeSendMock: vi.Mock

    beforeEach(async () => {
        beforeSendMock = vi.fn().mockImplementation((e) => e)

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

        const mockCallback = vi.fn()
        instance.featureFlags.onFeatureFlags(mockCallback)

        expect(mockCallback).not.toHaveBeenCalled()
    })

    it('reloads feature flags for the new anonymous user', async () => {
        const callFlags = vi.spyOn(instance.featureFlags, '_callFlagsEndpoint')

        instance.reset()
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(callFlags).toHaveBeenCalledTimes(1)
    })

    it('does not reload twice in existing call sites which manually invoke reloadFeatureFlags', async () => {
        const callFlags = vi.spyOn(instance.featureFlags, '_callFlagsEndpoint')

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
})
