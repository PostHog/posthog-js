import { getDeviceModel } from '../../utils/device-model-utils'
import { logger } from '../../utils/logger'
import { createPosthogInstance } from '../helpers/posthog-instance'

const setUserAgentData = (value: any): void => {
    Object.defineProperty(navigator, 'userAgentData', {
        configurable: true,
        value,
    })
}

const clearUserAgentData = (): void => {
    delete (navigator as any).userAgentData
}

const flushPromises = (): Promise<void> => new Promise((resolve) => setTimeout(resolve))

describe('device-model-utils', () => {
    afterEach(() => {
        clearUserAgentData()
        jest.restoreAllMocks()
    })

    describe('getDeviceModel', () => {
        it('returns the model on the happy path (Android Chromium)', async () => {
            const getHighEntropyValues = jest.fn().mockResolvedValue({ model: 'Pixel 7' })
            setUserAgentData({ getHighEntropyValues })

            await expect(getDeviceModel()).resolves.toBe('Pixel 7')
            expect(getHighEntropyValues).toHaveBeenCalledWith(['model'])
        })

        it.each([
            [
                'the model is an empty string (desktop Chromium)',
                { getHighEntropyValues: () => Promise.resolve({ model: '' }) },
            ],
            ['userAgentData is unsupported (Safari/Firefox)', undefined],
            ['getHighEntropyValues is missing', { brands: [], platform: 'Android' }],
            [
                'the resolved model is not a string',
                { getHighEntropyValues: () => Promise.resolve({ model: undefined }) },
            ],
        ])('returns undefined when %s', async (_case, userAgentData) => {
            setUserAgentData(userAgentData)

            await expect(getDeviceModel()).resolves.toBeUndefined()
        })

        it('swallows a NotAllowedError rejection and logs a debug message', async () => {
            const error = new Error('blocked by Permissions-Policy')
            error.name = 'NotAllowedError'
            const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {})
            setUserAgentData({ getHighEntropyValues: jest.fn().mockRejectedValue(error) })

            await expect(getDeviceModel()).resolves.toBeUndefined()
            expect(infoSpy).toHaveBeenCalled()
        })

        it('swallows a generic rejection without throwing', async () => {
            setUserAgentData({ getHighEntropyValues: jest.fn().mockRejectedValue(new Error('boom')) })

            await expect(getDeviceModel()).resolves.toBeUndefined()
        })
    })

    describe('init wiring', () => {
        it('registers $device_model under the default config (disable_device_model omitted)', async () => {
            const getHighEntropyValues = jest.fn().mockResolvedValue({ model: 'Pixel 7' })
            setUserAgentData({ getHighEntropyValues })

            const posthog = await createPosthogInstance(undefined, {})
            await flushPromises()

            expect(getHighEntropyValues).toHaveBeenCalledWith(['model'])
            expect(posthog.get_property('$device_model')).toBe('Pixel 7')
        })

        it('does not call the API or register anything when disable_device_model is true', async () => {
            const getHighEntropyValues = jest.fn().mockResolvedValue({ model: 'Pixel 7' })
            setUserAgentData({ getHighEntropyValues })

            const posthog = await createPosthogInstance(undefined, { disable_device_model: true })
            await flushPromises()

            expect(getHighEntropyValues).not.toHaveBeenCalled()
            expect(posthog.get_property('$device_model')).toBeUndefined()
        })

        it('does not register an empty-string model', async () => {
            setUserAgentData({ getHighEntropyValues: jest.fn().mockResolvedValue({ model: '' }) })

            const posthog = await createPosthogInstance(undefined, {})
            await flushPromises()

            expect(posthog.get_property('$device_model')).toBeUndefined()
        })
    })

    describe('reset', () => {
        const initWithModel = async () => {
            setUserAgentData({ getHighEntropyValues: jest.fn().mockResolvedValue({ model: 'Pixel 7' }) })
            const posthog = await createPosthogInstance(undefined, {})
            await flushPromises()
            expect(posthog.get_property('$device_model')).toBe('Pixel 7')
            return posthog
        }

        it('preserves $device_model across reset() (device-stable, like $device_id)', async () => {
            const posthog = await initWithModel()

            posthog.reset()

            expect(posthog.get_property('$device_model')).toBe('Pixel 7')
        })

        it('drops $device_model on reset(true) (full device reset)', async () => {
            const posthog = await initWithModel()

            posthog.reset(true)

            expect(posthog.get_property('$device_model')).toBeUndefined()
        })
    })
})
