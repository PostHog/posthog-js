import { USER_STATE } from '../constants'
import { PostHog } from '../posthog-core'
import { assignableWindow } from '../utils/globals'
import { uuidv7 } from '../uuidv7'
import { defaultPostHog } from './helpers/posthog-instance'

describe('identify()', () => {
    let instance: PostHog
    let beforeSendMock: jest.Mock

    beforeEach(() => {
        beforeSendMock = jest.fn().mockImplementation((e) => e)
        const token = uuidv7()
        // NOTE: Temporary change whilst testing remote config
        assignableWindow._POSTHOG_REMOTE_CONFIG = {
            [token]: {
                config: {},
                siteApps: [],
            },
        } as any

        const posthog = defaultPostHog().init(
            token,
            {
                api_host: 'https://test.com',
                before_send: beforeSendMock,
                disable_surveys: true,
            },
            token
        )

        instance = Object.assign(posthog, {
            register: jest.fn(),
            featureFlags: {
                setAnonymousDistinctId: jest.fn(),
                setPersonPropertiesForFlags: jest.fn(),
                reloadFeatureFlags: jest.fn(),
            },
            unregister: jest.fn(),
        })

        instance.persistence!.set_property(USER_STATE, 'anonymous')
        instance.persistence!.props['distinct_id'] = 'oldIdentity'
        instance.persistence!.props['$device_id'] = 'oldIdentity'
    })

    it('registers new user id and updates alias', () => {
        instance.identify('a-new-id')

        expect(instance.register).toHaveBeenCalledWith({ $user_id: 'a-new-id' })
        expect(instance.register).toHaveBeenCalledWith({ distinct_id: 'a-new-id' })
    })

    it('calls capture when identity changes', () => {
        instance.persistence!.props['distinct_id'] = 'oldIdentity'

        instance.identify('calls capture when identity changes')

        expect(beforeSendMock).toHaveBeenCalledWith(
            expect.objectContaining({
                event: '$identify',
                properties: expect.objectContaining({
                    distinct_id: 'calls capture when identity changes',
                    $anon_distinct_id: 'oldIdentity',
                }),
            })
        )
        expect(instance.featureFlags.setAnonymousDistinctId).toHaveBeenCalledWith('oldIdentity')
    })

    it('sets user state when identifying', () => {
        instance.persistence!.props['distinct_id'] = 'oldIdentity'

        instance.identify('calls capture when identity changes')

        expect(instance.persistence!.get_property(USER_STATE)).toEqual('identified')
    })

    it('adds props to next capture when there is no device id', () => {
        instance.persistence!.set_property('$device_id', null)
        instance.persistence!.set_property('distinct_id', 'oldIdentity')

        instance.identify('a-new-id')

        expect(beforeSendMock).toHaveBeenCalledWith(
            expect.objectContaining({
                event: '$identify',
                properties: expect.objectContaining({
                    distinct_id: 'a-new-id',
                    $anon_distinct_id: 'oldIdentity',
                }),
            })
        )
        expect(instance.featureFlags.setAnonymousDistinctId).toHaveBeenCalledWith('oldIdentity')
    })

    it('calls capture when there is no device id (on first check) even if user is not set to anonymous', () => {
        instance.persistence!.set_property(USER_STATE, undefined)
        instance.persistence!.props['distinct_id'] = 'oldIdentity'
        instance.persistence!.props['$device_id'] = null

        instance.identify('a-new-id')

        expect(beforeSendMock).toHaveBeenCalledWith(
            expect.objectContaining({
                event: '$identify',
                properties: expect.objectContaining({
                    distinct_id: 'a-new-id',
                    $anon_distinct_id: 'oldIdentity',
                }),
            })
        )
        expect(instance.featureFlags.setAnonymousDistinctId).toHaveBeenCalledWith('oldIdentity')
    })

    it('does not call capture when distinct_id changes and device id does not match the oldIdentity', () => {
        /**
         * originally this was a proxy for back-to-back identify calls
         */
        instance.persistence!.props['$device_id'] = 'not the oldIdentity'
        // now this is set explicitly by identify
        instance.persistence!.set_property(USER_STATE, 'identified')

        instance.persistence!.props['distinct_id'] = 'oldIdentity'

        instance.identify('a-new-id')

        expect(beforeSendMock).not.toHaveBeenCalled()
        expect(instance.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
    })

    it('does not call capture when distinct_id changes, device id does not match the previous distinct id, and user state is not anonymous', () => {
        /**
         * user_state does not override existing behavior
         */
        instance.persistence!.props['distinct_id'] = 'oldIdentity'
        instance.persistence!.props['$device_id'] = 'not the oldIdentity'

        instance.persistence!.set_property(USER_STATE, 'identified')

        instance.identify('a-new-id')

        expect(beforeSendMock).not.toHaveBeenCalled()
        expect(instance.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
    })

    it('does call capture when distinct_id changes and device id does not match the previous_id but user is marked as anonymous', () => {
        instance.persistence!.props['distinct_id'] = 'oldIdentity'
        instance.persistence!.props['$device_id'] = 'not the oldIdentity'
        instance.persistence!.set_property(USER_STATE, 'anonymous')

        instance.identify('a-new-id')

        expect(beforeSendMock).toHaveBeenCalledWith(
            expect.objectContaining({
                event: '$identify',
                properties: expect.objectContaining({
                    distinct_id: 'a-new-id',
                    $anon_distinct_id: 'oldIdentity',
                }),
            })
        )
    })

    it('calls capture with user properties if passed', () => {
        instance.identify('a-new-id', { email: 'john@example.com' }, { howOftenAmISet: 'once!' })

        expect(beforeSendMock).toHaveBeenCalledWith(
            expect.objectContaining({
                event: '$identify',
                properties: expect.objectContaining({
                    distinct_id: 'a-new-id',
                    $anon_distinct_id: 'oldIdentity',
                }),
                $set: { email: 'john@example.com' },
                $set_once: expect.objectContaining({ howOftenAmISet: 'once!' }),
            })
        )
        expect(instance.featureFlags.setAnonymousDistinctId).toHaveBeenCalledWith('oldIdentity')
    })

    describe('identity did not change', () => {
        beforeEach(() => {
            // set the current/old identity
            instance.persistence!.props['distinct_id'] = 'a-new-id'
        })

        it('does not capture or set user properties', () => {
            instance.identify('a-new-id')

            expect(beforeSendMock).not.toHaveBeenCalled()
            expect(instance.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
        })

        it('calls $set when user properties passed with same ID', () => {
            instance.identify('a-new-id', { email: 'john@example.com' }, { howOftenAmISet: 'once!' })

            expect(beforeSendMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: '$set',
                    // get set at the top level and in properties
                    // $set: { email: 'john@example.com' },
                    // $set_once: expect.objectContaining({ howOftenAmISet: 'once!' }),
                    properties: expect.objectContaining({
                        $set: { email: 'john@example.com' },
                        $set_once: expect.objectContaining({ howOftenAmISet: 'once!' }),
                    }),
                })
            )
            expect(instance.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
        })

        it('does not call $set when duplicate properties are passed', () => {
            instance.identify('a-new-id', { email: 'john@example.com' }, { howOftenAmISet: 'once!' })
            instance.identify('a-new-id', { email: 'john@example.com' }, { howOftenAmISet: 'once!' })

            expect(beforeSendMock).toHaveBeenCalledTimes(1)
            expect(instance.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
        })

        it('calls $set when different properties are passed with the same distinct_id', () => {
            instance.identify('a-new-id', { email: 'john@example.com' }, { howOftenAmISet: 'once!' })
            instance.identify('a-new-id', { email: 'john@example.com' }, { howOftenAmISet: 'twice!' })

            expect(beforeSendMock).toHaveBeenCalledTimes(2)
            expect(instance.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
        })
    })

    describe('invalid id passed', () => {
        it('does not update user', () => {
            console.error = jest.fn()

            instance.debug()

            instance.identify(null as unknown as string)

            expect(beforeSendMock).not.toHaveBeenCalled()
            expect(instance.register).not.toHaveBeenCalled()
            expect(console.error).toHaveBeenCalledWith(
                '[PostHog.js]',
                'Unique user id has not been set in posthog.identify'
            )
        })
    })

    describe('reloading feature flags', () => {
        it('reloads when identity changes', () => {
            instance.identify('a-new-id')

            expect(instance.featureFlags.setAnonymousDistinctId).toHaveBeenCalledWith('oldIdentity')
            expect(instance.featureFlags.reloadFeatureFlags).toHaveBeenCalled()
        })

        it('does not reload feature flags if identity does not change', () => {
            instance.persistence!.props['distinct_id'] = 'a-new-id'

            instance.identify('a-new-id')

            expect(instance.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
            expect(instance.featureFlags.reloadFeatureFlags).not.toHaveBeenCalled()
        })

        it('reloads feature flags if identity does not change but properties do', () => {
            instance.persistence!.props['distinct_id'] = 'a-new-id'

            instance.identify('a-new-id', { email: 'john@example.com' }, { howOftenAmISet: 'once!' })

            expect(instance.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
            expect(instance.featureFlags.reloadFeatureFlags).not.toHaveBeenCalled()
            expect(instance.featureFlags.setPersonPropertiesForFlags).toHaveBeenCalledWith(
                { email: 'john@example.com' },
                true
            )
        })

        it('reloads feature flags if identity and properties change', () => {
            instance.identify('a-new-id', { email: 'john@example.com' }, { howOftenAmISet: 'once!' })

            expect(instance.featureFlags.setAnonymousDistinctId).toHaveBeenCalledWith('oldIdentity')
            expect(instance.featureFlags.reloadFeatureFlags).toHaveBeenCalled()
            expect(instance.featureFlags.setPersonPropertiesForFlags).toHaveBeenCalledWith(
                { email: 'john@example.com' },
                false
            )
        })

        it('clears flag calls reported when identity changes', () => {
            instance.identify('a-new-id')

            expect(instance.unregister).toHaveBeenCalledWith('$flag_call_reported')
        })
    })

    describe('setPersonProperties', () => {
        beforeEach(() => {
            instance.persistence!.props['distinct_id'] = 'a-new-id'
        })

        it('captures a $set event', () => {
            instance.setPersonProperties({ email: 'john@example.com' }, { name: 'john' })

            expect(beforeSendMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: '$set',
                    // get set at the top level and in properties
                    // $set: { email: 'john@example.com' },
                    // $set_once: expect.objectContaining({ name: 'john' }),
                    properties: expect.objectContaining({
                        $set: { email: 'john@example.com' },
                        $set_once: { name: 'john' },
                    }),
                })
            )
        })

        it('calls proxies prople.set to setPersonProperties', () => {
            instance.people.set({ email: 'john@example.com' })

            expect(beforeSendMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: '$set',
                    properties: expect.objectContaining({
                        $set: { email: 'john@example.com' },
                        $set_once: {},
                    }),
                })
            )
            expect(instance.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
        })

        it('calls proxies prople.set_once to setPersonProperties', () => {
            instance.people.set_once({ email: 'john@example.com' })

            expect(beforeSendMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: '$set',
                    properties: expect.objectContaining({
                        $set: {},
                        $set_once: { email: 'john@example.com' },
                    }),
                })
            )
            expect(instance.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
        })
    })
})
