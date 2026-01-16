import {
    ProductTourAppearance,
    ProductTourSelectorError,
    DEFAULT_PRODUCT_TOUR_APPEARANCE,
} from '../../posthog-product-tours-types'
import { prepareStylesheet } from '../utils/stylesheet-loader'
import { document as _document, window as _window } from '../../utils/globals'
import { getFontFamily, getContrastingTextColor, hexToRgba } from '../surveys/surveys-extension-utils'

import productTourStyles from './product-tour.css'

const document = _document as Document
const window = _window as Window & typeof globalThis

export function getProductTourStylesheet(): HTMLStyleElement | null {
    const stylesheet = prepareStylesheet(document, typeof productTourStyles === 'string' ? productTourStyles : '')
    stylesheet?.setAttribute('data-ph-product-tour-style', 'true')
    return stylesheet
}

export interface ElementFindResult {
    element: HTMLElement | null
    error: ProductTourSelectorError | null
    matchCount: number
}

export function findElementBySelector(selector: string): ElementFindResult {
    try {
        const elements = document.querySelectorAll(selector)

        if (elements.length === 0) {
            return { element: null, error: 'not_found', matchCount: 0 }
        }

        const element = elements[0] as HTMLElement

        if (!isElementVisible(element)) {
            return { element: null, error: 'not_visible', matchCount: elements.length }
        }

        if (elements.length > 1) {
            return { element, error: 'multiple_matches', matchCount: elements.length }
        }

        return { element, error: null, matchCount: 1 }
    } catch {
        return { element: null, error: 'not_found', matchCount: 0 }
    }
}

export function isElementVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element)

    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false
    }

    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
        return false
    }

    return true
}

export function getElementMetadata(element: HTMLElement): {
    tag: string
    id: string | undefined
    classes: string | undefined
    text: string | undefined
} {
    return {
        tag: element.tagName,
        id: element.id || undefined,
        classes: element.className || undefined,
        text: element.innerText?.slice(0, 100) || undefined,
    }
}

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right'

export interface TooltipDimensions {
    width: number
    height: number
}

export interface PositionResult {
    top: number
    left: number
    position: TooltipPosition
    /** Arrow offset from center in pixels (positive = right/down, negative = left/up) */
    arrowOffset: number
}

const TOOLTIP_MARGIN = 12
const TOOLTIP_WIDTH = 320
const TOOLTIP_HEIGHT_ESTIMATE = 180
const VIEWPORT_PADDING = 8

export function calculateTooltipPosition(
    targetRect: DOMRect,
    tooltipDimensions?: TooltipDimensions
): PositionResult {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    const tooltipWidth = tooltipDimensions?.width || TOOLTIP_WIDTH
    const tooltipHeight = tooltipDimensions?.height || TOOLTIP_HEIGHT_ESTIMATE

    const spaceBelow = viewportHeight - targetRect.bottom
    const spaceLeft = targetRect.left
    const spaceRight = viewportWidth - targetRect.right

    let position: TooltipPosition
    let top: number
    let left: number
    let arrowOffset = 0

    // Calculate target center for arrow positioning
    const targetCenterX = targetRect.left + targetRect.width / 2
    const targetCenterY = targetRect.top + targetRect.height / 2

    if (spaceRight >= tooltipWidth + TOOLTIP_MARGIN) {
        position = 'right'
        top = targetCenterY - tooltipHeight / 2
        left = targetRect.right + TOOLTIP_MARGIN

        // Clamp vertical position
        const minTop = VIEWPORT_PADDING
        const maxTop = viewportHeight - tooltipHeight - VIEWPORT_PADDING
        const clampedTop = Math.max(minTop, Math.min(maxTop, top))
        arrowOffset = targetCenterY - (clampedTop + tooltipHeight / 2)
        top = clampedTop
    } else if (spaceLeft >= tooltipWidth + TOOLTIP_MARGIN) {
        position = 'left'
        top = targetCenterY - tooltipHeight / 2
        left = targetRect.left - tooltipWidth - TOOLTIP_MARGIN

        // Clamp vertical position
        const minTop = VIEWPORT_PADDING
        const maxTop = viewportHeight - tooltipHeight - VIEWPORT_PADDING
        const clampedTop = Math.max(minTop, Math.min(maxTop, top))
        arrowOffset = targetCenterY - (clampedTop + tooltipHeight / 2)
        top = clampedTop
    } else if (spaceBelow >= tooltipHeight + TOOLTIP_MARGIN) {
        position = 'bottom'
        top = targetRect.bottom + TOOLTIP_MARGIN
        left = targetCenterX - tooltipWidth / 2

        // Clamp horizontal position
        const minLeft = VIEWPORT_PADDING
        const maxLeft = viewportWidth - tooltipWidth - VIEWPORT_PADDING
        const clampedLeft = Math.max(minLeft, Math.min(maxLeft, left))
        arrowOffset = targetCenterX - (clampedLeft + tooltipWidth / 2)
        left = clampedLeft
    } else {
        position = 'top'
        top = targetRect.top - tooltipHeight - TOOLTIP_MARGIN
        left = targetCenterX - tooltipWidth / 2

        // Clamp horizontal position
        const minLeft = VIEWPORT_PADDING
        const maxLeft = viewportWidth - tooltipWidth - VIEWPORT_PADDING
        const clampedLeft = Math.max(minLeft, Math.min(maxLeft, left))
        arrowOffset = targetCenterX - (clampedLeft + tooltipWidth / 2)
        left = clampedLeft
    }

    return { top, left, position, arrowOffset }
}

