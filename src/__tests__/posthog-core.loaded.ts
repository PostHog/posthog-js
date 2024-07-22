import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { PostHog } from '../posthog-core'

jest.useFakeTimers()

describe('loaded() with flags', () => {
    let instance: PostHog
    const config = { loaded: jest.fn(), api_host: 'https://app.posthog.com' }

    const overrides = {
        capture: jest.fn(),
        _send_request: jest.fn(({ callback }) => callback?.({ status: 200, json: {} })),
        _start_queue_if_opted_in: jest.fn(),
    }

    beforeAll(() => {
        jest.unmock('../decide')
    })

    beforeEach(async () => {
        const posthog = await createPosthogInstance(uuidv7(), config)
        instance = Object.assign(posthog, {
            ...overrides,
            featureFlags: {
                setReloadingPaused: jest.fn(),
                resetRequestQueue: jest.fn(),
                _startReloadTimer: jest.fn(),
                receivedFeatureFlags: jest.fn(),
            },
            _send_request: jest.fn(({ callback }) => callback?.({ status: 200, json: {} })),
        })
    })

    describe('toggling flag reloading', () => {
        beforeEach(async () => {
            const posthog = await createPosthogInstance(uuidv7(), {
                ...config,
                loaded: (ph) => {
                    ph.group('org', 'bazinga', { name: 'Shelly' })
                    setTimeout(() => {
                        ph.group('org', 'bazinga2', { name: 'Shelly' })
                    }, 100)
                },
            })
            instance = Object.assign(posthog, overrides)

            jest.spyOn(instance.featureFlags, 'setGroupPropertiesForFlags')
            jest.spyOn(instance.featureFlags, 'setReloadingPaused')
            jest.spyOn(instance.featureFlags, '_startReloadTimer')
            jest.spyOn(instance.featureFlags, 'resetRequestQueue')
            jest.spyOn(instance.featureFlags, '_reloadFeatureFlagsRequest')
        })

        it('doesnt call flags while initial load is happening', () => {
            instance._loaded()

            jest.runOnlyPendingTimers()

            expect(instance.featureFlags.setGroupPropertiesForFlags).toHaveBeenCalled() // loaded ph.group() calls setGroupPropertiesForFlags
            expect(instance.featureFlags.setReloadingPaused).toHaveBeenCalledWith(true)
            expect(instance.featureFlags.resetRequestQueue).toHaveBeenCalledTimes(1)
            expect(instance.featureFlags._startReloadTimer).toHaveBeenCalled()
            expect(instance.featureFlags.setReloadingPaused).toHaveBeenCalledWith(false)

            // we should call _reloadFeatureFlagsRequest for `group` only after the initial load
            // because it ought to be paused until decide returns
            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance.featureFlags._reloadFeatureFlagsRequest).toHaveBeenCalledTimes(0)

            jest.runOnlyPendingTimers()
            expect(instance._send_request).toHaveBeenCalledTimes(2)
            expect(instance.featureFlags._reloadFeatureFlagsRequest).toHaveBeenCalledTimes(1)
        })
    })

    it('toggles feature flags on and off', () => {
        instance._loaded()

        expect(instance.featureFlags.setReloadingPaused).toHaveBeenCalledWith(true)
        expect(instance.featureFlags.setReloadingPaused).toHaveBeenCalledWith(false)
        expect(instance.featureFlags._startReloadTimer).toHaveBeenCalled()
        expect(instance.featureFlags.receivedFeatureFlags).toHaveBeenCalledTimes(1)
    })
})
