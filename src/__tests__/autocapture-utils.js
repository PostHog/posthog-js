import sinon from 'sinon'

import { getSafeText, shouldCaptureDomEvent, shouldCaptureElement, shouldCaptureValue } from '../autocapture-utils'

describe(`Autocapture utility functions`, () => {
    describe(`getSafeText`, () => {
        it(`should collect and normalize text from elements`, () => {
            const el = document.createElement(`div`)

            el.innerHTML = `  Why  hello  there  `
            expect(getSafeText(el)).toBe(`Why hello there`)

            el.innerHTML = `
          Why
          hello
          there
      `
            expect(getSafeText(el)).toBe(`Why hello there`)

            el.innerHTML = `
          Why
          <p>not</p>
          hello
          <p>not</p>
          there
      `
            expect(getSafeText(el)).toBe(`Whyhellothere`)
        })

        it(`shouldn't collect text from element children`, () => {
            const el = document.createElement(`div`)
            let safeText

            el.innerHTML = `<div>sensitive</div>`
            safeText = getSafeText(el)
            expect(safeText).toEqual(expect.not.arrayContaining([`sensitive`]))
            expect(safeText).toBe(``)

            el.innerHTML = `
          Why
          <p>sensitive</p>
          hello
          <p>sensitive</p>
          there
      `
            safeText = getSafeText(el)
            expect(safeText).toEqual(expect.not.arrayContaining([`sensitive`]))
            expect(safeText).toBe(`Whyhellothere`)
        })

        it(`shouldn't collect text from potentially sensitive elements`, () => {
            let el

            el = document.createElement(`input`)
            el.innerHTML = `Why hello there`
            expect(getSafeText(el)).toBe(``)

            el = document.createElement(`textarea`)
            el.innerHTML = `Why hello there`
            expect(getSafeText(el)).toBe(``)

            el = document.createElement(`select`)
            el.innerHTML = `Why hello there`
            expect(getSafeText(el)).toBe(``)

            el = document.createElement(`div`)
            el.setAttribute(`contenteditable`, `true`)
            el.innerHTML = `Why hello there`
            expect(getSafeText(el)).toBe(``)
        })

        it(`shouldn't collect sensitive values`, () => {
            const el = document.createElement(`div`)

            el.innerHTML = `Why 123-58-1321 hello there`
            expect(getSafeText(el)).toBe(`Why hello there`)

            el.innerHTML = `
        4111111111111111
        Why hello there
      `
            expect(getSafeText(el)).toBe(`Why hello there`)

            el.innerHTML = `
        Why hello there
        5105-1051-0510-5100
      `
            expect(getSafeText(el)).toBe(`Why hello there`)
        })
    })

    describe(`shouldCaptureDomEvent`, () => {
        it(`should capture "submit" events on <form> elements`, () => {
            expect(
                shouldCaptureDomEvent(document.createElement(`form`), {
                    type: `submit`,
                })
            ).toBe(true)
        })
        ;[`input`, `SELECT`, `textarea`].forEach((tagName) => {
            it(`should capture "change" events on <` + tagName.toLowerCase() + `> elements`, () => {
                expect(
                    shouldCaptureDomEvent(document.createElement(tagName), {
                        type: `change`,
                    })
                ).toBe(true)
            })
        })

        // [`div`, `sPan`, `A`, `strong`, `table`]
        ;['a'].forEach((tagName) => {
            it(`should capture "click" events on <` + tagName.toLowerCase() + `> elements`, () => {
                expect(
                    shouldCaptureDomEvent(document.createElement(tagName), {
                        type: `click`,
                    })
                ).toBe(true)
            })
        })

        it(`should capture "click" events on <button> elements`, () => {
            const button1 = document.createElement(`button`)
            const button2 = document.createElement(`input`)
            button2.setAttribute(`type`, `button`)
            const button3 = document.createElement(`input`)
            button3.setAttribute(`type`, `submit`)
            ;[button1, button2, button3].forEach((button) => {
                expect(
                    shouldCaptureDomEvent(button, {
                        type: `click`,
                    })
                ).toBe(true)
            })
        })

        it(`should protect against bad inputs`, () => {
            expect(
                shouldCaptureDomEvent(null, {
                    type: `click`,
                })
            ).toBe(false)
            expect(
                shouldCaptureDomEvent(undefined, {
                    type: `click`,
                })
            ).toBe(false)
            expect(
                shouldCaptureDomEvent(`div`, {
                    type: `click`,
                })
            ).toBe(false)
        })

        it(`should NOT capture "click" events on <form> elements`, () => {
            expect(
                shouldCaptureDomEvent(document.createElement(`form`), {
                    type: `click`,
                })
            ).toBe(false)
        })
        ;[`html`].forEach((tagName) => {
            it(`should NOT capture "click" events on <` + tagName.toLowerCase() + `> elements`, () => {
                expect(
                    shouldCaptureDomEvent(document.createElement(tagName), {
                        type: `click`,
                    })
                ).toBe(false)
            })
        })
    })

    describe(`shouldCaptureElement`, () => {
        let el, input, parent1, parent2

        beforeEach(() => {
            el = document.createElement(`div`)
            input = document.createElement(`input`)
            parent1 = document.createElement(`div`)
            parent2 = document.createElement(`div`)
            parent1.appendChild(el)
            parent1.appendChild(input)
            parent2.appendChild(parent1)
            document.body.appendChild(parent2)
        })

        it(`should not include input elements`, () => {
            expect(shouldCaptureElement(document.createElement(`input`))).toBe(false)
        })

        it(`should not include select elements`, () => {
            expect(shouldCaptureElement(document.createElement(`select`))).toBe(false)
        })

        it(`should not include textarea elements`, () => {
            expect(shouldCaptureElement(document.createElement(`textarea`))).toBe(false)
        })

        it(`should not include elements where contenteditable="true"`, () => {
            const editable = document.createElement(`div`)
            const noneditable = document.createElement(`div`)

            editable.setAttribute(`contenteditable`, `true`)
            noneditable.setAttribute(`contenteditable`, `false`)

            expect(shouldCaptureElement(editable)).toBe(false)
            expect(shouldCaptureElement(noneditable)).toBe(true)
        })

        it(`should include sensitive elements with class "ph-include"`, () => {
            el.className = `test1 ph-include test2`
            expect(shouldCaptureElement(el)).toBe(true)
        })

        it(`should never include inputs with class "ph-sensitive"`, () => {
            el.className = `test1 ph-include ph-sensitive test2`
            expect(shouldCaptureElement(el)).toBe(false)
        })

        it(`should not include elements with class "ph-no-capture" as properties`, () => {
            el.className = `test1 ph-no-capture test2`
            expect(shouldCaptureElement(el)).toBe(false)
        })

        it(`should not include elements with a parent that have class "ph-no-capture" as properties`, () => {
            parent2.className = `ph-no-capture`
            el.type = `text`
            expect(shouldCaptureElement(el)).toBe(false)
        })

        it(`should not include hidden fields`, () => {
            input.type = `hidden`
            expect(shouldCaptureElement(input)).toBe(false)
        })

        it(`should not include password fields`, () => {
            input.type = `password`
            expect(shouldCaptureElement(input)).toBe(false)
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
                el.name = name
                expect(shouldCaptureElement(el)).toBe(false)
            })
        })

        // See https://github.com/posthog/posthog-js/issues/165
        // Under specific circumstances a bug caused .replace to be called on a DOM element
        // instead of a string, removing the element from the page. Ensure this issue is mitigated.
        it(`shouldn't inadvertently replace DOM nodes`, () => {
            // setup
            el.replace = sinon.spy()

            // test
            parent1.name = el
            shouldCaptureElement(parent1) // previously this would cause el.replace to be called
            expect(el.replace.called).toBe(false)
            parent1.name = undefined

            parent1.id = el
            shouldCaptureElement(parent2) // previously this would cause el.replace to be called
            expect(el.replace.called).toBe(false)
            parent1.id = undefined

            parent1.type = el
            shouldCaptureElement(parent2) // previously this would cause el.replace to be called
            expect(el.replace.called).toBe(false)
            parent1.type = undefined

            // cleanup
            el.replace = undefined
        })
    })

    describe(`shouldCaptureValue`, () => {
        it(`should return false when the value is null`, () => {
            expect(shouldCaptureValue(null)).toBe(false)
        })

        it(`should not include numbers that look like valid credit cards`, () => {
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
            validCCNumbers.forEach((num) => {
                expect(shouldCaptureValue(num)).toBe(false)
            })
        })

        it(`should not include values that look like social security numbers`, () => {
            expect(shouldCaptureValue(`123-45-6789`)).toBe(false)
        })
    })
})
