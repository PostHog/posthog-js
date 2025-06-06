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
    makeSafeText,
} from '../autocapture-utils'
import { document } from '../utils/globals'
import { makeMouseEvent } from './autocapture.test'
import { AutocaptureConfig } from '../types'

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

        it(`should handle text with quotation marks properly`, () => {
            const el = document!.createElement(`div`)

            el.innerHTML = `Text with "double quotes" in it`
            expect(getSafeText(el)).toBe(`Text with "double quotes" in it`)

            el.innerHTML = `Text with 'single quotes' in it`
            expect(getSafeText(el)).toBe(`Text with 'single quotes' in it`)

            el.innerHTML = `Mixed "double" and 'single' quotes`
            expect(getSafeText(el)).toBe(`Mixed "double" and 'single' quotes`)
        })
    })

    describe(`makeSafeText`, () => {
        it(`should handle text with quotation marks properly`, () => {
            expect(makeSafeText(`Text with "double quotes" in it`)).toBe(`Text with "double quotes" in it`)
            expect(makeSafeText(`Text with 'single quotes' in it`)).toBe(`Text with 'single quotes' in it`)
            expect(makeSafeText(`Mixed "double" and 'single' quotes`)).toBe(`Mixed "double" and 'single' quotes`)
        })

        it(`should preserve the structure when splitting and joining text with quotes`, () => {
            const input = `Click here to "get started" today!`
            expect(makeSafeText(input)).toBe(input)
        })

        it(`should handle complex cases with quotes and possibly problematic formats`, () => {
            const testStrings = [
                `Click "OK" to continue`,
                `Select the "My Account" option`,
                `Click "Order History"`,
                `"Double quoted text" with some text after`,
                `Text before "double quoted text"`,
                `A string with "multiple" "quoted" sections`,
                `A string with 'single' 'quoted' sections`,
                `A "mixed quote' string that might cause problems`,
                `A 'mixed quote" string that might cause problems`,
                `"nested "quotes" within" might be an issue`,
                `Line breaks
                 with "quotes" might cause issues`,
                `Quotes "at the end"`,
                `"Quotes at the start" of text`,
                `""`, // Empty quotes
            ]

            // Test each string
            testStrings.forEach((str) => {
                const result = makeSafeText(str)
                expect(result).not.toBeNull()

                // For non-empty strings, we should get a result
                if (str.trim().length > 0) {
                    // If the original had quotes, the result should have them too
                    if (str.includes('"') || str.includes("'")) {
                        // The result should include some form of quotation mark
                        const hasQuotes = result?.includes('"') || result?.includes("'")
                        expect(hasQuotes).toBeTruthy()
                    }
                }
            })
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

        it.each([`input`, `SELECT`, `textarea`])(`should capture "change" events on <%s> elements`, (tagName) => {
            expect(
                shouldCaptureDomEvent(document!.createElement(tagName), {
                    type: `change`,
                } as unknown as Event)
            ).toBe(true)
        })

        it.each([`A`, `a`])(`should capture "click" events on <%s> elements`, (tagName) => {
            expect(shouldCaptureDomEvent(document!.createElement(tagName), makeMouseEvent({}))).toBe(true)
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

        it.each([`html`, 'body'])(`should NOT capture "click" events on <%s> elements`, (tagName) => {
            expect(shouldCaptureDomEvent(document!.createElement(tagName), makeMouseEvent({}))).toBe(false)
        })

        describe('css selector allowlist', () => {
            function makeSingleBranchOfDomTree(tree: { tag: string; id?: string }[]): Element {
                let finalElement: Element | null = null
                for (const { tag, id } of tree) {
                    const el = document!.createElement(tag)
                    if (id) {
                        el.id = id
                    }
                    if (finalElement) {
                        finalElement.appendChild(el)
                        finalElement = el
                    } else {
                        finalElement = el
                    }
                }
                if (!finalElement) {
                    throw new Error('No elements in tree')
                }
                return finalElement
            }

            it.each([
                [
                    'when there is no allowlist',
                    makeSingleBranchOfDomTree([{ tag: 'div' }, { tag: 'button', id: 'in-allowlist' }, { tag: 'svg' }]),
                    undefined,
                    true,
                ],
                [
                    'when there is a parent matching the allow list',
                    makeSingleBranchOfDomTree([{ tag: 'div' }, { tag: 'button', id: 'in-allowlist' }, { tag: 'svg' }]),
                    {
                        css_selector_allowlist: ['[id]'],
                    },
                    true,
                ],
                [
                    'when the click target is matching in the allow list',
                    makeSingleBranchOfDomTree([{ tag: 'div' }, { tag: 'button' }, { tag: 'svg', id: 'in-allowlist' }]),
                    {
                        css_selector_allowlist: ['[id]'],
                    },
                    true,
                ],
                [
                    'when the parent does not match the allowlist',
                    makeSingleBranchOfDomTree([
                        { tag: 'div' },
                        { tag: 'button', id: '[id=not-the-configured-value]' },
                        { tag: 'svg' },
                    ]),
                    {
                        // the click was detected on the SVG, but the button is not in the allow list,
                        // so we should detect the click
                        css_selector_allowlist: ['in-allowlist'],
                    },
                    false,
                ],
                [
                    'when the click target (or its parents) does not match the allowlist',
                    makeSingleBranchOfDomTree([
                        { tag: 'div' },
                        { tag: 'button' },
                        { tag: 'svg', id: '[id=not-the-configured-value]' },
                    ]),
                    {
                        css_selector_allowlist: ['in-allowlist'],
                    },
                    false,
                ],
                [
                    'when combining allow lists',
                    makeSingleBranchOfDomTree([{ tag: 'div' }, { tag: 'button', id: 'in-allowlist' }, { tag: 'svg' }]),
                    {
                        // the tree for the click does have an id
                        css_selector_allowlist: ['[id]'],
                        // but we only detect if there is an img in the tree
                        element_allowlist: ['img'],
                    },
                    false,
                ],
                [
                    'combine allow lists - but showing it considers them separately',
                    makeSingleBranchOfDomTree([
                        { tag: 'div' },
                        { tag: 'button', id: 'in-allowlist' },
                        { tag: 'img' },
                        { tag: 'svg' },
                    ]),
                    {
                        // the tree for the click does have an id
                        css_selector_allowlist: ['[id]'],
                        // and the tree for the click does have an img
                        element_allowlist: ['img'],
                    },
                    true,
                ],
            ])('correctly respects the allow list: %s', (_, clickTarget, autoCaptureConfig, shouldCapture) => {
                expect(
                    shouldCaptureDomEvent(clickTarget, makeMouseEvent({}), autoCaptureConfig as AutocaptureConfig)
                ).toBe(shouldCapture)
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

        it(`should properly handle quotation marks in link text`, () => {
            const link = document!.createElement('a')
            link.innerHTML = `Click here to "get started" today!`

            expect(getDirectAndNestedSpanText(link)).toBe(`Click here to "get started" today!`)

            link.innerHTML = `Click here to 'get started' today!`
            expect(getDirectAndNestedSpanText(link)).toBe(`Click here to 'get started' today!`)

            link.innerHTML = `Click here to "get started" with our 'special offer'!`
            expect(getDirectAndNestedSpanText(link)).toBe(`Click here to "get started" with our 'special offer'!`)
        })

        it(`should properly handle complex titles with multiple quotes`, () => {
            const link = document!.createElement('a')
            link.innerHTML = `Course Title: "Understanding the 'Creative Process' in Modern Design"`

            // Check that quotes are preserved in the extracted text
            expect(getDirectAndNestedSpanText(link)).toBe(
                `Course Title: "Understanding the 'Creative Process' in Modern Design"`
            )

            // Test with a link using title attribute
            link.setAttribute('title', `Course Title: "Understanding the 'Creative Process' in Modern Design"`)
            expect(link.getAttribute('title')).toBe(
                `Course Title: "Understanding the 'Creative Process' in Modern Design"`
            )
        })

        it(`should handle link text with multiple text nodes`, () => {
            // Create a link element
            const link = document!.createElement('a')

            // Add multiple text nodes to simulate how browsers might split text content
            const textNode1 = document.createTextNode('Course Title: ')
            const textNode2 = document.createTextNode('"Understanding the \'Creative Process\' in Modern Design"')

            link.appendChild(textNode1)
            link.appendChild(textNode2)

            // Since we're creating direct text nodes, we need to check the actual output format
            // This matches how makeSafeText joins text segments without spaces between text nodes
            const expected = 'Course Title:"Understanding the \'Creative Process\' in Modern Design"'
            expect(getDirectAndNestedSpanText(link)).toBe(expected)
        })

        it(`should handle link text with spans containing parts of quoted text`, () => {
            // Create a link element
            const link = document!.createElement('a')

            // Add a text node for the first part
            link.appendChild(document.createTextNode('Course Title: '))

            // Add a span with the quoted part
            const span = document!.createElement('span')
            span.textContent = '"Understanding the \'Creative Process\' in Modern Design"'
            link.appendChild(span)

            // Verify the text is properly collected and joined
            expect(getDirectAndNestedSpanText(link)).toBe(
                `Course Title: "Understanding the 'Creative Process' in Modern Design"`
            )
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
                {
                    tag_name: 'div',
                    $el_text: 'text',
                    nth_child: 1,
                    nth_of_type: 2,
                },
            ])

            expect(elementChain).toEqual('div:nth-child="1"nth-of-type="2"text="text"')
        })

        it('should properly escape quotation marks in elements', () => {
            // Test with double quotes
            let elementChain = getElementsChainString([
                {
                    tag_name: 'a',
                    $el_text: 'Click here to "get started" today!',
                    nth_child: 1,
                    nth_of_type: 1,
                },
            ])

            // Should properly escape double quotes
            expect(elementChain).toContain('text="Click here to \\"get started\\" today!"')

            // Test with single quotes
            elementChain = getElementsChainString([
                {
                    tag_name: 'a',
                    $el_text: "Click here to 'get started' today!",
                    nth_child: 1,
                    nth_of_type: 1,
                },
            ])

            // Single quotes don't need to be escaped
            expect(elementChain).toContain('text="Click here to \'get started\' today!"')

            // Test with mixed quotes
            elementChain = getElementsChainString([
                {
                    tag_name: 'a',
                    $el_text: 'Course Title: "Understanding the \'Creative Process\' in Modern Design"',
                    nth_child: 1,
                    nth_of_type: 1,
                },
            ])

            // Should properly escape double quotes, single quotes remain unescaped
            expect(elementChain).toContain(
                'text="Course Title: \\"Understanding the \'Creative Process\' in Modern Design\\""'
            )
        })

        it('should ensure consistency between captured $el_text and processed elements chain text', () => {
            // Create test elements with different quotation patterns
            const testElements = [
                {
                    $el_text: 'Click "Sign Up" button',
                    tag_name: 'a',
                    nth_child: 1,
                    nth_of_type: 1,
                },
                {
                    $el_text: 'Course Title: "Understanding the \'Creative Process\' in Modern Design"',
                    tag_name: 'button',
                    nth_child: 2,
                    nth_of_type: 1,
                },
                {
                    $el_text: 'Text with "multiple" "quoted" sections',
                    tag_name: 'span',
                    nth_child: 3,
                    nth_of_type: 1,
                },
            ]

            // Get the elements chain string
            const elementsChain = getElementsChainString(testElements)

            // For each test element, verify the element text is properly escaped in the chain
            testElements.forEach((element) => {
                const expectedText = element.$el_text
                const escapedText = expectedText.replace(/"/g, '\\"')

                // The elements chain should contain the ESCAPED text
                expect(elementsChain).toContain(`text="${escapedText}"`)
            })
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
            el.className = '  class1\r\n   \r\n     \n  \t\f   class2  \t'
            const classNames = getClassNames(el)
            expect(classNames).toEqual(['class1', 'class2'])
        })
    })
})
