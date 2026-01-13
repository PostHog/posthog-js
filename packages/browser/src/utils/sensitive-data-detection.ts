import { isString, trim } from '@posthog/core'
import { isTag } from './element-utils'
import { toExactMatch } from './regex-utils'
import { PostHogConfig } from '../types'

export const DEFAULT_SENSITIVE_DATA_DETECTION_CONFIG = {
    allowedInputTypes: ['button', 'checkbox', 'submit', 'reset'],
    sensitiveNameRegex: new RegExp(
        /^(cc|cardnum|ccnum|creditcard|csc|cvc|cvv|exp|pass|pwd|routing|seccode|securitycode|securitynum|socialsec|socsec|ssn)/i
    ),
}

// Define the core pattern for matching SSNs with optional dashes
// unanchored version for substring matches - use toExactMatch to anchor if needed
export const UNANCHORED_SSN_REGEX = new RegExp(`(\\d{3}-?\\d{2}-?\\d{4})`)

// Define the core pattern for matching credit card numbers
// unanchored version for substring matches - use toExactMatch to anchor if needed
export const UNANCHORED_CC_REGEX = new RegExp(
    `(4[0-9]{12}(?:[0-9]{3})?)|(5[1-5][0-9]{14})|(6(?:011|5[0-9]{2})[0-9]{12})|(3[47][0-9]{13})|(3(?:0[0-5]|[68][0-9])[0-9]{11})|((?:2131|1800|35[0-9]{3})[0-9]{11})`
)

/*
 * Check whether a string value may contain sensitive data using a set of regexes
 * for credit card numbers and social security numbers.
 * @param {string} value - string value to check
 * @param {boolean} anchorRegexes - whether to anchor the regexes to the start and end of the string
 * @returns {boolean} whether the element may contain sensitive data
 */
export function isSensitiveValue(value: string, anchorRegexes = true): boolean {
    if (isString(value)) {
        value = trim(value)

        // check to see if input value looks like a credit card number
        // see: https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9781449327453/ch04s20.html
        const ccRegex = anchorRegexes ? toExactMatch(UNANCHORED_CC_REGEX) : UNANCHORED_CC_REGEX
        if (ccRegex.test((value || '').replace(/[- ]/g, ''))) {
            return true
        }

        // check to see if input value looks like a social security number
        const ssnRegex = anchorRegexes ? toExactMatch(UNANCHORED_SSN_REGEX) : UNANCHORED_SSN_REGEX
        if (ssnRegex.test(value)) {
            return true
        }
    }

    return false
}

/*
 * Check whether a DOM element is 'sensitive' and we should only capture limited data
 * @param {Element} el - element to check
 * @returns {boolean} whether the element should be captured
 */
export function isSensitiveElement(el: Element, config: PostHogConfig): boolean {
    const allowedTypes =
        config?.sensitive_data_detection?.allowedInputTypes || DEFAULT_SENSITIVE_DATA_DETECTION_CONFIG.allowedInputTypes

    // don't send data from inputs or similar elements since there will always be
    // a risk of clientside javascript placing sensitive data in attributes
    if (
        (isTag(el, 'input') && !allowedTypes.includes((el as HTMLInputElement).type)) ||
        isTag(el, 'select') ||
        isTag(el, 'textarea') ||
        el.getAttribute('contenteditable') === 'true'
    ) {
        return true
    }

    if (config.defaults >= '2025-12-11') {
        const name = (el as HTMLInputElement).name || el.id || ''
        // See https://github.com/posthog/posthog-js/issues/165
        // Under specific circumstances a bug caused .replace to be called on a DOM element
        // instead of a string, removing the element from the page. Ensure this issue is mitigated.
        if (isString(name)) {
            // it's possible for el.name or el.id to be a DOM element if el is a form with a child input[name="name"]
            const sensitiveNameRegex =
                config?.sensitive_data_detection?.sensitiveNameRegex ||
                DEFAULT_SENSITIVE_DATA_DETECTION_CONFIG.sensitiveNameRegex
            if (sensitiveNameRegex.test(name.replace(/[^a-zA-Z0-9]/g, ''))) {
                return true
            }
        }
    }

    return false
}

/*
 * Check whether a DOM element may contain sensitive data based on its attributes
 * @param {Element} el - element to check
 * @returns {boolean} whether the element may contain sensitive data
 */
/** @deprecated Use `isSensitiveElement` instead.  We moved all logic for sensitive element identification into isSensitiveElement as of `config.defaults >= '2025-12-11'` */
export function doesCaptureElementHaveSensitiveData(el: Element): boolean {
    // don't include hidden or password fields
    const type = (el as HTMLInputElement).type || ''
    if (isString(type)) {
        // it's possible for el.type to be a DOM element if el is a form with a child input[name="type"]
        switch (type.toLowerCase()) {
            case 'hidden':
                return true
            case 'password':
                return true
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
            return true
        }
    }

    return false
}
