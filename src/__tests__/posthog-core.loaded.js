import { PostHog } from '../posthog-core'
import { PostHogPersistence } from '../posthog-persistence'

jest.useFakeTimers()

given('lib', () => Object.assign(new PostHog(), given.overrides))

describe('loaded() with flags', () => {
    beforeAll(() => {
        jest.unmock('../decide')
    })

    given('subject', () => () => given.lib._loaded())

    given('overrides', () => ({
        get_config: (key) => given.config?.[key],
        capture: jest.fn(),
        featureFlags: {
            setReloadingPaused: jest.fn(),
            _startReloadTimer: jest.fn(),
            receivedFeatureFlags: jest.fn(),
        },
        _start_queue_if_opted_in: jest.fn(),
        persistence: new PostHogPersistence(given.config),
        _send_request: jest.fn((host, data, header, callback) => callback({ status: 200 })),
    }))
    given('config', () => ({ loaded: jest.fn(), persistence: 'memory' }))

    describe('toggling flag reloading', () => {
        given('config', () => ({
            loaded: (ph) => {
                ph.group('org', 'bazinga', { name: 'Shelly' })
                setTimeout(() => {
                    ph.group('org', 'bazinga2', { name: 'Shelly' })
                }, 100)
            },
            persistence: 'memory',
        }))

        given('overrides', () => ({
            get_config: (key) => given.config?.[key],
            capture: jest.fn(),
            _send_request: jest.fn((host, data, header, callback) => setTimeout(() => callback({ status: 200 }), 1000)),
            _start_queue_if_opted_in: jest.fn(),
            persistence: new PostHogPersistence(given.config),
        }))

        beforeEach(() => {
            jest.spyOn(given.lib.featureFlags, 'setGroupPropertiesForFlags')
            jest.spyOn(given.lib.featureFlags, 'setReloadingPaused')
            jest.spyOn(given.lib.featureFlags, '_startReloadTimer')
            jest.spyOn(given.lib.featureFlags, '_reloadFeatureFlagsRequest')
        })

        it('doesnt call flags while initial load is happening', () => {
            given.subject()

            jest.runOnlyPendingTimers()

            expect(given.lib.featureFlags.setGroupPropertiesForFlags).toHaveBeenCalled() // loaded ph.group() calls setGroupPropertiesForFlags
            expect(given.lib.featureFlags.setReloadingPaused).toHaveBeenCalledWith(true)
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
