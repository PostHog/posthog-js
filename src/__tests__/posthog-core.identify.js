import { PostHog } from '../posthog-core'
import { PostHogPersistence } from '../posthog-persistence'

jest.mock('../gdpr-utils', () => ({
    ...jest.requireActual('../gdpr-utils'),
    addOptOutCheck: (fn) => fn,
}))
jest.mock('../decide')

given('lib', () => Object.assign(new PostHog(), given.overrides))

describe('identify()', () => {
    given(
        'subject',
        () => () => given.lib.identify(given.identity, given.userPropertiesToSet, given.userPropertiesToSetOnce)
    )

    given('config', () => ({
        api_host: 'https://test.com',
        token: 'testtoken',
        persistence: 'localStorage',
    }))

    given('identity', () => 'a-new-id')

    given('overrides', () => ({
        get_distinct_id: () => given.oldIdentity,
        capture: jest.fn(),
        register: jest.fn(),
        register_once: jest.fn(),
        unregister: jest.fn(),
        get_property: () => given.deviceId,
        people: {
            set: jest.fn(),
            set_once: jest.fn(),
        },
        _flags: {},
        _captureMetrics: {
            incr: jest.fn(),
        },
        featureFlags: {
            setAnonymousDistinctId: jest.fn(),
        },
        reloadFeatureFlags: jest.fn(),
        persistence: new PostHogPersistence(given.config),
    }))

    given('properties', () => ({ $device_id: '123', __alias: 'efg' }))
    given('oldIdentity', () => 'oldIdentity')
    given('deviceId', () => given.oldIdentity)

    given('user_state', () => undefined)

    it('registers new user id and updates alias', () => {
        given.subject()

        expect(given.overrides.register).toHaveBeenCalledWith({ $user_id: 'a-new-id' })
        expect(given.overrides.register).toHaveBeenCalledWith({ distinct_id: 'a-new-id' })
    })

    it('calls capture when identity changes', () => {
        given('identity', () => 'a-new-id')
        given('oldIdentity', () => 'oldIdentity')

        given.subject()

        expect(given.overrides.capture).toHaveBeenCalledWith(
            '$identify',
            {
                distinct_id: 'a-new-id',
                $anon_distinct_id: 'oldIdentity',
            },
            { $set: {}, $set_once: {} }
        )
        expect(given.overrides.people.set).not.toHaveBeenCalled()
        expect(given.overrides.featureFlags.setAnonymousDistinctId).toHaveBeenCalledWith('oldIdentity')
    })

    it('calls capture when there is no device id', () => {
        given('deviceId', () => null)

        given.subject()

        expect(given.overrides.capture).toHaveBeenCalledWith(
            '$identify',
            {
                distinct_id: 'a-new-id',
                $anon_distinct_id: 'oldIdentity',
            },
            { $set: {}, $set_once: {} }
        )
        expect(given.overrides.people.set).not.toHaveBeenCalled()
        expect(given.overrides.featureFlags.setAnonymousDistinctId).toHaveBeenCalledWith('oldIdentity')
    })

    it('does not call capture when identify changes and device id does not match the oldIdentity', () => {
        /**
         * this is a proxy for back-to-back identify calls
         */
        given('identity', () => 'a-new-id')
        given('oldIdentity', () => 'oldIdentity')
        given('deviceId', () => 'not the oldIdentity')

        given.subject()

        expect(given.overrides.capture).not.toHaveBeenCalled()
        expect(given.overrides.people.set).not.toHaveBeenCalled()
        expect(given.overrides.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
    })

    it('does not call capture when identify changes and user state is not anonymous', () => {
        /**
         * user_state does not override existing behavior
         */
        given('identity', () => 'a-new-id')
        given('oldIdentity', () => 'oldIdentity')
        given('deviceId', () => 'not the oldIdentity')

        given.lib.persistence.set_user_state('identified')

        given.subject()

        expect(given.overrides.capture).not.toHaveBeenCalled()
        expect(given.overrides.people.set).not.toHaveBeenCalled()
        expect(given.overrides.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
    })

    it('does call capture when identify changes and device id does not match the oldIdentity but user is marked as anonymous', () => {
        given('identity', () => 'a-new-id')
        given('oldIdentity', () => 'oldIdentity')
        given('deviceId', () => 'not the oldIdentity')
        given.lib.persistence.set_user_state('anonymous')

        given.subject()

        expect(given.overrides.capture).toHaveBeenCalledWith(
            '$identify',
            {
                distinct_id: 'a-new-id',
                $anon_distinct_id: 'oldIdentity',
            },
            { $set: {}, $set_once: {} }
        )
    })

    it('calls capture with user properties if passed', () => {
        given('userPropertiesToSet', () => ({ email: 'john@example.com' }))
        given('userPropertiesToSetOnce', () => ({ howOftenAmISet: 'once!' }))

        given.subject()

        expect(given.overrides.capture).toHaveBeenCalledWith(
            '$identify',
            {
                distinct_id: 'a-new-id',
                $anon_distinct_id: 'oldIdentity',
            },
            { $set: { email: 'john@example.com' }, $set_once: { howOftenAmISet: 'once!' } }
        )
        expect(given.overrides.featureFlags.setAnonymousDistinctId).toHaveBeenCalledWith('oldIdentity')
    })

    describe('identity did not change', () => {
        given('oldIdentity', () => given.identity)

        it('does not capture or set user properties', () => {
            given.subject()

            expect(given.overrides.capture).not.toHaveBeenCalled()
            expect(given.overrides.people.set).not.toHaveBeenCalled()
            expect(given.overrides.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
        })

        it('calls people.set when user properties passed', () => {
            given('userPropertiesToSet', () => ({ email: 'john@example.com' }))
            given('userPropertiesToSetOnce', () => ({ howOftenAmISet: 'once!' }))

            given.subject()

            expect(given.overrides.capture).not.toHaveBeenCalled()
            expect(given.overrides.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
            expect(given.overrides.people.set).toHaveBeenCalledWith({ email: 'john@example.com' })
            expect(given.overrides.people.set_once).toHaveBeenCalledWith({ howOftenAmISet: 'once!' })
        })
    })

    describe('invalid id passed', () => {
        given('identity', () => null)

        it('does not update user', () => {
            console.error = jest.fn()

            given.subject()

            expect(given.overrides.capture).not.toHaveBeenCalled()
            expect(given.overrides.register).not.toHaveBeenCalled()
            expect(console.error).toHaveBeenCalledWith('Unique user id has not been set in posthog.identify')
        })
    })

    describe('reloading feature flags', () => {
        it('reloads when identity changes', () => {
            given.subject()

            expect(given.overrides.featureFlags.setAnonymousDistinctId).toHaveBeenCalledWith('oldIdentity')
            expect(given.overrides.reloadFeatureFlags).toHaveBeenCalled()
        })

        it('does not reload feature flags if identity does not change', () => {
            given('oldIdentity', () => given.identity)

            given.subject()

            expect(given.overrides.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
            expect(given.overrides.reloadFeatureFlags).not.toHaveBeenCalled()
        })

        it('does not reload feature flags if identity does not change but properties do', () => {
            given('oldIdentity', () => given.identity)
            given('userPropertiesToSet', () => ({ email: 'john@example.com' }))
            given('userPropertiesToSetOnce', () => ({ howOftenAmISet: 'once!' }))

            given.subject()
            expect(given.overrides.featureFlags.setAnonymousDistinctId).not.toHaveBeenCalled()
            expect(given.overrides.reloadFeatureFlags).not.toHaveBeenCalled()
        })
    })
})

describe('reset()', () => {
    given('subject', () => () => given.lib.reset())

    given('config', () => ({
        api_host: 'https://test.com',
        token: 'testtoken',
        persistence: 'localStorage',
    }))

    given('overrides', () => ({
        persistence: new PostHogPersistence(given.config),
    }))

    beforeEach(() => {
        given.lib._init('testtoken', given.config, 'testhog')
    })

    it('clears persistence', () => {
        given.lib.persistence.register({ $enabled_feature_flags: { flag: 'variant', other: true } })
        expect(given.lib.persistence.props['$enabled_feature_flags']).toEqual({ flag: 'variant', other: true })
        given.subject()
        expect(given.lib.persistence.props['$enabled_feature_flags']).toEqual(undefined)
    })

    it('resets the session_id and window_id', () => {
        const initialSessionAndWindowId = given.lib.sessionManager.checkAndGetSessionAndWindowId()
        given.subject()
        const nextSessionAndWindowId = given.lib.sessionManager.checkAndGetSessionAndWindowId()
        expect(initialSessionAndWindowId.sessionId).not.toEqual(nextSessionAndWindowId.sessionId)
        expect(initialSessionAndWindowId.windowId).not.toEqual(nextSessionAndWindowId.windowId)
    })

    it('sets the user as anonymous', () => {
        given.lib.persistence.set_user_state('identified')

        given.subject()

        expect(given.lib.persistence.get_user_state()).toEqual('anonymous')
    })
})
