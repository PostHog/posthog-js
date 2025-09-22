import { AutocaptureConfig, PostHogConfig, Properties } from './types'
import { each, entries } from './utils'

import { isNullish, isString, isUndefined, isArray, isBoolean } from '@posthog/core'
import { logger } from './utils/logger'
import { window } from './utils/globals'
import { isDocumentFragment, isElementNode, isTag, isTextNode } from './utils/element-utils'
import { includes, trim } from '@posthog/core'

export function splitClassString(s: string): string[] {
    return s ? trim(s).split(/\s+/) : []
}

function checkForURLMatches(urlsList: (string | RegExp)[]): boolean {
    const url = window?.location.href
    return !!(url && urlsList && urlsList.some((regex) => url.match(regex)))
}

/*
 * Get the className of an element, accounting for edge cases where element.className is an object
 *
 * Because this is a string it can contain unexpected characters
 * So, this method safely splits the className and returns that array.
 */
export function getClassNames(el: Element): string[] {
    let className = ''
    switch (typeof el.className) {
        case 'string':
            className = el.className
            break
        // TODO: when is this ever used?
        case 'object': // handle cases where className might be SVGAnimatedString or some other type
            className =
                (el.className && 'baseVal' in el.className ? (el.className as any).baseVal : null) ||
                el.getAttribute('class') ||
                ''
            break
        default:
            className = ''
    }

    return splitClassString(className)
}

export function makeSafeText(s: string | null | undefined): string | null {
    if (isNullish(s)) {
        return null
    }

    return (
        trim(s)
            // scrub potentially sensitive values
            .split(/(\s+)/)
            .filter((s) => shouldCaptureValue(s))
            .join('')
            // normalize whitespace
            .replace(/[\r\n]/g, ' ')
            .replace(/[ ]+/g, ' ')
            // truncate
            .substring(0, 255)
    )
}

/*
 * Get the direct text content of an element, protecting against sensitive data collection.
 * Concats textContent of each of the element's text node children; this avoids potential
 * collection of sensitive data that could happen if we used element.textContent and the
 * element had sensitive child elements, since element.textContent includes child content.
 * Scrubs values that look like they could be sensitive (i.e. cc or ssn number).
 * @param {Element} el - element to get the text of
 * @returns {string} the element's direct text content
 */
export function getSafeText(el: Element): string {
    let elText = ''

    if (shouldCaptureElement(el) && !isSensitiveElement(el) && el.childNodes && el.childNodes.length) {
        each(el.childNodes, function (child) {
            if (isTextNode(child) && child.textContent) {
                elText += makeSafeText(child.textContent) ?? ''
            }
        })
    }

    return trim(elText)
}

export function getEventTarget(e: Event): Element | null {
    // https://developer.mozilla.org/en-US/docs/Web/API/Event/target#Compatibility_notes
    if (isUndefined(e.target)) {
        return (e.srcElement as Element) || null
    } else {
        if ((e.target as HTMLElement)?.shadowRoot) {
            return (e.composedPath()[0] as Element) || null
        }
        return (e.target as Element) || null
    }
}

export const autocaptureCompatibleElements = ['a', 'button', 'form', 'input', 'select', 'textarea', 'label']

/*
 if there is no config, then all elements are allowed
 if there is a config, and there is an allow list, then only elements in the allow list are allowed
 assumes that some other code is checking this element's parents
 */
function checkIfElementTreePassesElementAllowList(
    elements: Element[],
    autocaptureConfig: AutocaptureConfig | undefined
): boolean {
    const allowlist = autocaptureConfig?.element_allowlist
    if (isUndefined(allowlist)) {
        // everything is allowed, when there is no allow list
        return true
    }

    // check each element in the tree
    // if any of the elements are in the allow list, then the tree is allowed
    for (const el of elements) {
        if (allowlist.some((elementType) => el.tagName.toLowerCase() === elementType)) {
            return true
        }
    }

    // otherwise there is an allow list and this element tree didn't match it
    return false
}

/*
 if there is no selector list (i.e. it is undefined), then any elements matches
 if there is an empty list, then no elements match
 if there is a selector list, then check it against each element provided
 */
function checkIfElementsMatchCSSSelector(elements: Element[], selectorList: string[] | undefined): boolean {
    if (isUndefined(selectorList)) {
        // everything is allowed, when there is no selector list
        return true
    }

    for (const el of elements) {
        if (selectorList.some((selector) => el.matches(selector))) {
            return true
        }
    }

    return false
}

export function getParentElement(curEl: Element): Element | false {
    const parentNode = curEl.parentNode
    if (!parentNode || !isElementNode(parentNode)) return false
    return parentNode
}

