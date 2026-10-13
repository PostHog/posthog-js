import type { JSX } from 'preact'
import type { PostHog } from '../../posthog-core'
import type { ProductTourAppearance, ProductTourStep } from '../../posthog-product-tours-types'
import type { InferredSelector } from '../../element-inference-types'

/** @deprecated Product tours were removed from PostHog. */
export interface RenderProductTourPreviewOptions {
    step: ProductTourStep
    appearance?: ProductTourAppearance
    parentElement: HTMLElement
    stepIndex?: number
    totalSteps?: number
    style?: JSX.CSSProperties
    posthog?: PostHog
}

/** @deprecated Product tours were removed from PostHog. Always returns `undefined`. */
export function generateProductTours(_posthog: PostHog, _isEnabled: boolean): undefined {
    return undefined
}

/** @deprecated Product tours were removed from PostHog. Renders nothing. */
export function renderProductTourPreview(_options: RenderProductTourPreviewOptions): void {}

/** @deprecated Product tours were removed from PostHog. Always returns `null`. */
export function findElement(_selector: InferredSelector): HTMLElement | null {
    return null
}

/** @deprecated Product tours were removed from PostHog. Always returns `null`. */
export function getElementPath(_el: HTMLElement | null, _depth?: number): string | null {
    return null
}

/** @deprecated Product tours were removed from PostHog. Always returns `false`. */
export function elementIsVisible(_element: HTMLElement, _cache: WeakMap<HTMLElement, boolean>): boolean {
    return false
}
