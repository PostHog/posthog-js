import { PostHog } from './posthog-core'
import { ProductTour, ProductTourCallback } from './posthog-product-tours-types'
import { RemoteConfig } from './types'
import { createLogger } from './utils/logger'
import { isNullish, isUndefined, isArray } from '@posthog/core'
import { assignableWindow } from './utils/globals'

const logger = createLogger('[Product Tours]')

const PRODUCT_TOURS_STORAGE_KEY = 'ph_product_tours'
const PRODUCT_TOURS_FEATURE_FLAG = 'product-tours-2025'

interface ProductTourManagerInterface {
    start: () => void
    stop: () => void
    showTourById: (tourId: string) => void
    dismissTour: (reason: string) => void
    nextStep: () => void
    previousStep: () => void
    getActiveProductTours: (callback: ProductTourCallback) => void
    resetTour: (tourId: string) => void
    resetAllTours: () => void
}

export class PostHogProductTours {
    private _instance: PostHog
    private _cachedTours: ProductTour[] | null = null
    private _productTourManager: ProductTourManagerInterface | null = null
    private _isProductToursEnabled?: boolean = undefined
    private _isInitializing: boolean = false

    constructor(instance: PostHog) {
        this._instance = instance
    }

    onRemoteConfig(response: RemoteConfig): void {
        if (this._instance.config.disable_product_tours) {
            logger.info('Product tours disabled via config')
            return
        }

        const productTours = response['productTours']
        if (isNullish(productTours)) {
            logger.info('Product tours not enabled in remote config')
            return
        }

        this._isProductToursEnabled = productTours
        logger.info(`Remote config received, isProductToursEnabled: ${this._isProductToursEnabled}`)
        this.loadIfEnabled()
    }

    loadIfEnabled(): void {
        if (this._productTourManager) {
            return
        }
        if (this._isInitializing) {
            logger.info('Already initializing product tours, skipping...')
            return
        }
        if (this._instance.config.disable_product_tours) {
            logger.info('Product tours disabled via config')
            return
        }

        const phExtensions = assignableWindow?.__PosthogExtensions__
        if (!phExtensions) {
            logger.error('PostHog Extensions not found.')
            return
        }

        const featureFlagEnabled = this._instance.featureFlags?.isFeatureEnabled(PRODUCT_TOURS_FEATURE_FLAG)

        if (isUndefined(this._isProductToursEnabled) && !featureFlagEnabled) {
            logger.info('Waiting for remote config or feature flag to enable product tours')
            return
        }

        const isEnabled = this._isProductToursEnabled || featureFlagEnabled
        if (!isEnabled) {
            logger.info('Product tours not enabled')
            return
        }

        this._isInitializing = true

        try {
            const generateProductTours = phExtensions.generateProductTours
            if (generateProductTours) {
                this._completeInitialization(generateProductTours, isEnabled)
                return
            }

            const loadExternalDependency = phExtensions.loadExternalDependency
            if (!loadExternalDependency) {
                logger.error('PostHog loadExternalDependency extension not found.')
                this._isInitializing = false
                return
            }

            loadExternalDependency(this._instance, 'product-tours', (err) => {
                if (err || !phExtensions.generateProductTours) {
                    logger.error('Could not load product tours script', err)
                } else {
                    this._completeInitialization(phExtensions.generateProductTours, isEnabled)
                }
                this._isInitializing = false
            })
        } catch (e) {
            logger.error('Error initializing product tours', e)
            this._isInitializing = false
        }
    }

    private _completeInitialization(
        generateProductToursFn: (instance: PostHog, isEnabled: boolean) => ProductTourManagerInterface | undefined,
        isEnabled: boolean
    ): void {
        this._productTourManager = generateProductToursFn(this._instance, isEnabled) || null
        logger.info('Product tours loaded successfully')
    }

    getProductTours(callback: ProductTourCallback, forceReload: boolean = false): void {
        if (isArray(this._cachedTours) && !forceReload) {
            callback(this._cachedTours, { isLoaded: true })
            return
        }

        const persistence = this._instance.persistence
        if (persistence) {
            const storedTours = persistence.props[PRODUCT_TOURS_STORAGE_KEY]
            if (isArray(storedTours) && !forceReload) {
                this._cachedTours = storedTours
                callback(storedTours, { isLoaded: true })
                return
            }
        }

        this._instance._send_request({
            url: this._instance.requestRouter.endpointFor(
                'api',
                `/api/product_tours/?token=${this._instance.config.token}`
            ),
            method: 'GET',
            callback: (response) => {
                const statusCode = response.statusCode
                if (statusCode !== 200 || !response.json) {
                    const error = `Product Tours API could not be loaded, status: ${statusCode}`
                    logger.error(error)
                    callback([], { isLoaded: false, error })
                    return
                }

                const tours: ProductTour[] = isArray(response.json.product_tours) ? response.json.product_tours : []

                this._cachedTours = tours

                if (persistence) {
                    persistence.register({ [PRODUCT_TOURS_STORAGE_KEY]: tours })
                }

                callback(tours, { isLoaded: true })
            },
        })
    }

    getActiveProductTours(callback: ProductTourCallback): void {
        if (isNullish(this._productTourManager)) {
            logger.warn('Product tours not loaded yet')
            callback([], { isLoaded: false, error: 'Product tours not loaded' })
            return
        }
        this._productTourManager.getActiveProductTours(callback)
    }

    showProductTour(tourId: string): void {
        logger.info(`showProductTour(${tourId})`)
        this._productTourManager?.showTourById(tourId)
    }

    dismissProductTour(): void {
        this._productTourManager?.dismissTour('user_clicked_skip')
    }

    nextStep(): void {
        this._productTourManager?.nextStep()
    }

    previousStep(): void {
        this._productTourManager?.previousStep()
    }

    clearCache(): void {
        this._cachedTours = null

        const persistence = this._instance.persistence
        if (persistence) {
            persistence.unregister(PRODUCT_TOURS_STORAGE_KEY)
        }
    }

    resetTour(tourId: string): void {
        this._productTourManager?.resetTour(tourId)
    }

    resetAllTours(): void {
        this._productTourManager?.resetAllTours()
    }
}
