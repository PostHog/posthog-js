import { h } from 'preact'
import { ProductTourAppearance, DEFAULT_PRODUCT_TOUR_APPEARANCE } from '../../../posthog-product-tours-types'

export interface ProductTourOverlayProps {
    appearance?: ProductTourAppearance
}

/**
 * A minimal overlay component used during survey steps to maintain
 * the dimmed background effect while the survey is displayed.
 */
export function ProductTourOverlay({ appearance }: ProductTourOverlayProps): h.JSX.Element {
    const mergedAppearance = { ...DEFAULT_PRODUCT_TOUR_APPEARANCE, ...appearance }

    const containerStyle = {
        '--ph-tour-background-color': mergedAppearance.backgroundColor,
        '--ph-tour-text-color': mergedAppearance.textColor,
        '--ph-tour-button-color': mergedAppearance.buttonColor,
        '--ph-tour-button-text-color': mergedAppearance.buttonTextColor,
        '--ph-tour-border-radius': `${mergedAppearance.borderRadius}px`,
        '--ph-tour-border-color': mergedAppearance.borderColor,
    } as h.JSX.CSSProperties

    return (
        <div class="ph-tour-container" style={containerStyle}>
            {/* Modal overlay provides the dimmed background */}
            <div class="ph-tour-modal-overlay" />
        </div>
    )
}
