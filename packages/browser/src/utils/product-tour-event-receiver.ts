import { PRODUCT_TOURS_ACTIVATED } from '../constants'
import { ProductTour, ProductTourEventName } from '../posthog-product-tours-types'
import { PostHog } from '../posthog-core'
import { EventReceiver } from './event-receiver'
import { createLogger } from './logger'
import { localStore } from '../storage'
import { TOUR_COMPLETED_KEY_PREFIX, TOUR_DISMISSED_KEY_PREFIX } from '../extensions/product-tours/constants'

const logger = createLogger('[Product Tour Event Receiver]')

export class ProductTourEventReceiver extends EventReceiver<ProductTour> {
    constructor(instance: PostHog) {
        super(instance)
    }

    protected _getActivatedKey(): string {
        return PRODUCT_TOURS_ACTIVATED
    }

    protected _getShownEventName(): string {
        return ProductTourEventName.SHOWN
    }

    protected _getItems(callback: (items: ProductTour[]) => void): void {
        this._instance?.productTours?.getProductTours(callback)
    }

    protected _cancelPendingItem(itemId: string): void {
        this._instance?.productTours?.cancelPendingTour(itemId)
    }

    protected _getLogger(): ReturnType<typeof createLogger> {
        return logger
    }

    protected _isItemPermanentlyIneligible(itemId?: string): boolean {
        if (!itemId) return true
        const completedKey = `${TOUR_COMPLETED_KEY_PREFIX}${itemId}`
        const dismissedKey = `${TOUR_DISMISSED_KEY_PREFIX}${itemId}`
        return !!(localStore._get(completedKey) || localStore._get(dismissedKey))
    }

    getTours(): string[] {
        return this.getActivatedIds()
    }
}
