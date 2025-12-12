import { PostHog } from '../../posthog-core'
import { document as _document } from '../../utils/globals'
import { ProductTourManager } from './product-tours'

export { ProductTourManager } from './product-tours'
export { findElementBySelector, getElementMetadata, getProductTourStylesheet } from './product-tours-utils'

export function generateProductTours(posthog: PostHog, isEnabled: boolean): ProductTourManager | undefined {
    if (!_document) {
        return
    }

    const manager = new ProductTourManager(posthog)

    if (isEnabled) {
        manager.start()
    }

    return manager
}
