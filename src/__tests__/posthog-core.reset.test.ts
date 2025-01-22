import { PostHog } from '../posthog-core'
import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { USER_STATE } from '../constants'

describe('reset()', () => {
    let instance: PostHog

    beforeEach(async () => {
        instance = await createPosthogInstance(uuidv7(), {
            api_host: 'https://test.com',
            token: 'testtoken',
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

    describe('when calling reset(true)', () => {
        it('does reset the device id', () => {
            const initialDeviceId = instance.get_property('$device_id')

            instance.reset(true)

            const nextDeviceId = instance.get_property('$device_id')
            expect(initialDeviceId).not.toEqual(nextDeviceId)
        })
    })
})