// autocapture check will already filter for ph-no-capture,
// but we include it here to protect against future changes accidentally removing that check
const DEFAULT_RAGE_CLICK_IGNORE_LIST = ['.ph-no-rageclick', '.ph-no-capture']
export function shouldCaptureRageclick(el: Element | null, _config: PostHogConfig['rageclick']) {
    if (!window || cannotCheckForAutocapture(el)) {
        return false
    }

    let selectorIgnoreList: string[] | boolean
    if (isBoolean(_config)) {
        selectorIgnoreList = _config ? DEFAULT_RAGE_CLICK_IGNORE_LIST : false
    } else {
        selectorIgnoreList = _config?.css_selector_ignorelist ?? DEFAULT_RAGE_CLICK_IGNORE_LIST
    }

    if (selectorIgnoreList === false) {
        return false
    }

    const { targetElementList } = getElementAndParentsForElement(el, false)
    // we don't capture if we match the ignore list
    return !checkIfElementsMatchCSSSelector(targetElementList, selectorIgnoreList)
}

const cannotCheckForAutocapture = (el: Element | null) => {
    return !el || isTag(el, 'html') || !isElementNode(el)
}

const getElementAndParentsForElement = (el: Element, captureOnAnyElement: false | true | undefined) => {
    if (!window || cannotCheckForAutocapture(el)) {
        return { parentIsUsefulElement: false, targetElementList: [] }
    }

    let parentIsUsefulElement = false
    const targetElementList: Element[] = [el]
    let curEl: Element = el
    while (curEl.parentNode && !isTag(curEl, 'body')) {
        // If element is a shadow root, we skip it
        if (isDocumentFragment(curEl.parentNode)) {
            targetElementList.push((curEl.parentNode as any).host)
            curEl = (curEl.parentNode as any).host
            continue
        }
        const parentNode = getParentElement(curEl)
        if (!parentNode) break
        if (captureOnAnyElement || autocaptureCompatibleElements.indexOf(parentNode.tagName.toLowerCase()) > -1) {
            parentIsUsefulElement = true
        } else {
            const compStyles = window.getComputedStyle(parentNode)
            if (compStyles && compStyles.getPropertyValue('cursor') === 'pointer') {
                parentIsUsefulElement = true
            }
        }

        targetElementList.push(parentNode)
        curEl = parentNode
    }
    return { parentIsUsefulElement, targetElementList }
}

/*
 * Check whether a DOM event should be "captured" or if it may contain sensitive data
 * using a variety of heuristics.
 * @param {Element} el - element to check
 * @param {Event} event - event to check
 * @param {Object} autocaptureConfig - autocapture config
 * @param {boolean} captureOnAnyElement - whether to capture on any element, clipboard autocapture doesn't restrict to "clickable" elements
 * @param {string[]} allowedEventTypes - event types to capture, normally just 'click', but some autocapture types react to different events, some elements have fixed events (e.g., form has "submit")
 * @returns {boolean} whether the event should be captured
 */
export function shouldCaptureDomEvent(
    el: Element,
    event: Event,
    autocaptureConfig: AutocaptureConfig | undefined = undefined,
    captureOnAnyElement?: boolean,
    allowedEventTypes?: string[]
): boolean {
    if (!window || cannotCheckForAutocapture(el)) {
        return false
    }

    if (autocaptureConfig?.url_allowlist) {
        // if the current URL is not in the allow list, don't capture
        if (!checkForURLMatches(autocaptureConfig.url_allowlist)) {
            return false
        }
    }

    if (autocaptureConfig?.url_ignorelist) {
        // if the current URL is in the ignore list, don't capture
        if (checkForURLMatches(autocaptureConfig.url_ignorelist)) {
            return false
        }
    }

    if (autocaptureConfig?.dom_event_allowlist) {
        const allowlist = autocaptureConfig.dom_event_allowlist
        if (allowlist && !allowlist.some((eventType) => event.type === eventType)) {
            return false
        }
    }

    const { parentIsUsefulElement, targetElementList } = getElementAndParentsForElement(el, captureOnAnyElement)

    if (!checkIfElementTreePassesElementAllowList(targetElementList, autocaptureConfig)) {
        return false
    }

    if (!checkIfElementsMatchCSSSelector(targetElementList, autocaptureConfig?.css_selector_allowlist)) {
        return false
    }

    const compStyles = window.getComputedStyle(el)
    if (compStyles && compStyles.getPropertyValue('cursor') === 'pointer' && event.type === 'click') {
        return true
    }

    const tag = el.tagName.toLowerCase()
    switch (tag) {
        case 'html':
            return false
        case 'form':
            return (allowedEventTypes || ['submit']).indexOf(event.type) >= 0
        case 'input':
        case 'select':
        case 'textarea':
            return (allowedEventTypes || ['change', 'click']).indexOf(event.type) >= 0
        default:
            if (parentIsUsefulElement) return (allowedEventTypes || ['click']).indexOf(event.type) >= 0
            return (
                (allowedEventTypes || ['click']).indexOf(event.type) >= 0 &&
                (autocaptureCompatibleElements.indexOf(tag) > -1 || el.getAttribute('contenteditable') === 'true')
            )
    }
}

