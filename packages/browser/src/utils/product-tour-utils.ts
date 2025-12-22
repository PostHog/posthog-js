import { ProductTour } from '../posthog-product-tours-types'

export function doesTourActivateByEvent(tour: Pick<ProductTour, 'conditions'>): boolean {
    return !!(tour.conditions?.events && tour.conditions.events.values?.length > 0)
}

export function doesTourActivateByAction(tour: Pick<ProductTour, 'conditions'>): boolean {
    return !!(tour.conditions?.actions && tour.conditions.actions.values?.length > 0)
}
