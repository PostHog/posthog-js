import {
    doesCaptureElementHaveSensitiveData,
    isSensitiveElement,
    isSensitiveValue,
} from '../utils/sensitive-data-detection'

describe('sensitive data detection', () => {
    describe(`isSensitiveElement`, () => {
        it(`should not include input elements`, () => {
            expect(isSensitiveElement(document!.createElement(`input`), {})).toBe(true)
        })

        it(`should not include select elements`, () => {
            expect(isSensitiveElement(document!.createElement(`select`), {})).toBe(true)
        })

        it(`should not include textarea elements`, () => {
            expect(isSensitiveElement(document!.createElement(`textarea`), {})).toBe(true)
        })

        it(`should not include elements where contenteditable="true"`, () => {
            const editable = document!.createElement(`div`)
            const noneditable = document!.createElement(`div`)

            editable.setAttribute(`contenteditable`, `true`)
            noneditable.setAttribute(`contenteditable`, `false`)

            expect(isSensitiveElement(editable, {})).toBe(true)
            expect(isSensitiveElement(noneditable, {})).toBe(false)
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
            expect(doesCaptureElementHaveSensitiveData(input, {})).toBe(true)
        })

        it(`should not include password fields`, () => {
            input.type = `password`
            expect(doesCaptureElementHaveSensitiveData(input, {})).toBe(true)
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
                expect(doesCaptureElementHaveSensitiveData(input, {})).toBe(false)

                input.name = name
                expect(doesCaptureElementHaveSensitiveData(input, {})).toBe(true)
            })
        })

        // #TODO@luke-belton: fix this going forwards
        describe('a bug with substring matching', () => {
            it(`matches 'cc' only at the start of the string`, () => {
                input.name = `my_cc`
                expect(doesCaptureElementHaveSensitiveData(input, {})).toBe(false)

                input.name = `cc_number`
                expect(doesCaptureElementHaveSensitiveData(input, {})).toBe(true)
            })

            it(`matches other sensitive substrings wherever they appear`, () => {
                input.name = `expiration_date_cc`
                expect(doesCaptureElementHaveSensitiveData(input, {})).toBe(true)

                // this is the bug!
                input.name = `my_expert_view`
                expect(doesCaptureElementHaveSensitiveData(input, {})).toBe(true)
            })
        })
    })
})
