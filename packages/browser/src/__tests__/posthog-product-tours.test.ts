jest.mock('@posthog/browser-common/utils/logger', () => {
    const childLogger: Record<string, jest.Mock> = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        critical: jest.fn(),
    }
    childLogger.createLogger = jest.fn().mockReturnValue(childLogger)
    return {
        createLogger: childLogger.createLogger,
        logger: childLogger,
    }
})

import { PostHog } from '../posthog-core'
import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { PRODUCT_TOURS, PRODUCT_TOURS_ENABLED_SERVER_SIDE } from '../constants'
import { RemoteConfig } from '../types'

const mockLogger = jest.requireMock('@posthog/browser-common/utils/logger').createLogger.mock.results[0].value

describe('PostHogProductTours', () => {
    let instance: PostHog

    beforeEach(async () => {
        jest.clearAllMocks()
        instance = await createPosthogInstance(uuidv7(), {
            api_host: 'https://test.com',
            token: 'testtoken',
        })
    })

    describe('onRemoteConfig', () => {
        it('does not overwrite persistence when called with empty config', () => {
            // Set up existing persisted value
            instance.persistence?.register({
                [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: true,
            })

            // Call with empty config (server returned no setting for this feature)
            instance.productTours.onRemoteConfig({ ok: true, config: {} as RemoteConfig })

            // Should NOT have overwritten the existing value
            expect(instance.persistence?.props[PRODUCT_TOURS_ENABLED_SERVER_SIDE]).toBe(true)
        })

        it('updates persistence when productTours key is present', () => {
            instance.persistence?.register({
                [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: true,
            })

            instance.productTours.onRemoteConfig({
                ok: true,
                config: {
                    productTours: false,
                } as RemoteConfig,
            })

            expect(instance.persistence?.props[PRODUCT_TOURS_ENABLED_SERVER_SIDE]).toBe(false)
        })

        it('sets persistence to true when productTours is truthy', () => {
            instance.persistence?.register({
                [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: false,
            })

            instance.productTours.onRemoteConfig({
                ok: true,
                config: {
                    productTours: true,
                } as RemoteConfig,
            })

            expect(instance.persistence?.props[PRODUCT_TOURS_ENABLED_SERVER_SIDE]).toBe(true)
        })

        it.each([
            {
                label: 'remote config disables product tours',
                config: {},
                response: { productTours: false },
            },
            {
                label: 'the disable_product_tours config opt-out is set',
                config: { disable_product_tours: true },
                response: { productTours: true },
            },
        ])('drops stored tours when $label', async ({ config, response }) => {
            instance = await createPosthogInstance(uuidv7(), {
                api_host: 'https://test.com',
                token: 'testtoken',
                ...config,
            })
            instance.persistence?.register({
                [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: true,
                [PRODUCT_TOURS]: [{ id: 'tour-1', name: 'stale cached tour' }],
            })

            instance.productTours.onRemoteConfig({ ok: true, config: response as RemoteConfig })

            expect(instance.persistence?.props[PRODUCT_TOURS]).toBeUndefined()
        })

        it('keeps stored tours when product tours stays enabled', () => {
            const tours = [{ id: 'tour-1', name: 'cached tour' }]
            instance.persistence?.register({
                [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: true,
                [PRODUCT_TOURS]: tours,
            })

            instance.productTours.onRemoteConfig({ ok: true, config: { productTours: true } as RemoteConfig })

            expect(instance.persistence?.props[PRODUCT_TOURS]).toEqual(tours)
        })

        it('ignores an in-flight tours response that lands after product tours is disabled', () => {
            const requests: { callback: (response: any) => void }[] = []
            instance._send_request = jest.fn((req) => requests.push(req)) as any
            instance.persistence?.register({ [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: true })

            const consumer = jest.fn()
            instance.productTours.getProductTours(consumer, true)
            expect(requests).toHaveLength(1)
            expect(requests[0]).toEqual(expect.objectContaining({ method: 'GET', timestampMode: 'query' }))

            instance.productTours.onRemoteConfig({ ok: true, config: { productTours: false } as RemoteConfig })

            requests[0].callback({ statusCode: 200, json: { product_tours: [{ id: 'tour-1' }] } })

            expect(instance.persistence?.props[PRODUCT_TOURS]).toBeUndefined()
            expect(consumer).toHaveBeenCalledWith([], { isLoaded: true })
        })

        it('does not re-log status-zero failures already handled by the request layer', () => {
            instance.persistence?.register({ [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: true })
            instance._send_request = jest.fn(({ callback }) =>
                callback({ statusCode: 0, error: new TypeError('Failed to fetch') })
            ) as any

            const consumer = jest.fn()
            jest.clearAllMocks()
            instance.productTours.getProductTours(consumer, true)

            expect(consumer).toHaveBeenCalledWith([], {
                isLoaded: false,
                error: 'Product Tours API could not be loaded, status: 0',
            })
            expect(mockLogger.warn).not.toHaveBeenCalled()
            expect(mockLogger.error).not.toHaveBeenCalled()
        })

        it('warns once for a bare status-zero response', () => {
            instance.persistence?.register({ [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: true })
            instance._send_request = jest.fn(({ callback }) => callback({ statusCode: 0 })) as any

            jest.clearAllMocks()
            instance.productTours.getProductTours(jest.fn(), true)

            expect(mockLogger.warn).toHaveBeenCalledWith('Product Tours API could not be loaded, status: 0')
            expect(mockLogger.error).not.toHaveBeenCalled()
        })

        it('keeps HTTP failures at error severity', () => {
            instance.persistence?.register({ [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: true })
            instance._send_request = jest.fn(({ callback }) => callback({ statusCode: 500 })) as any

            jest.clearAllMocks()
            instance.productTours.getProductTours(jest.fn(), true)

            expect(mockLogger.error).toHaveBeenCalledWith('Product Tours API could not be loaded, status: 500')
        })

        it('stops a running tour manager when product tours is disabled mid-session', () => {
            const stop = jest.fn()
            ;(instance.productTours as any)._productTourManager = { stop }
            instance.persistence?.register({ [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: true })

            instance.productTours.onRemoteConfig({ ok: true, config: { productTours: false } as RemoteConfig })

            expect(stop).toHaveBeenCalled()
            expect((instance.productTours as any)._productTourManager).toBeNull()
        })

        it('does not drop stored tours when the response carries no productTours key', () => {
            const tours = [{ id: 'tour-1', name: 'cached tour' }]
            instance.persistence?.register({
                [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: true,
                [PRODUCT_TOURS]: tours,
            })

            instance.productTours.onRemoteConfig({ ok: true, config: {} as RemoteConfig })

            expect(instance.persistence?.props[PRODUCT_TOURS]).toEqual(tours)
        })
    })
})
