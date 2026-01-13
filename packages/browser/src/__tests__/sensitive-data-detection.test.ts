import { PostHogConfig } from '../types'
import {
    doesCaptureElementHaveSensitiveData,
    isSensitiveElement,
    isSensitiveValue,
} from '../utils/sensitive-data-detection'
import { createMockConfig } from './helpers/posthog-instance'

describe('sensitive data detection', () => {
    let config: PostHogConfig

    beforeEach(() => {
        config = createMockConfig({
            defaults: '2025-12-11',
            sensitive_data_detection: {
                allowedInputTypes: ['button', 'checkbox', 'submit', 'reset'],
            },
        }) // tests also pass when defaults is pre 2025-12-11
    })

    describe(`isSensitiveElement`, () => {
        it(`should not include input elements`, () => {
            expect(isSensitiveElement(document!.createElement(`input`), config)).toBe(true)
        })

        it(`should not include select elements`, () => {
            expect(isSensitiveElement(document!.createElement(`select`), config)).toBe(true)
        })

        it(`should not include textarea elements`, () => {
            expect(isSensitiveElement(document!.createElement(`textarea`), config)).toBe(true)
        })

        it(`should not include elements where contenteditable="true"`, () => {
            const editable = document!.createElement(`div`)
            const noneditable = document!.createElement(`div`)

            editable.setAttribute(`contenteditable`, `true`)
            noneditable.setAttribute(`contenteditable`, `false`)

            expect(isSensitiveElement(editable, config)).toBe(true)
            expect(isSensitiveElement(noneditable, config)).toBe(false)
        })

        describe('behavior as of 2025-12-11 defaults', () => {
            let input: HTMLInputElement

            beforeEach(() => {
                input = document!.createElement(`input`)
            })

            it(`matches 'cc' only at the start of the string`, () => {
                input.name = `my_cc`
                input.type = 'submit' // to avoid being excluded as an input
                expect(isSensitiveElement(input, config)).toBe(false)

                input.name = `cc_number`
                expect(isSensitiveElement(input, config)).toBe(true)
            })

            it(`matches other sensitive substrings only when they appear at the start`, () => {
                input.name = `expiration_date_cc`
                input.type = 'submit' // to avoid being excluded as an input
                expect(isSensitiveElement(input, config)).toBe(true)

                // this is the new behavior
                input.name = `my_expert_view`
                expect(isSensitiveElement(input, config)).toBe(false)
            })

            it(`allows custom sensitiveNameRegex to be provided`, () => {
                const customConfig = createMockConfig({
                    defaults: '2025-12-11',
                    sensitive_data_detection: {
                        sensitiveNameRegex: /^somethingreallysensitive/i,
                    },
                })

                input.type = 'submit'

                input.name = `somethingreallysensitive`
                expect(isSensitiveElement(input, customConfig)).toBe(true)

                // Should not match default patterns (they were replaced)
                input.name = `password`
                expect(isSensitiveElement(input, customConfig)).toBe(false)
            })
        })
    })

    describe(`isSensitiveValue`, () => {
        // one for each type on http://www.getcreditcardnumbers.com/
        const validCCNumbers = [
            `3419-881002-84912`,
            `30148420855976`,
            `5183792099737678`,
            `6011-5100-8788-7057`,
            `180035601937848`,
            `180072512946394`,
            `4556617778508`,
        ]

        it.each(validCCNumbers)(`should not capture exact credit card numbers (anchored): %s`, (ccNumber) => {
            expect(isSensitiveValue(ccNumber, true)).toBe(true)
        })

        it.each(validCCNumbers)(`should not capture embedded credit card numbers (unanchored): %s`, (ccNumber) => {
            expect(isSensitiveValue(`prefix ${ccNumber} suffix`, false)).toBe(true)
        })

        it.each(validCCNumbers)(`should capture embedded credit card numbers (anchored): %s`, (ccNumber) => {
            expect(isSensitiveValue(`prefix ${ccNumber} suffix`, true)).toBe(false)
        })

        it(`should not capture exact SSN (anchored)`, () => {
            expect(isSensitiveValue(`123-45-6789`, true)).toBe(true)
        })

        it(`should not capture embedded SSN (unanchored)`, () => {
            expect(isSensitiveValue(`my ssn is 123-45-6789 thanks`, false)).toBe(true)
        })

        it(`should capture embedded SSN (anchored)`, () => {
            expect(isSensitiveValue(`my ssn is 123-45-6789 thanks`, true)).toBe(false)
        })
    })

    describe(`doesCaptureElementHaveSensitiveData`, () => {
        let input: HTMLInputElement

        beforeEach(() => {
            input = document!.createElement(`input`)
        })

        it(`should not include hidden fields`, () => {
            input.type = `hidden`
            expect(doesCaptureElementHaveSensitiveData(input)).toBe(true)
        })

        it(`should not include password fields`, () => {
            input.type = `password`
            expect(doesCaptureElementHaveSensitiveData(input)).toBe(true)
        })

        it(`should not include fields with sensitive names`, () => {
            const sensitiveNames = [
                `cc_name`,
                `card-num`,
                `ccnum`,
                `credit-card_number`,
                `credit_card[number]`,
                `csc num`,
                `CVC`,
                `Expiration`,
                `password`,
                `pwd`,
                `routing`,
                `routing-number`,
                `security code`,
                `seccode`,
                `security number`,
                `social sec`,
                `SsN`,
            ]
            sensitiveNames.forEach((name) => {
                input.name = ''
                expect(doesCaptureElementHaveSensitiveData(input)).toBe(false)

                input.name = name
                expect(doesCaptureElementHaveSensitiveData(input)).toBe(true)
            })
        })

        describe('Sensitive name matching', () => {
            describe('behavior prior to 2025-12-11 defaults', () => {
                it(`matches 'cc' only at the start of the string`, () => {
                    input.name = `my_cc`
                    expect(doesCaptureElementHaveSensitiveData(input)).toBe(false)

                    input.name = `cc_number`
                    expect(doesCaptureElementHaveSensitiveData(input)).toBe(true)
                })

                it(`matches other sensitive substrings wherever they appear`, () => {
                    input.name = `expiration_date_cc`
                    expect(doesCaptureElementHaveSensitiveData(input)).toBe(true)

                    // this is the bug!
                    input.name = `my_expert_view`
                    expect(doesCaptureElementHaveSensitiveData(input)).toBe(true)
                })
            })
        })
    })
})