/*
 * Check whether a DOM element should be "captured" or if it may contain sensitive data
 * using a variety of heuristics.
 * @param {Element} el - element to check
 * @returns {boolean} whether the element should be captured
 */
export function shouldCaptureElement(el: Element): boolean {
    for (let curEl = el; curEl.parentNode && !isTag(curEl, 'body'); curEl = curEl.parentNode as Element) {
        const classes = getClassNames(curEl)
        if (includes(classes, 'ph-sensitive') || includes(classes, 'ph-no-capture')) {
            return false
        }
    }

    if (includes(getClassNames(el), 'ph-include')) {
        return true
    }

    // don't include hidden or password fields
    const type = (el as HTMLInputElement).type || ''
    if (isString(type)) {
        // it's possible for el.type to be a DOM element if el is a form with a child input[name="type"]
        switch (type.toLowerCase()) {
            case 'hidden':
                return false
            case 'password':
                return false
        }
    }

    // filter out data from fields that look like sensitive fields
    const name = (el as HTMLInputElement).name || el.id || ''
    // See https://github.com/posthog/posthog-js/issues/165
    // Under specific circumstances a bug caused .replace to be called on a DOM element
    // instead of a string, removing the element from the page. Ensure this issue is mitigated.
    if (isString(name)) {
        // it's possible for el.name or el.id to be a DOM element if el is a form with a child input[name="name"]
        const sensitiveNameRegex =
            /^cc|cardnum|ccnum|creditcard|csc|cvc|cvv|exp|pass|pwd|routing|seccode|securitycode|securitynum|socialsec|socsec|ssn/i
        if (sensitiveNameRegex.test(name.replace(/[^a-zA-Z0-9]/g, ''))) {
            return false
        }
    }

    return true
}

/*
 * Check whether a DOM element is 'sensitive' and we should only capture limited data
 * @param {Element} el - element to check
 * @returns {boolean} whether the element should be captured
 */
export function isSensitiveElement(el: Element): boolean {
    // don't send data from inputs or similar elements since there will always be
    // a risk of clientside javascript placing sensitive data in attributes
    const allowedInputTypes = ['button', 'checkbox', 'submit', 'reset']
    if (
        (isTag(el, 'input') && !allowedInputTypes.includes((el as HTMLInputElement).type)) ||
        isTag(el, 'select') ||
        isTag(el, 'textarea') ||
        el.getAttribute('contenteditable') === 'true'
    ) {
        return true
    }
    return false
}

// Define the core pattern for matching credit card numbers
const coreCCPattern = `(4[0-9]{12}(?:[0-9]{3})?)|(5[1-5][0-9]{14})|(6(?:011|5[0-9]{2})[0-9]{12})|(3[47][0-9]{13})|(3(?:0[0-5]|[68][0-9])[0-9]{11})|((?:2131|1800|35[0-9]{3})[0-9]{11})`
// Create the Anchored version of the regex by adding '^' at the start and '$' at the end
const anchoredCCRegex = new RegExp(`^(?:${coreCCPattern})$`)
// The Unanchored version is essentially the core pattern, usable as is for partial matches
const unanchoredCCRegex = new RegExp(coreCCPattern)

// Define the core pattern for matching SSNs with optional dashes
const coreSSNPattern = `\\d{3}-?\\d{2}-?\\d{4}`
// Create the Anchored version of the regex by adding '^' at the start and '$' at the end
const anchoredSSNRegex = new RegExp(`^(${coreSSNPattern})$`)
// The Unanchored version is essentially the core pattern itself, usable for partial matches
const unanchoredSSNRegex = new RegExp(`(${coreSSNPattern})`)

/*
 * Check whether a string value should be "captured" or if it may contain sensitive data
 * using a variety of heuristics.
 * @param {string} value - string value to check
 * @param {boolean} anchorRegexes - whether to anchor the regexes to the start and end of the string
 * @returns {boolean} whether the element should be captured
 */
export function shouldCaptureValue(value: string, anchorRegexes = true): boolean {
    if (isNullish(value)) {
        return false
    }

    if (isString(value)) {
        value = trim(value)

        // check to see if input value looks like a credit card number
        // see: https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9781449327453/ch04s20.html
        const ccRegex = anchorRegexes ? anchoredCCRegex : unanchoredCCRegex
        if (ccRegex.test((value || '').replace(/[- ]/g, ''))) {
            return false
        }

        // check to see if input value looks like a social security number
        const ssnRegex = anchorRegexes ? anchoredSSNRegex : unanchoredSSNRegex
        if (ssnRegex.test(value)) {
            return false
        }
    }

    return true
}

