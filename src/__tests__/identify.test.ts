/* eslint-disable compat/compat */
import { v4 } from 'uuid'
import { PostHogTestHarness, createPostHogTestHarness, createPosthogInstance } from './helpers/posthog-instance'
import { logger } from '../utils/logger'
import { PostHog } from '../posthog-core'
jest.mock('../utils/logger')

describe('identify', () => {
    let _: PostHogTestHarness
    let posthog: PostHog

    beforeEach(async () => {
        _ = await createPostHogTestHarness(v4(), {
            disable_compression: true,
            api_transport: 'fetch',
        })
        posthog = _.posthog
    })

    it('registers new user id and updates alias', () => {
        const deviceId = posthog.get_device_id()
        posthog.identify('a-new-id')

        expect(posthog.get_distinct_id()).toEqual('a-new-id')
        expect(posthog.get_device_id()).toEqual(deviceId)
        expect(posthog.get_distinct_id()).not.toEqual(deviceId)

        expect(posthog.persistence!.properties()).toMatchObject({
            $user_id: 'a-new-id',
            distinct_id: 'a-new-id',
            $device_id: deviceId,
        })
    })

    it('calls capture when identity changes', () => {
        const deviceId = posthog.get_device_id()
        posthog.identify('a-new-id')

        expect(_.decodeFetchRequests()[0].json).toMatchObject({
            event: '$identify',
            properties: {
                distinct_id: 'a-new-id',
                $anon_distinct_id: deviceId,
            },
        })

        expect(posthog.featureFlags.$anon_distinct_id).toEqual(deviceId)
    })

    it('calls capture when there is no device id', () => {
        posthog.persistence!.unregister('$device_id')
        expect(posthog.get_device_id()).toBeUndefined()

        expect(_.decodeFetchRequests()[0].json).toMatchObject({
            event: '$identify',
            properties: {
                distinct_id: 'a-new-id',
                $anon_distinct_id: expect.any(String),
            },
        })

        expect(posthog.featureFlags.$anon_distinct_id).toEqual(posthog.get_device_id())
    })

    it('shows as identified', () => {
        expect(posthog.is_identified()).toEqual(false)
        posthog.identify('a-new-id')
        expect(posthog.is_identified()).toEqual(true)
    })

    it('does not call capture when already identified (distinct_id changes and device id does not match the oldIdentity)', () => {
        /**
         * originally this was a proxy for back-to-back identify calls
         */
        posthog.persistence!.register({ $device_id: 'something else', distinct_id: 'oldIdentity' })
        posthog.identify('a-new-id')

        expect(_.decodeFetchRequests()).toHaveLength(0)
    })

    it('calls capture with user properties if passed', () => {
        const deviceId = posthog.get_device_id()
        posthog.identify(
            'a-new-id',
            {
                email: 'john@example.com',
            },
            {
                howOftenAmISet: 'once!',
            }
        )

        expect(_.decodeFetchRequests()[0].json).toMatchObject({
            event: '$identify',
            properties: {
                distinct_id: 'a-new-id',
                $anon_distinct_id: deviceId,
                $set: { email: 'john@example.com' },
                $set_once: { howOftenAmISet: 'once!' },
            },
        })
    })

    // describe('identity did not change', () => {
    //     given('oldIdentity', () => given.identity)

    //     it('does not capture or set user properties', () => {
    //         given.subject()

    //         expect(given.overrides.capture).not.toHaveBeenCalled()
    //         expect(given.overrides.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
    //     })

    //     it('calls $set when user properties passed with same ID', () => {
    //         given('userPropertiesToSet', () => ({ email: 'john@example.com' }))
    //         given('userPropertiesToSetOnce', () => ({ howOftenAmISet: 'once!' }))

    //         given.subject()

    //         expect(given.overrides.capture).toHaveBeenCalledWith('$set', {
    //             $set: { email: 'john@example.com' },
    //             $set_once: { howOftenAmISet: 'once!' },
    //         })
    //         expect(given.overrides.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
    //     })
    // })

    // describe('invalid id passed', () => {
    //     given('identity', () => null)

    //     it('does not update user', () => {
    //         console.error = jest.fn()

    //         given.lib.debug()
    //         given.subject()

    //         expect(given.overrides.capture).not.toHaveBeenCalled()
    //         expect(given.overrides.register).not.toHaveBeenCalled()
    //         expect(console.error).toHaveBeenCalledWith(
    //             '[PostHog.js]',
    //             'Unique user id has not been set in posthog.identify'
    //         )
    //     })
    // })

    // describe('reloading feature flags', () => {
    //     it('reloads when identity changes', () => {
    //         given.subject()

    //         expect(given.overrides.featureFlags.setAnonymousDistinctId).toHaveBeenCalledWith('oldIdentity')
    //         expect(given.overrides.reloadFeatureFlags).toHaveBeenCalled()
    //     })

    //     it('does not reload feature flags if identity does not change', () => {
    //         given('oldIdentity', () => given.identity)

    //         given.subject()

    //         expect(given.overrides.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
    //         expect(given.overrides.reloadFeatureFlags).not.toHaveBeenCalled()
    //     })

    //     it('reloads feature flags if identity does not change but properties do', () => {
    //         given('oldIdentity', () => given.identity)
    //         given('userPropertiesToSet', () => ({ email: 'john@example.com' }))
    //         given('userPropertiesToSetOnce', () => ({ howOftenAmISet: 'once!' }))

    //         given.subject()
    //         expect(given.overrides.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
    //         expect(given.overrides.reloadFeatureFlags).not.toHaveBeenCalled()
    //         expect(given.overrides.setPersonPropertiesForFlags).toHaveBeenCalledWith({ email: 'john@example.com' })
    //     })

    //     it('reloads feature flags if identity and properties change', () => {
    //         given('userPropertiesToSet', () => ({ email: 'john@example.com' }))
    //         given('userPropertiesToSetOnce', () => ({ howOftenAmISet: 'once!' }))

    //         given.subject()
    //         expect(given.overrides.featureFlags.setAnonymousDistinctId).toHaveBeenCalledWith('oldIdentity')
    //         expect(given.overrides.reloadFeatureFlags).toHaveBeenCalled()
    //         expect(given.overrides.setPersonPropertiesForFlags).toHaveBeenCalledWith(
    //             { email: 'john@example.com' },
    //             false
    //         )
    //     })

    //     it('clears flag calls reported when identity changes', () => {
    //         given.subject()
    //         expect(given.overrides.unregister).toHaveBeenCalledWith('$flag_call_reported')
    //     })
    // })

    // describe('setPersonProperties', () => {
    //     given('oldIdentity', () => given.identity)

    //     it('captures a $set event', () => {
    //         given('subject', () => () => {
    //             given.lib.setPersonProperties(given.userPropertiesToSet, given.userPropertiesToSetOnce)
    //         })
    //         given('userPropertiesToSet', () => ({ email: 'john@example.com' }))
    //         given('userPropertiesToSetOnce', () => ({ name: 'john' }))

    //         given.subject()

    //         expect(given.overrides.capture).toHaveBeenCalledWith('$set', {
    //             $set: { email: 'john@example.com' },
    //             $set_once: { name: 'john' },
    //         })
    //     })

    //     it('calls proxies prople.set to setPersonProperties', () => {
    //         given('subject', () => () => {
    //             given.lib.people.set(given.userPropertiesToSet)
    //         })
    //         given('userPropertiesToSet', () => ({ email: 'john@example.com' }))

    //         given.subject()

    //         expect(given.overrides.capture).toHaveBeenCalledWith('$set', {
    //             $set: { email: 'john@example.com' },
    //             $set_once: {},
    //         })
    //         expect(given.overrides.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
    //     })

    //     it('calls proxies prople.set_once to setPersonProperties', () => {
    //         given('subject', () => () => {
    //             given.lib.people.set_once(given.userPropertiesToSetOnce)
    //         })
    //         given('userPropertiesToSetOnce', () => ({ email: 'john@example.com' }))

    //         given.subject()

    //         expect(given.overrides.capture).toHaveBeenCalledWith('$set', {
    //             $set: {},
    //             $set_once: { email: 'john@example.com' },
    //         })
    //         expect(given.overrides.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
    //     })
    // })

    // Note that there are other tests for identify in posthog-core.identify.js
    // These are in the old style of tests, if you are feeling helpful you could
    // convert them to the new style in this file.

    it('should persist the distinct_id', async () => {
        // arrange
        const token = v4()
        const posthog = await createPosthogInstance(token)
        const distinctId = '123'

        // act
        posthog.identify(distinctId)

        // assert
        expect(posthog.persistence!.properties()['$user_id']).toEqual(distinctId)
        expect(jest.mocked(logger).error).toBeCalledTimes(0)
        expect(jest.mocked(logger).warn).toBeCalledTimes(0)
    })

    it('should convert a numeric distinct_id to a string', async () => {
        // arrange
        const token = v4()
        const posthog = await createPosthogInstance(token)
        const distinctIdNum = 123
        const distinctIdString = '123'

        // act
        posthog.identify(distinctIdNum as any)

        // assert
        expect(posthog.persistence!.properties()['$user_id']).toEqual(distinctIdString)
        expect(jest.mocked(logger).error).toBeCalledTimes(0)
        expect(jest.mocked(logger).warn).toBeCalledTimes(1)
    })
})
