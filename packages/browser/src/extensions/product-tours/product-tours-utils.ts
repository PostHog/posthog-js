import DOMPurify from 'dompurify'

import {
    ProductTourAppearance,
    ProductTourSelectorError,
    ProductTourStep,
    DEFAULT_PRODUCT_TOUR_APPEARANCE,
} from '../../posthog-product-tours-types'
import { findElement } from './element-inference'
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

export function hasElementTarget(step: ProductTourStep): boolean {
    if (step.useManualSelector) {
        return !!step.selector
    }
    return !!step.inferenceData
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

/**
 * Find element for a step based on its lookup mode.
 * Default: use inference. If useManualSelector is true: use CSS selector.
 */
export function findStepElement(step: ProductTourStep): ElementFindResult {
    const useManualSelector = step.useManualSelector ?? false

    if (useManualSelector) {
        if (!step.selector) {
            return { element: null, error: 'not_found', matchCount: 0 }
        }
        return findElementBySelector(step.selector)
    }

    if (!step.inferenceData) {
        return { element: null, error: 'not_found', matchCount: 0 }
    }

    const element = findElement(step.inferenceData)
    return element ? { element, error: null, matchCount: 1 } : { element: null, error: 'not_found', matchCount: 0 }
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
    position: TooltipPosition
    top?: number
    bottom?: number
    left?: number
    right?: number
    arrowOffset: number // pixels from center (positive = right/down)
}

const TOOLTIP_MARGIN = 12
const VIEWPORT_PADDING = 8

function clampToViewport(
    value: number,
    dimension: number,
    viewportDimension: number
): { clamped: number; offset: number } {
    const min = VIEWPORT_PADDING + dimension / 2
    const max = viewportDimension - VIEWPORT_PADDING - dimension / 2
    const clamped = Math.max(min, Math.min(max, value))
    return { clamped, offset: value - clamped }
}

export interface TooltipDimensions {
    width: number
    height: number
}

export function calculateTooltipPosition(targetRect: DOMRect, tooltipDimensions: TooltipDimensions): PositionResult {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    const { width, height } = tooltipDimensions
    const spaceAbove = targetRect.top
    const spaceBelow = viewportHeight - targetRect.bottom
    const spaceLeft = targetRect.left
    const spaceRight = viewportWidth - targetRect.right

    const targetCenterY = targetRect.top + targetRect.height / 2
    const targetCenterX = targetRect.left + targetRect.width / 2

    if (spaceRight >= width + TOOLTIP_MARGIN) {
        // right of element
        const left = targetRect.right + TOOLTIP_MARGIN
        const { clamped: top, offset: arrowOffset } = clampToViewport(targetCenterY, height, viewportHeight)
        return { position: 'right', top, left, arrowOffset }
    }
    if (spaceLeft >= width + TOOLTIP_MARGIN) {
        // left of element
        const right = viewportWidth - targetRect.left + TOOLTIP_MARGIN
        const { clamped: top, offset: arrowOffset } = clampToViewport(targetCenterY, height, viewportHeight)
        return { position: 'left', top, right, arrowOffset }
    }
    if (spaceAbove >= height + TOOLTIP_MARGIN && spaceBelow < height + TOOLTIP_MARGIN) {
        // above element
        const bottom = viewportHeight - targetRect.top + TOOLTIP_MARGIN
        const { clamped: left, offset: arrowOffset } = clampToViewport(targetCenterX, width, viewportWidth)
        return { position: 'top', bottom, left, arrowOffset }
    }

    // default: below element
    const top = targetRect.bottom + TOOLTIP_MARGIN
    const { clamped: left, offset: arrowOffset } = clampToViewport(targetCenterX, width, viewportWidth)
    return { position: 'bottom', top, left, arrowOffset }
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
    style.setProperty('--ph-tour-z-index', String(merged.zIndex))

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

export function getStepHtml(step: ProductTourStep): string {
    if (step.contentHtml) {
        return DOMPurify.sanitize(step.contentHtml, {
            ADD_TAGS: ['iframe'],
            ADD_ATTR: ['allowfullscreen', 'frameborder', 'referrerpolicy'],
        })
    }

    // backwards compat, will be deprecated
    return renderTipTapContent(step.content)
}