/*
 * Check whether an attribute name is an Angular style attr (either _ngcontent or _nghost)
 * These update on each build and lead to noise in the element chain
 * More details on the attributes here: https://angular.io/guide/view-encapsulation
 * @param {string} attributeName - string value to check
 * @returns {boolean} whether the element is an angular tag
 */
export function isAngularStyleAttr(attributeName: string): boolean {
    if (isString(attributeName)) {
        return attributeName.substring(0, 10) === '_ngcontent' || attributeName.substring(0, 7) === '_nghost'
    }
    return false
}

/*
 * Iterate through children of a target element looking for span tags
 * and return the text content of the span tags, separated by spaces,
 * along with the direct text content of the target element
 * @param {Element} target - element to check
 * @returns {string} text content of the target element and its child span tags
 */
export function getDirectAndNestedSpanText(target: Element): string {
    let text = getSafeText(target)
    text = `${text} ${getNestedSpanText(target)}`.trim()
    return shouldCaptureValue(text) ? text : ''
}

/*
 * Iterate through children of a target element looking for span tags
 * and return the text content of the span tags, separated by spaces
 * @param {Element} target - element to check
 * @returns {string} text content of span tags
 */
export function getNestedSpanText(target: Element): string {
    let text = ''
    if (target && target.childNodes && target.childNodes.length) {
        each(target.childNodes, function (child) {
            if (child && child.tagName?.toLowerCase() === 'span') {
                try {
                    const spanText = getSafeText(child)
                    text = `${text} ${spanText}`.trim()

                    if (child.childNodes && child.childNodes.length) {
                        text = `${text} ${getNestedSpanText(child)}`.trim()
                    }
                } catch (e) {
                    logger.error('[AutoCapture]', e)
                }
            }
        })
    }
    return text
}

/*
Back in the day storing events in Postgres we use Elements for autocapture events.
Now we're using elements_chain. We used to do this parsing/processing during ingestion.
This code is just copied over from ingestion, but we should optimize it
to create elements_chain string directly.
*/
export function getElementsChainString(elements: Properties[]): string {
    return elementsToString(extractElements(elements))
}

// This interface is called 'Element' in plugin-scaffold https://github.com/PostHog/plugin-scaffold/blob/b07d3b879796ecc7e22deb71bf627694ba05386b/src/types.ts#L200
// However 'Element' is a DOM Element when run in the browser, so we have to rename it
interface PHElement {
    text?: string
    tag_name?: string
    href?: string
    attr_id?: string
    attr_class?: string[]
    nth_child?: number
    nth_of_type?: number
    attributes?: Record<string, any>
    event_id?: number
    order?: number
    group_id?: number
}

function escapeQuotes(input: string): string {
    return input.replace(/"|\\"/g, '\\"')
}

function elementsToString(elements: PHElement[]): string {
    const ret = elements.map((element) => {
        let el_string = ''
        if (element.tag_name) {
            el_string += element.tag_name
        }
        if (element.attr_class) {
            element.attr_class.sort()
            for (const single_class of element.attr_class) {
                el_string += `.${single_class.replace(/"/g, '')}`
            }
        }
        const attributes: Record<string, any> = {
            ...(element.text ? { text: element.text } : {}),
            'nth-child': element.nth_child ?? 0,
            'nth-of-type': element.nth_of_type ?? 0,
            ...(element.href ? { href: element.href } : {}),
            ...(element.attr_id ? { attr_id: element.attr_id } : {}),
            ...element.attributes,
        }
        const sortedAttributes: Record<string, any> = {}
        entries(attributes)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(
                ([key, value]) => (sortedAttributes[escapeQuotes(key.toString())] = escapeQuotes(value.toString()))
            )
        el_string += ':'
        el_string += entries(sortedAttributes)
            .map(([key, value]) => `${key}="${value}"`)
            .join('')
        return el_string
    })
    return ret.join(';')
}

function extractElements(elements: Properties[]): PHElement[] {
    return elements.map((el) => {
        const response = {
            text: el['$el_text']?.slice(0, 400),
            tag_name: el['tag_name'],
            href: el['attr__href']?.slice(0, 2048),
            attr_class: extractAttrClass(el),
            attr_id: el['attr__id'],
            nth_child: el['nth_child'],
            nth_of_type: el['nth_of_type'],
            attributes: {} as { [id: string]: any },
        }

        entries(el)
            .filter(([key]) => key.indexOf('attr__') === 0)
            .forEach(([key, value]) => (response.attributes[key] = value))
        return response
    })
}

function extractAttrClass(el: Properties): PHElement['attr_class'] {
    const attr_class = el['attr__class']
    if (!attr_class) {
        return undefined
    } else if (isArray(attr_class)) {
        return attr_class
    } else {
        return splitClassString(attr_class)
    }
}
