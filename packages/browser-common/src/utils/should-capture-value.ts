import { isNullish, isString, trim } from '@posthog/core'

// Define the core pattern for matching credit card numbers
const coreCCPattern = `(4[0-9]{12}(?:[0-9]{3})?)|(5[1-5][0-9]{14})|(6(?:011|5[0-9]{2})[0-9]{12})|(3[47][0-9]{13})|(3(?:0[0-5]|[68][0-9])[0-9]{11})|((?:2131|1800|35[0-9]{3})[0-9]{11})`
// Create the Anchored version of the regex by adding '^' at the start and '$' at the end
const anchoredCCRegex = new RegExp(`^(?:${coreCCPattern})$`)
// Network bodies are free-form strings, so only inspect complete, delimited number-like runs.
const networkCCCandidateRegex = /(^|[^0-9A-Za-z_])([0-9][0-9 -]*[0-9])(?=$|[^0-9A-Za-z_])/g
const networkCCLengths = [16, 15, 14, 13]

// Define the core pattern for matching SSNs with optional dashes
const coreSSNPattern = `\\d{3}-?\\d{2}-?\\d{4}`
// Create the Anchored version of the regex by adding '^' at the start and '$' at the end
const anchoredSSNRegex = new RegExp(`^(${coreSSNPattern})$`)
// Network bodies exclude invalid SSN/ITIN groups and candidates within longer digit runs.
const networkSSNPattern = `(?!000|666)[0-9]{3}-?(?!00)[0-9]{2}-?(?!0000)[0-9]{4}`
const networkSSNCandidateRegex = new RegExp(`(^|[^0-9])(${networkSSNPattern})(?=$|([^0-9]))`, 'g')
const identifierCharacterRegex = /[0-9A-Za-z_]/

function passesLuhnCheck(value: string): boolean {
    let sum = 0
    let shouldDouble = false

    for (let i = value.length - 1; i >= 0; i--) {
        let digit = value.charCodeAt(i) - 48
        if (shouldDouble) {
            digit *= 2
            if (digit > 9) {
                digit -= 9
            }
        }
        sum += digit
        shouldDouble = !shouldDouble
    }

    return sum % 10 === 0
}

function containsCreditCardNumber(value: string): boolean {
    networkCCCandidateRegex.lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = networkCCCandidateRegex.exec(value))) {
        const matchedCandidate = match[2]
        if (!matchedCandidate) {
            continue
        }

        const candidate = matchedCandidate.replace(/[- ]/g, '')

        for (let start = 0; start < candidate.length; start++) {
            for (const length of networkCCLengths) {
                const end = start + length
                if (end <= candidate.length) {
                    const possibleCardNumber = candidate.slice(start, end)
                    if (anchoredCCRegex.test(possibleCardNumber) && passesLuhnCheck(possibleCardNumber)) {
                        return true
                    }
                }
            }
        }
    }

    return false
}

function containsSSN(value: string): boolean {
    networkSSNCandidateRegex.lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = networkSSNCandidateRegex.exec(value))) {
        const characterBefore = match[1]
        const characterAfter = match[3]

        // UUID fragments and similar identifiers have identifier characters on both sides.
        if (
            characterBefore &&
            characterAfter &&
            identifierCharacterRegex.test(characterBefore) &&
            identifierCharacterRegex.test(characterAfter)
        ) {
            continue
        }

        return true
    }

    return false
}

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
        const containsCreditCard = anchorRegexes
            ? anchoredCCRegex.test((value || '').replace(/[- ]/g, ''))
            : containsCreditCardNumber(value)
        if (containsCreditCard) {
            return false
        }

        // check to see if input value looks like a social security number
        const containsSocialSecurityNumber = anchorRegexes ? anchoredSSNRegex.test(value) : containsSSN(value)
        if (containsSocialSecurityNumber) {
            return false
        }
    }

    return true
}
