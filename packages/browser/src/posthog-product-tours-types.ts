/**
 * @deprecated Product tours were removed from PostHog. The SDK never returns tours.
 */
export type ProductTour = never

/**
 * @deprecated Product tours were removed from PostHog. The callback always receives an empty list.
 */
export type ProductTourCallback = (tours: ProductTour[], context?: { isLoaded: boolean; error?: string }) => void
