import { ProductTourEventName, type ProductTour } from '../types'
import type { PostHogLike as PostHog } from '../types'
import { getBrowserCommonRuntime } from './runtime'
import { EventReceiver, type ActivationOutcome } from './event-receiver'
import { createLogger } from './logger'

const PRODUCT_TOURS_ACTIVATED = '$product_tours_activated'
const TOUR_COMPLETED_KEY_PREFIX = 'ph_tour_completed_'
const TOUR_DISMISSED_KEY_PREFIX = 'ph_tour_dismissed_'

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
        this._instance?.productTours?.getProductTours?.(callback)
    }

    protected _cancelPendingItem(itemId: string): void {
        this._instance?.productTours?.cancelPendingTour?.(itemId)
    }

    protected _getLogger(): ReturnType<typeof createLogger> {
        return logger
    }

    protected _setActivatedItems(eligibleItems: string[]): void {
        this._instance?.persistence?.register({ [PRODUCT_TOURS_ACTIVATED]: eligibleItems })
    }

    protected _isItemPermanentlyIneligible(itemId?: string): boolean {
        if (!itemId) return true
        const completedKey = `${TOUR_COMPLETED_KEY_PREFIX}${itemId}`
        const dismissedKey = `${TOUR_DISMISSED_KEY_PREFIX}${itemId}`
        const localStore = getBrowserCommonRuntime().localStore
        return !!(localStore?._get(completedKey) || localStore?._get(dismissedKey))
    }

    protected _activationOutcome(event: string): ActivationOutcome {
        // Tours show once per trigger: consumed when shown, never persisted across a reload.
        return event === this._getShownEventName() ? 'consume' : 'ignore'
    }

    getTours(): string[] {
        return this.getActivatedIds()
    }
}
