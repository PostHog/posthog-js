import {
    ProductTourAppearance,
    ProductTourSelectorError,
    DEFAULT_PRODUCT_TOUR_APPEARANCE,
} from '../../posthog-product-tours-types'
import { prepareStylesheet } from '../utils/stylesheet-loader'
import { document as _document, window as _window } from '../../utils/globals'

import productTourStyles from './product-tour.css'

const document = _document as Document
const window = _window as Window & typeof globalThis

export function getProductTourStylesheet(): HTMLStyleElement | null {
    const stylesheet = prepareStylesheet(
        document,
        typeof productTourStyles === 'string' ? productTourStyles : ''
    )
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

export interface PositionResult {
    top: number
    left: number
    position: TooltipPosition
}

const TOOLTIP_MARGIN = 12
const TOOLTIP_WIDTH = 320
const TOOLTIP_HEIGHT_ESTIMATE = 180

export function calculateTooltipPosition(targetRect: DOMRect): PositionResult {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    const spaceBelow = viewportHeight - targetRect.bottom
    const spaceLeft = targetRect.left
    const spaceRight = viewportWidth - targetRect.right

    let position: TooltipPosition
    let top: number
    let left: number

    if (spaceRight >= TOOLTIP_WIDTH + TOOLTIP_MARGIN) {
        position = 'right'
        top = targetRect.top + targetRect.height / 2 - TOOLTIP_HEIGHT_ESTIMATE / 2
        left = targetRect.right + TOOLTIP_MARGIN
    } else if (spaceLeft >= TOOLTIP_WIDTH + TOOLTIP_MARGIN) {
        position = 'left'
        top = targetRect.top + targetRect.height / 2 - TOOLTIP_HEIGHT_ESTIMATE / 2
        left = targetRect.left - TOOLTIP_WIDTH - TOOLTIP_MARGIN
    } else if (spaceBelow >= TOOLTIP_HEIGHT_ESTIMATE + TOOLTIP_MARGIN) {
        position = 'bottom'
        top = targetRect.bottom + TOOLTIP_MARGIN
        left = targetRect.left + targetRect.width / 2 - TOOLTIP_WIDTH / 2
    } else {
        position = 'top'
        top = targetRect.top - TOOLTIP_HEIGHT_ESTIMATE - TOOLTIP_MARGIN
        left = targetRect.left + targetRect.width / 2 - TOOLTIP_WIDTH / 2
    }

    top = Math.max(TOOLTIP_MARGIN, Math.min(top, viewportHeight - TOOLTIP_HEIGHT_ESTIMATE - TOOLTIP_MARGIN))
    left = Math.max(TOOLTIP_MARGIN, Math.min(left, viewportWidth - TOOLTIP_WIDTH - TOOLTIP_MARGIN))

    return { top, left, position }
}

export function getSpotlightStyle(targetRect: DOMRect, padding: number = 8): Record<string, string> {
    return {
        top: `${targetRect.top - padding}px`,
        left: `${targetRect.left - padding}px`,
        width: `${targetRect.width + padding * 2}px`,
        height: `${targetRect.height + padding * 2}px`,
    }
}

export function mergeAppearance(appearance?: ProductTourAppearance): Required<ProductTourAppearance> {
    return {
        ...DEFAULT_PRODUCT_TOUR_APPEARANCE,
        ...appearance,
    }
}

export function appearanceToCssVars(appearance: Required<ProductTourAppearance>): Record<string, string> {
    return {
        '--ph-tour-background-color': appearance.backgroundColor,
        '--ph-tour-text-color': appearance.textColor,
        '--ph-tour-button-color': appearance.buttonColor,
        '--ph-tour-button-text-color': appearance.buttonTextColor,
        '--ph-tour-border-radius': `${appearance.borderRadius}px`,
        '--ph-tour-border-color': appearance.borderColor,
    }
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

function escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
}
