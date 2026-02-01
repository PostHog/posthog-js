import { querySelectorAllDeep } from 'query-selector-shadow-dom'
import { window as _window } from '../../utils/globals'
import { createLogger, isArray, isUndefined } from '@posthog/core'

const window = _window as Window & typeof globalThis
const logger = createLogger('[Element Inference]')

// this is copied directly from the main repo: /frontend/src/toolbar/utils.ts
// TODO: once this is deployed, we can have the main repo reference this instead
export function elementIsVisible(element: HTMLElement, cache: WeakMap<HTMLElement, boolean>): boolean {
    try {
        const alreadyCached = cache.get(element)
        if (!isUndefined(alreadyCached)) {
            return alreadyCached
        }

        if (element.checkVisibility) {
            const nativeIsVisible = element.checkVisibility({
                checkOpacity: true,
                checkVisibilityCSS: true,
            })
            cache.set(element, nativeIsVisible)
            return nativeIsVisible
        }

        const style = window.getComputedStyle(element)
        const isInvisible = style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0
        if (isInvisible) {
            cache.set(element, false)
            return false
        }

        // Check parent chain for display/visibility
        let parent = element.parentElement
        while (parent) {
            // Check cache first
            const cached = cache.get(parent)
            if (!isUndefined(cached)) {
                if (!cached) {
                    return false
                }
                // If cached as visible, skip to next parent
                parent = parent.parentElement
                continue
            }

            const parentStyle = window.getComputedStyle(parent)
            const parentVisible = parentStyle.display !== 'none' && parentStyle.visibility !== 'hidden'

            cache.set(parent, parentVisible)

            if (!parentVisible) {
                return false
            }
            parent = parent.parentElement
        }

        // Check if element has actual rendered dimensions
        const rect = element.getBoundingClientRect()
        const elementHasActualRenderedDimensions =
            rect.width > 0 ||
            rect.height > 0 ||
            // Some elements might be 0x0 but still visible (e.g., inline elements with content)
            element.getClientRects().length > 0
        cache.set(element, elementHasActualRenderedDimensions)
        return elementHasActualRenderedDimensions
    } catch {
        // if we can't get the computed style, we'll assume the element is visible
        return true
    }
}

export interface SelectorGroup {
    cardinality: number
    cssSelectors: Array<{
        css: string
        offset: number
    }>
}

export interface AutoData {
    notextGroups: SelectorGroup[]
    textGroups: SelectorGroup[]
}

export interface InferredSelector {
    autoData: string
    text: string | null
    excludeText?: boolean
    precision?: number
}

function getElementText(element: HTMLElement): string | null {
    const text = element.innerText?.trim()
    // anything higher than 250 chars -> prob not a good selector / button / target
    if (!text || text.length > 250) {
        return null
    }
    return text
}

function elementMatchesText(element: HTMLElement, text: string): boolean {
    const elementText = getElementText(element)
    return elementText?.toLowerCase() === text.toLowerCase()
}

// generator to query elements, filtering by text and visibility
function* queryElements(
    selector: string,
    text: string | null,
    visibilityCache: WeakMap<HTMLElement, boolean>
): Generator<HTMLElement, void, undefined> {
    let elements: HTMLElement[]

    try {
        elements = querySelectorAllDeep(selector) as unknown as HTMLElement[]
    } catch {
        return
    }

    for (const el of elements) {
        const element = el as HTMLElement
        if (text && !elementMatchesText(element, text)) {
            continue
        }
        if (!elementIsVisible(element, visibilityCache)) {
            continue
        }
        yield element
    }
}

// could be inlined, but wanna keep lazy eval from queryElements
function nth<T>(iterable: Iterable<T>, n: number): T | null {
    let idx = 0
    for (const item of iterable) {
        if (idx === n) {
            return item
        }
        idx++
    }
    return null
}

/**
 * if inferSelector is the sauce, this is the nugget
 *
 * find an element in the dom using the element inference data
 *
 * 1. try each group of selectors, starting with most specific (lowest cardinality)
 * 2. try each selector in the group - run the css query, go to offset
 * 3. "vote" for the element if it was found
 * 4. return early if any element gets majority votes
 * 5. return element w/ most votes
 */
export function findElement(selector: InferredSelector): HTMLElement | null {
    try {
        const autoData = JSON.parse(selector.autoData) as AutoData
        if (!isArray(autoData?.textGroups) || !isArray(autoData?.notextGroups)) {
            logger.error('Invalid autoData structure:', autoData)
            return null
        }
        const { text, excludeText, precision = 1 } = selector

        // excludeText -> user setting, usually if the target element
        // has dynamic/localized text
        const useText = text != null && !excludeText

        // choose appropriate group + sort
        const groups = (useText ? autoData.textGroups : autoData.notextGroups).sort(
            (a, b) => a.cardinality - b.cardinality
        )

        if (groups.length === 0) {
            return null
        }

        // precision controls how many groups to search
        // 1 = strict (only most specific group), 0 = loose (all groups)
        const maxGroups = Math.max(1, Math.ceil((1 - precision) * groups.length))

        const visibilityCache = new WeakMap<HTMLElement, boolean>()

        // try each selector group, starting w/ most specific (lowest cardinality)
        for (let i = 0; i < maxGroups; i++) {
            const group = groups[i]
            const votes = new Map<HTMLElement, number>()
            let winner: HTMLElement | null = null
            let maxVotes = 0

            // test each selector in the group
            for (const { css, offset } of group.cssSelectors) {
                // get matches, jump to offset to find our target
                const element = nth(queryElements(css, useText ? text : null, visibilityCache), offset)

                if (!element) {
                    continue
                }

                // if we found something, this element gets a vote
                const voteCount = (votes.get(element) ?? 0) + 1
                votes.set(element, voteCount)

                if (voteCount > maxVotes) {
                    maxVotes = voteCount
                    winner = element

                    // break early if we have a majority
                    if (voteCount >= Math.ceil(group.cssSelectors.length / 2)) {
                        return winner
                    }
                }
            }

            if (winner) {
                return winner
            }
        }

        return null
    } catch (error) {
        logger.error('Error finding element:', error)
        return null
    }
}

export function getElementPath(el: HTMLElement | null, depth = 4): string | null {
    if (!el) {
        return null
    }
    const parts: string[] = []
    let current: HTMLElement | null = el

    while (current && parts.length < depth && current.tagName !== 'BODY') {
        let part = current.tagName.toLowerCase()
        if (current.id) {
            part += `#${current.id}`
        } else if (current.classList.length) {
            part += `.${current.classList[0]}`
        }
        parts.unshift(part)
        current = current.parentElement
    }

    return parts.join(' > ')
}