export function getSpotlightStyle(targetRect: DOMRect, padding: number = 8): Record<string, string> {
    return {
        top: `${targetRect.top - padding}px`,
        left: `${targetRect.left - padding}px`,
        width: `${targetRect.width + padding * 2}px`,
        height: `${targetRect.height + padding * 2}px`,
    }
}

export function addProductTourCSSVariablesToElement(element: HTMLElement, appearance?: ProductTourAppearance): void {
    const merged = { ...DEFAULT_PRODUCT_TOUR_APPEARANCE, ...appearance }
    const style = element.style

    // User-customizable variables
    style.setProperty('--ph-tour-background-color', merged.backgroundColor)
    style.setProperty('--ph-tour-text-color', merged.textColor)
    style.setProperty('--ph-tour-button-color', merged.buttonColor)
    style.setProperty('--ph-tour-border-radius', `${merged.borderRadius}px`)
    style.setProperty('--ph-tour-button-border-radius', `${merged.buttonBorderRadius}px`)
    style.setProperty('--ph-tour-border-color', merged.borderColor)
    style.setProperty('--ph-tour-font-family', getFontFamily(merged.fontFamily))

    // Derived colors
    style.setProperty('--ph-tour-text-secondary-color', hexToRgba(merged.textColor, 0.6))
    style.setProperty('--ph-tour-branding-text-color', getContrastingTextColor(merged.backgroundColor))
    style.setProperty('--ph-tour-button-text-color', getContrastingTextColor(merged.buttonColor))
    style.setProperty('--ph-tour-box-shadow', merged.boxShadow)
    style.setProperty('--ph-tour-overlay-color', merged.showOverlay ? 'rgba(0, 0, 0, 0.5)' : 'transparent')

    // Internal styling variables (not customizable)
    style.setProperty('--ph-tour-button-secondary-color', 'transparent')
    style.setProperty('--ph-tour-button-secondary-text-color', merged.textColor)
    style.setProperty('--ph-tour-max-width', '320px')
    style.setProperty('--ph-tour-padding', '16px')
}

export function renderTipTapContent(content: any): string {
    if (!content) {
        return ''
    }

    if (typeof content === 'string') {
        return escapeHtml(content)
    }

    if (content.type === 'text') {
        let text = escapeHtml(content.text || '')

        if (content.marks) {
            for (const mark of content.marks) {
                switch (mark.type) {
                    case 'bold':
                        text = `<strong>${text}</strong>`
                        break
                    case 'italic':
                        text = `<em>${text}</em>`
                        break
                    case 'underline':
                        text = `<u>${text}</u>`
                        break
                    case 'strike':
                        text = `<s>${text}</s>`
                        break
                }
            }
        }

        return text
    }

    const children = content.content?.map(renderTipTapContent).join('') || ''

    switch (content.type) {
        case 'doc':
            return children
        case 'paragraph':
            return `<p>${children}</p>`
        case 'heading': {
            const level = content.attrs?.level || 1
            return `<h${level}>${children}</h${level}>`
        }
        case 'bulletList':
            return `<ul>${children}</ul>`
        case 'orderedList':
            return `<ol>${children}</ol>`
        case 'listItem':
            return `<li>${children}</li>`
        case 'hardBreak':
            return '<br>'
        default:
            return children
    }
}

export function normalizeUrl(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url
}

function escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
}
