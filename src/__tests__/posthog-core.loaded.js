import { PostHog } from '../loaders/loader-module'
import { PostHogPersistence } from '../posthog-persistence'
import { RequestRouter } from '../utils/request-router'

jest.useFakeTimers()

given('lib', () => Object.assign(new PostHog(), given.overrides))

describe('loaded() with flags', () => {
    beforeAll(() => {
        jest.unmock('../decide')
    })

    given('subject', () => () => given.lib._loaded())

    given('overrides', () => ({
        config: given.config,
        capture: jest.fn(),
        featureFlags: {
            setReloadingPaused: jest.fn(),
            resetRequestQueue: jest.fn(),
            _startReloadTimer: jest.fn(),
            receivedFeatureFlags: jest.fn(),
        },
        requestRouter: new RequestRouter({ config: given.config }),
        _start_queue_if_opted_in: jest.fn(),
        persistence: new PostHogPersistence(given.config),
        _send_request: jest.fn(({ callback }) => callback?.({ status: 200, json: {} })),
    }))
    given('config', () => ({ loaded: jest.fn(), persistence: 'memory', api_host: 'https://app.posthog.com' }))

    describe('toggling flag reloading', () => {
        given('config', () => ({
            loaded: (ph) => {
                ph.group('org', 'bazinga', { name: 'Shelly' })
                setTimeout(() => {
                    ph.group('org', 'bazinga2', { name: 'Shelly' })
                }, 100)
            },
            persistence: 'memory',
            api_host: 'https://app.posthog.com',
        }))

        given('overrides', () => ({
            config: given.config,
            capture: jest.fn(),
            _send_request: jest.fn(({ callback }) => setTimeout(() => callback?.({ status: 200, json: {} }), 1000)),
            _start_queue_if_opted_in: jest.fn(),
            persistence: new PostHogPersistence(given.config),
            requestRouter: new RequestRouter({ config: given.config }),
        }))

        beforeEach(() => {
            jest.spyOn(given.lib.featureFlags, 'setGroupPropertiesForFlags')
            jest.spyOn(given.lib.featureFlags, 'setReloadingPaused')
            jest.spyOn(given.lib.featureFlags, '_startReloadTimer')
            jest.spyOn(given.lib.featureFlags, 'resetRequestQueue')
            jest.spyOn(given.lib.featureFlags, '_reloadFeatureFlagsRequest')
        })

        it('doesnt call flags while initial load is happening', () => {
            given.subject()

            jest.runOnlyPendingTimers()

            expect(given.lib.featureFlags.setGroupPropertiesForFlags).toHaveBeenCalled() // loaded ph.group() calls setGroupPropertiesForFlags
            expect(given.lib.featureFlags.setReloadingPaused).toHaveBeenCalledWith(true)
            expect(given.lib.featureFlags.resetRequestQueue).toHaveBeenCalledTimes(1)
            expect(given.lib.featureFlags._startReloadTimer).toHaveBeenCalled()
            expect(given.lib.featureFlags.setReloadingPaused).toHaveBeenCalledWith(false)

            // we should call _reloadFeatureFlagsRequest for `group` only after the initial load
            // because it ought to be paused until decide returns
            expect(given.overrides._send_request).toHaveBeenCalledTimes(1)
            expect(given.lib.featureFlags._reloadFeatureFlagsRequest).toHaveBeenCalledTimes(0)

            jest.runOnlyPendingTimers()
            expect(given.overrides._send_request).toHaveBeenCalledTimes(2)
            expect(given.lib.featureFlags._reloadFeatureFlagsRequest).toHaveBeenCalledTimes(1)
        })
    })

    it('toggles feature flags on and off', () => {
        given.subject()

        expect(given.overrides.featureFlags.setReloadingPaused).toHaveBeenCalledWith(true)
        expect(given.overrides.featureFlags.setReloadingPaused).toHaveBeenCalledWith(false)
        expect(given.overrides.featureFlags._startReloadTimer).toHaveBeenCalled()
        expect(given.overrides.featureFlags.receivedFeatureFlags).toHaveBeenCalledTimes(1)
    })
})
