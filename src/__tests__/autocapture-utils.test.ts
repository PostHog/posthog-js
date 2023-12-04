/// <reference lib="dom" />

import sinon from 'sinon'

import {
    getSafeText,
    shouldCaptureDomEvent,
    shouldCaptureElement,
    isSensitiveElement,
    shouldCaptureValue,
    isAngularStyleAttr,
    getNestedSpanText,
    getDirectAndNestedSpanText,
    getElementsChainString,
    getClassNames,
} from '../autocapture-utils'
import { document } from '../utils/globals'
import { makeMouseEvent } from './autocapture.test'

describe(`Autocapture utility functions`, () => {
    afterEach(() => {
        document!.getElementsByTagName('html')[0].innerHTML = ''
    })

    describe(`getSafeText`, () => {
        it(`should collect and normalize text from elements`, () => {
            const el = document!.createElement(`div`)

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
            const el = document!.createElement(`div`)
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

            el = document!.createElement(`input`)
            el.innerHTML = `Why hello there`
            expect(getSafeText(el)).toBe(``)

            el = document!.createElement(`textarea`)
            el.innerHTML = `Why hello there`
            expect(getSafeText(el)).toBe(``)

            el = document!.createElement(`select`)
            el.innerHTML = `Why hello there`
            expect(getSafeText(el)).toBe(``)

            el = document!.createElement(`div`)
            el.setAttribute(`contenteditable`, `true`)
            el.innerHTML = `Why hello there`
            expect(getSafeText(el)).toBe(``)
        })

        it(`shouldn't collect sensitive values`, () => {
            const el = document!.createElement(`div`)

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
                shouldCaptureDomEvent(document!.createElement(`form`), {
                    type: `submit`,
                } as unknown as Event)
            ).toBe(true)
        })
        ;[`input`, `SELECT`, `textarea`].forEach((tagName) => {
            it(`should capture "change" events on <` + tagName.toLowerCase() + `> elements`, () => {
                expect(
                    shouldCaptureDomEvent(document!.createElement(tagName), {
                        type: `change`,
                    } as unknown as Event)
                ).toBe(true)
            })
        })

        // [`div`, `sPan`, `A`, `strong`, `table`]
        ;['a'].forEach((tagName) => {
            it(`should capture "click" events on <` + tagName.toLowerCase() + `> elements`, () => {
                expect(shouldCaptureDomEvent(document!.createElement(tagName), makeMouseEvent({}))).toBe(true)
            })
        })

        it(`should capture "click" events on <button> elements`, () => {
            const button1 = document!.createElement(`button`)
            const button2 = document!.createElement(`input`)
            button2.setAttribute(`type`, `button`)
            const button3 = document!.createElement(`input`)
            button3.setAttribute(`type`, `submit`)
            ;[button1, button2, button3].forEach((button) => {
                expect(shouldCaptureDomEvent(button, makeMouseEvent({}))).toBe(true)
            })
        })

        it(`should protect against bad inputs`, () => {
            expect(shouldCaptureDomEvent(null as unknown as Element, makeMouseEvent({}))).toBe(false)
            expect(shouldCaptureDomEvent(undefined as unknown as Element, makeMouseEvent({}))).toBe(false)
            expect(shouldCaptureDomEvent(`div` as unknown as Element, makeMouseEvent({}))).toBe(false)
        })

        it(`should NOT capture "click" events on <form> elements`, () => {
            expect(shouldCaptureDomEvent(document!.createElement(`form`), makeMouseEvent({}))).toBe(false)
        })
        ;[`html`].forEach((tagName) => {
            it(`should NOT capture "click" events on <` + tagName.toLowerCase() + `> elements`, () => {
                expect(shouldCaptureDomEvent(document!.createElement(tagName), makeMouseEvent({}))).toBe(false)
            })
        })
    })

    describe(`isSensitiveElement`, () => {
        it(`should not include input elements`, () => {
            expect(isSensitiveElement(document!.createElement(`input`))).toBe(true)
        })

        it(`should not include select elements`, () => {
            expect(isSensitiveElement(document!.createElement(`select`))).toBe(true)
        })

        it(`should not include textarea elements`, () => {
            expect(isSensitiveElement(document!.createElement(`textarea`))).toBe(true)
        })

        it(`should not include elements where contenteditable="true"`, () => {
            const editable = document!.createElement(`div`)
            const noneditable = document!.createElement(`div`)

            editable.setAttribute(`contenteditable`, `true`)
            noneditable.setAttribute(`contenteditable`, `false`)

            expect(isSensitiveElement(editable)).toBe(true)
            expect(isSensitiveElement(noneditable)).toBe(false)
        })
    })

    describe(`shouldCaptureElement`, () => {
        let el: HTMLDivElement
        let input: HTMLInputElement
        let parent1: HTMLDivElement
        let parent2: HTMLDivElement

        beforeEach(() => {
            el = document!.createElement(`div`)
            input = document!.createElement(`input`)
            parent1 = document!.createElement(`div`)
            parent2 = document!.createElement(`div`)
            parent1.appendChild(el)
            parent1.appendChild(input)
            parent2.appendChild(parent1)
            document!.body.appendChild(parent2)
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
            expect(shouldCaptureElement(el)).toBe(true)

            parent2.className = `ph-no-capture`

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
                input.name = ''
                expect(shouldCaptureElement(input)).toBe(true)

                input.name = name
                expect(shouldCaptureElement(input)).toBe(false)
            })
        })

        // See https://github.com/posthog/posthog-js/issues/165
        // Under specific circumstances a bug caused .replace to be called on a DOM element
        // instead of a string, removing the element from the page. Ensure this issue is mitigated.
        it(`shouldn't inadvertently replace DOM nodes`, () => {
            // setup
            ;(el as any).replace = sinon.spy()

            // test
            input.name = el as any
            shouldCaptureElement(parent1) // previously this would cause el.replace to be called
            expect((el as any).replace.called).toBe(false)
            input.name = ''

            parent1.id = el as any
            shouldCaptureElement(parent2) // previously this would cause el.replace to be called
            expect((el as any).replace.called).toBe(false)
            parent1.id = ''

            input.type = el as any
            shouldCaptureElement(parent2) // previously this would cause el.replace to be called
            expect((el as any).replace.called).toBe(false)
            input.type = ''

            // cleanup
            ;(el as any).replace = undefined
        })
    })

    describe(`shouldCaptureValue`, () => {
        it(`should return false when the value is null`, () => {
            expect(shouldCaptureValue(null as unknown as string)).toBe(false)
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

    describe('isAngularStyleAttr', () => {
        it('should detect attribute names that match _ngcontent*', () => {
            expect(isAngularStyleAttr('_ngcontent')).toBe(true)
            expect(isAngularStyleAttr('_ngcontent-c1')).toBe(true)
            expect(isAngularStyleAttr('_ngcontent-dpm-c448')).toBe(true)
        })
        it('should detect attribute names that match _nghost*', () => {
            expect(isAngularStyleAttr('_nghost')).toBe(true)
            expect(isAngularStyleAttr('_nghost-c1')).toBe(true)
            expect(isAngularStyleAttr('_nghost-dpm-c448')).toBe(true)
        })
        it('should not detect attribute names that dont start with _ngcontent or _nghost', () => {
            expect(isAngularStyleAttr('_ng-attr')).toBe(false)
            expect(isAngularStyleAttr('style')).toBe(false)
            expect(isAngularStyleAttr('class-name')).toBe(false)
        })
        it('should be safe for non-string attribute names', () => {
            expect(isAngularStyleAttr(1 as unknown as string)).toBe(false)
            expect(isAngularStyleAttr(null as unknown as string)).toBe(false)
        })
    })

    describe(`getDirectAndNestedSpanText`, () => {
        it(`should return direct text on the element with no children`, () => {
            const el = document!.createElement(`button`)
            el.innerHTML = `test`
            expect(getDirectAndNestedSpanText(el)).toBe('test')
        })
        it(`should return the direct text on the el and text from child spans`, () => {
            const parent = document!.createElement(`button`)
            parent.innerHTML = `test`
            const child = document!.createElement(`span`)
            child.innerHTML = `test 1`
            parent.appendChild(child)
            expect(getDirectAndNestedSpanText(parent)).toBe('test test 1')
        })
    })

    describe(`getNestedSpanText`, () => {
        it(`should return an empty string if there are no children or text`, () => {
            const el = document!.createElement(`button`)
            expect(getNestedSpanText(el)).toBe('')
        })
        it(`should return the text from sibling child spans`, () => {
            const parent = document!.createElement(`button`)
            const child1 = document!.createElement(`span`)
            child1.innerHTML = `test`
            parent.appendChild(child1)
            expect(getNestedSpanText(parent)).toBe('test')
            const child2 = document!.createElement(`span`)
            child2.innerHTML = `test2`
            parent.appendChild(child2)
            expect(getNestedSpanText(parent)).toBe('test test2')
        })
        it(`should return the text from nested child spans`, () => {
            const parent = document!.createElement(`button`)
            const child1 = document!.createElement(`span`)
            child1.innerHTML = `test`
            parent.appendChild(child1)
            const child2 = document!.createElement(`span`)
            child2.innerHTML = `test2`
            child1.appendChild(child2)
            expect(getNestedSpanText(parent)).toBe('test test2')
        })
    })

    describe('getElementsChainString', () => {
        it('should return an empty string with no elements', () => {
            const elementChain = getElementsChainString([])

            expect(elementChain).toEqual('')
        })
        it('should process elements correctly', () => {
            const elementChain = getElementsChainString([
                { tag_name: 'div', nth_child: 1, nth_of_type: 2, $el_text: 'text' },
            ])

            expect(elementChain).toEqual('div:text="text"nth-child="1"nth-of-type="2"')
        })
    })

    describe('getClassNames', () => {
        it('should cope when there is no classNames attribute', () => {
            const el = document!.createElement('div')
            const classNames = getClassNames(el)
            expect(classNames).toEqual([])
        })
        it('should cope when there is an empty classNames attribute', () => {
            const el = document!.createElement('div')
            el.className = ''
            const classNames = getClassNames(el)
            expect(classNames).toEqual([])
        })
        it('should cope with a normal class list', () => {
            const el = document!.createElement('div')
            el.className = 'class1 class2'
            const classNames = getClassNames(el)
            expect(classNames).toEqual(['class1', 'class2'])
        })
        it('should cope with a class list with empty strings and tabs', () => {
            const el = document!.createElement('div')
            el.className = '  class1        class2  '
            const classNames = getClassNames(el)
            expect(classNames).toEqual(['class1', 'class2'])
        })
        it('should cope with a class list with unexpected new lines', () => {
            const el = document!.createElement('div')
            el.className = '  class1\r\n   \r\n     \n     class2  '
            const classNames = getClassNames(el)
            expect(classNames).toEqual(['class1', 'class2'])
        })
    })
})
