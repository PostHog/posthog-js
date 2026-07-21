import { PostHog } from './posthog-core'
import { ProductTour, ProductTourCallback } from './posthog-product-tours-types'
import { PRODUCT_TOURS, PRODUCT_TOURS_ENABLED_SERVER_SIDE } from './constants'
import { RemoteConfigResult } from './types'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { isArray, isNullish } from '@posthog/core'
import { assignableWindow } from './utils/globals'
import { Extension } from './extensions/types'

const logger = createLogger('[Product Tours]')

interface ProductTourManagerInterface {
    start: () => void
    stop: () => void
    showTourById: (tourId: string) => void
    previewTour: (tour: ProductTour) => void
    dismissTour: (reason: string) => void
    nextStep: () => void
    previousStep: () => void
    getActiveProductTours: (callback: ProductTourCallback) => void
    resetTour: (tourId: string) => void
    resetAllTours: () => void
    cancelPendingTour: (tourId: string) => void
}

const isProductToursEnabled = (instance: PostHog): boolean => {
    if (instance.config.disable_product_tours) {
        return false
    }
    return !!instance.persistence?.get_property(PRODUCT_TOURS_ENABLED_SERVER_SIDE)
}

export class PostHogProductTours implements Extension {
    private _instance: PostHog
    private _productTourManager: ProductTourManagerInterface | null = null
    private _cachedTours: ProductTour[] | null = null

    private get _persistence() {
        return this._instance.persistence
    }

    constructor(instance: PostHog) {
        this._instance = instance
    }

    initialize() {
        this.loadIfEnabled()
    }

    onRemoteConfig(result: RemoteConfigResult): void {
        if (!result.ok) {
            // Failure behaves like a response without a productTours key.
            return
        }

        const response = result.config
        if (!('productTours' in response)) {
            return
        }

        if (this._persistence) {
            this._persistence.register({
                [PRODUCT_TOURS_ENABLED_SERVER_SIDE]: !!response.productTours,
            })
        }
        if (!isProductToursEnabled(this._instance)) {
            if (this._productTourManager || !isNullish(this._persistence?.props[PRODUCT_TOURS])) {
                logger.info('product tours disabled; stopping and clearing cached tours')
            }
            // a manager started from the previously-persisted enabled flag keeps
            // serving tours until told to stop
            this._productTourManager?.stop()
            this._productTourManager = null
            // tours cached while enabled would otherwise ride along in the main
            // persistence blob (and every cross-tab storage broadcast) forever
            this.clearCache()
            return
        }
        this.loadIfEnabled()
    }

    loadIfEnabled(): void {
        if (this._productTourManager || !isProductToursEnabled(this._instance)) {
            return
        }
        this._loadScript(() => this._startProductTours())
    }

    private _loadScript(cb: () => void): void {
        if (assignableWindow.__PosthogExtensions__?.generateProductTours) {
            cb()
            return
        }
        assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this._instance, 'product-tours', (err) => {
            if (err) {
                logger.error('Could not load product tours script', err)
                return
            }
            cb()
        })
    }

    private _startProductTours(): void {
        if (this._productTourManager || !assignableWindow.__PosthogExtensions__?.generateProductTours) {
            return
        }
        this._productTourManager = assignableWindow.__PosthogExtensions__.generateProductTours(this._instance, true)
    }

    getProductTours(callback: ProductTourCallback, forceReload: boolean = false): void {
        if (isArray(this._cachedTours) && !forceReload) {
            callback(this._cachedTours, { isLoaded: true })
            return
        }

        const persistence = this._persistence
        if (persistence) {
            const storedTours = persistence.props[PRODUCT_TOURS]
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
                if (!isProductToursEnabled(this._instance)) {
                    // a disable can land while this request is in flight; honouring
                    // the response would re-create the cache the disable just cleared
                    callback([], { isLoaded: true })
                    return
                }
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
                    persistence.register({ [PRODUCT_TOURS]: tours })
                }

                callback(tours, { isLoaded: true })
            },
        })
    }

    getActiveProductTours(callback: ProductTourCallback): void {
        if (isNullish(this._productTourManager)) {
            callback([], { isLoaded: false, error: 'Product tours not loaded' })
            return
        }
        this._productTourManager.getActiveProductTours(callback)
    }

    showProductTour(tourId: string): void {
        this._productTourManager?.showTourById(tourId)
    }

    // force load product tours extension and render a tour,
    // ignoring all display conditions.
    previewTour(tour: ProductTour): void {
        if (this._productTourManager) {
            this._productTourManager.previewTour(tour)
            return
        }

        this._loadScript(() => {
            this._startProductTours()
            this._productTourManager?.previewTour(tour)
        })
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
        this._persistence?.unregister(PRODUCT_TOURS)
    }

    resetTour(tourId: string): void {
        this._productTourManager?.resetTour(tourId)
    }

    resetAllTours(): void {
        this._productTourManager?.resetAllTours()
    }

    cancelPendingTour(tourId: string): void {
        this._productTourManager?.cancelPendingTour(tourId)
    }
}
