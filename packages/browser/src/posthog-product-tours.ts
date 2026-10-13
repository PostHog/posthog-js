import type { ProductTour, ProductTourCallback } from './posthog-product-tours-types'
import type { RemoteConfigResult } from './types'

const REMOVED_ERROR = 'Product tours were removed from PostHog'

/**
 * @deprecated Product tours were removed from PostHog. Every method is a no-op,
 * kept so that existing calls do not throw.
 */
export class PostHogProductTours {
    /** @deprecated Product tours were removed from PostHog. Calls the callback with an empty list. */
    getProductTours(callback: ProductTourCallback, _forceReload: boolean = false): void {
        callback([], { isLoaded: false, error: REMOVED_ERROR })
    }

    /** @deprecated Product tours were removed from PostHog. Calls the callback with an empty list. */
    getActiveProductTours(callback: ProductTourCallback): void {
        callback([], { isLoaded: false, error: REMOVED_ERROR })
    }

    /** @deprecated Product tours were removed from PostHog. This method does nothing. */
    initialize(): void {}

    /** @deprecated Product tours were removed from PostHog. This method does nothing. */
    onRemoteConfig(_result: RemoteConfigResult): void {}

    /** @deprecated Product tours were removed from PostHog. This method does nothing. */
    loadIfEnabled(): void {}

    /** @deprecated Product tours were removed from PostHog. This method does nothing. */
    showProductTour(_tourId: string): void {}

    /** @deprecated Product tours were removed from PostHog. This method does nothing. */
    previewTour(_tour: ProductTour): void {}

    /** @deprecated Product tours were removed from PostHog. This method does nothing. */
    dismissProductTour(): void {}

    /** @deprecated Product tours were removed from PostHog. This method does nothing. */
    nextStep(): void {}

    /** @deprecated Product tours were removed from PostHog. This method does nothing. */
    previousStep(): void {}

    /** @deprecated Product tours were removed from PostHog. This method does nothing. */
    clearCache(): void {}

    /** @deprecated Product tours were removed from PostHog. This method does nothing. */
    resetTour(_tourId: string): void {}

    /** @deprecated Product tours were removed from PostHog. This method does nothing. */
    resetAllTours(): void {}

    /** @deprecated Product tours were removed from PostHog. This method does nothing. */
    cancelPendingTour(_tourId: string): void {}
}
