import { ProductTour } from '../posthog-product-tours-types'
import { document as _document, window as _window } from '../utils/globals'
import { isNull } from '@posthog/core'

const document = _document as Document
const window = _window as Window & typeof globalThis

export function doesTourUrlMatch(tour: ProductTour): boolean {
    const conditions = tour.conditions
    if (!conditions?.url) {
        return true
    }

    const currentUrl = window.location.href
    const targetUrl = conditions.url
    const matchType = conditions.urlMatchType || 'contains'

    switch (matchType) {
        case 'exact':
            return currentUrl === targetUrl
        case 'contains':
            return currentUrl.includes(targetUrl)
        case 'regex':
            try {
                const regex = new RegExp(targetUrl)
                return regex.test(currentUrl)
            } catch {
                return false
            }
        default:
            return false
    }
}

export function doesTourSelectorMatch(tour: ProductTour): boolean {
    const conditions = tour.conditions
    if (!conditions?.selector) {
        return true
    }

    try {
        return !isNull(document.querySelector(conditions.selector))
    } catch {
        return false
    }
}

export function isTourInDateRange(tour: ProductTour): boolean {
    const now = new Date()

    if (tour.start_date) {
        const startDate = new Date(tour.start_date)
        if (now < startDate) {
            return false
        }
    }

    if (tour.end_date) {
        const endDate = new Date(tour.end_date)
        if (now > endDate) {
            return false
        }
    }

    return true
}

export function checkTourConditions(tour: ProductTour): boolean {
    return isTourInDateRange(tour) && doesTourUrlMatch(tour) && doesTourSelectorMatch(tour)
}
