import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { PostHog } from '../posthog-core'
import { PostHogConfig } from '../types'

jest.useFakeTimers()

describe('loaded() with flags', () => {
    let instance: PostHog

    beforeAll(() => {
        jest.unmock('../decide')
    })

    const createPosthog = async (config?: Partial<PostHogConfig>) => {
        const posthog = await createPosthogInstance(uuidv7(), {
            api_host: 'https://app.posthog.com',
            ...config,
            loaded: (ph) => {
                ph.capture = jest.fn()
                ph._send_request = jest.fn(({ callback }) => callback?.({ status: 200, json: {} }))
                ph._start_queue_if_opted_in = jest.fn()

                jest.spyOn(ph.featureFlags, 'setGroupPropertiesForFlags')
                jest.spyOn(ph.featureFlags, 'setReloadingPaused')
                jest.spyOn(ph.featureFlags, 'reloadFeatureFlags')
                jest.spyOn(ph.featureFlags, '_callDecideEndpoint')

                ph.group('org', 'bazinga', { name: 'Shelly' })
                setTimeout(() => {
                    ph.group('org', 'bazinga2', { name: 'Shelly' })
                }, 100)
            },
        })

        return posthog
    }

    beforeEach(async () => {
        instance = await createPosthog()
    })

    describe('toggling flag reloading', () => {
        it('doesnt call flags while initial load is happening', () => {
            expect(instance.featureFlags.setGroupPropertiesForFlags).toHaveBeenCalled() // loaded ph.group() calls setGroupPropertiesForFlags
            expect(instance.featureFlags.reloadFeatureFlags).toHaveBeenCalledTimes(1) // 1 call from load + group debounced
            expect(instance.featureFlags._callDecideEndpoint).toHaveBeenCalledTimes(1)
            expect(instance._send_request).toHaveBeenCalledTimes(1)

            jest.runOnlyPendingTimers()

            expect(instance.featureFlags.reloadFeatureFlags).toHaveBeenCalledTimes(2) // Additional call for groups change
            expect(instance.featureFlags._callDecideEndpoint).toHaveBeenCalledTimes(2)

            expect(instance._send_request).toHaveBeenCalledTimes(2)
        })
    })
})
