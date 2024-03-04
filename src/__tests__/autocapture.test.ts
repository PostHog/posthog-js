/// <reference lib="dom" />
/* eslint-disable compat/compat */
import sinon from 'sinon'

import { autocapture } from '../autocapture'
import { shouldCaptureDomEvent } from '../autocapture-utils'
import { AUTOCAPTURE_DISABLED_SERVER_SIDE } from '../constants'
import { AutocaptureConfig, DecideResponse, PostHogConfig } from '../types'
import { PostHog } from '../posthog-core'
import { PostHogPersistence } from '../posthog-persistence'
import { window } from '../utils/globals'

class MockClipboardEvent extends Event implements ClipboardEvent {
    clipboardData: DataTransfer | null = null
    type: 'copy' | 'cut' | 'paste' = 'copy'
}
window!.ClipboardEvent = MockClipboardEvent

const triggerMouseEvent = function (node: Node, eventType: string) {
    node.dispatchEvent(
        new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
        })
    )
}

const simulateClick = function (el: Node) {
    triggerMouseEvent(el, 'click')
}

function makePostHog(ph: Partial<PostHog>): PostHog {
    return {
        get_distinct_id() {
            return 'distinctid'
        },
        ...ph,
    } as unknown as PostHog
}

export function makeMouseEvent(partialEvent: Partial<MouseEvent>) {
    return { type: 'click', ...partialEvent } as unknown as MouseEvent
}

export function makeCopyEvent(partialEvent: Partial<ClipboardEvent>) {
    return { type: 'copy', ...partialEvent } as unknown as ClipboardEvent
}

export function makeCutEvent(partialEvent: Partial<ClipboardEvent>) {
    return { type: 'cut', ...partialEvent } as unknown as ClipboardEvent
}

describe('Autocapture system', () => {
    const originalWindowLocation = window!.location

    let decideResponse: DecideResponse
    let $autocapture_disabled_server_side: boolean

    beforeEach(() => {
        jest.spyOn(window!.console, 'log').mockImplementation()

        Object.defineProperty(window, 'location', {
            configurable: true,
            enumerable: true,
            writable: true,
            // eslint-disable-next-line compat/compat
            value: new URL('https://example.com'),
        })

        autocapture._isDisabledServerSide = null
        $autocapture_disabled_server_side = false
        decideResponse = {
            config: {
                enable_collect_everything: true,
            },
            // TODO: delete custom_properties after changeless typescript refactor
            custom_properties: [
                {
                    event_selectors: ['.event-element-1', '.event-element-2'],
                    css_selector: '.property-element',
                    name: 'my property name',
                },
            ],
        } as DecideResponse
    })

    afterEach(() => {
        document.getElementsByTagName('html')[0].innerHTML = ''

        Object.defineProperty(window, 'location', {
            configurable: true,
            enumerable: true,
            value: originalWindowLocation,
        })
    })

    describe('_getPropertiesFromElement', () => {
        let div: HTMLDivElement
        let div2: HTMLDivElement
        let input: HTMLInputElement
        let sensitiveInput: HTMLInputElement
        let hidden: HTMLInputElement
        let password: HTMLInputElement

        beforeEach(() => {
            div = document.createElement('div')
            div.className = 'class1 class2 class3          ' // Lots of spaces might mess things up
            div.innerHTML = 'my <span>sweet <i>inner</i></span> text'

            input = document.createElement('input')
            input.value = 'test val'

            sensitiveInput = document.createElement('input')
            sensitiveInput.value = 'test val'
            sensitiveInput.className = 'ph-sensitive'

            hidden = document.createElement('input')
            hidden.setAttribute('type', 'hidden')
            hidden.value = 'hidden val'

            password = document.createElement('input')
            password.setAttribute('type', 'password')
            password.value = 'password val'

            const divSibling = document.createElement('div')
            const divSibling2 = document.createElement('span')

            div2 = document.createElement('div')
            div2.className = 'parent'
            div2.appendChild(divSibling)
            div2.appendChild(divSibling2)
            div2.appendChild(div)
            div2.appendChild(input)
            div2.appendChild(sensitiveInput)
            div2.appendChild(hidden)
            div2.appendChild(password)
        })

        it('should contain the proper tag name', () => {
            const props = autocapture._getPropertiesFromElement(div, false, false)
            expect(props['tag_name']).toBe('div')
        })

        it('should contain class list', () => {
            const props = autocapture._getPropertiesFromElement(div, false, false)
            expect(props['classes']).toEqual(['class1', 'class2', 'class3'])
        })

        it('should not collect input value', () => {
            const props = autocapture._getPropertiesFromElement(input, false, false)
            expect(props['value']).toBeUndefined()
        })

        it('should strip element value with class "ph-sensitive"', () => {
            const props = autocapture._getPropertiesFromElement(sensitiveInput, false, false)
            expect(props['value']).toBeUndefined()
        })

        it('should strip hidden element value', () => {
            const props = autocapture._getPropertiesFromElement(hidden, false, false)
            expect(props['value']).toBeUndefined()
        })

        it('should strip password element value', () => {
            const props = autocapture._getPropertiesFromElement(password, false, false)
            expect(props['value']).toBeUndefined()
        })

        it('should contain nth-of-type', () => {
            const props = autocapture._getPropertiesFromElement(div, false, false)
            expect(props['nth_of_type']).toBe(2)
        })

        it('should contain nth-child', () => {
            const props = autocapture._getPropertiesFromElement(password, false, false)
            expect(props['nth_child']).toBe(7)
        })

        it('should filter out Angular content attributes', () => {
            const angularDiv = document.createElement('div')
            angularDiv.setAttribute('_ngcontent-dpm-c448', '')
            angularDiv.setAttribute('_nghost-dpm-c448', '')
            const props = autocapture._getPropertiesFromElement(angularDiv, false, false)
            expect(props['_ngcontent-dpm-c448']).toBeUndefined()
            expect(props['_nghost-dpm-c448']).toBeUndefined()
        })

        it('should filter element attributes based on the ignorelist', () => {
            autocapture.config = {
                element_attribute_ignorelist: ['data-attr', 'data-attr-2'],
            }
            div.setAttribute('data-attr', 'value')
            div.setAttribute('data-attr-2', 'value')
            div.setAttribute('data-attr-3', 'value')
            const props = autocapture._getPropertiesFromElement(div, false, false)
            expect(props['attr__data-attr']).toBeUndefined()
            expect(props['attr__data-attr-2']).toBeUndefined()
            expect(props['attr__data-attr-3']).toBe('value')
        })

        it('an empty ignorelist does nothing', () => {
            autocapture.config = {
                element_attribute_ignorelist: [],
            }
            div.setAttribute('data-attr', 'value')
            div.setAttribute('data-attr-2', 'value')
            div.setAttribute('data-attr-3', 'value')
            const props = autocapture._getPropertiesFromElement(div, false, false)
            expect(props['attr__data-attr']).toBe('value')
            expect(props['attr__data-attr-2']).toBe('value')
            expect(props['attr__data-attr-3']).toBe('value')
        })
    })

    describe('_getAugmentPropertiesFromElement', () => {
        let div: HTMLDivElement
        let div2: HTMLDivElement
        let input: HTMLInputElement
        let sensitiveInput: HTMLInputElement
        let hidden: HTMLInputElement
        let password: HTMLInputElement

        beforeEach(() => {
            div = document.createElement('div')
            div.className = 'class1 class2 class3          ' // Lots of spaces might mess things up
            div.innerHTML = 'my <span>sweet <i>inner</i></span> text'
            div.setAttribute('data-ph-capture-attribute-one-on-the-div', 'one')
            div.setAttribute('data-ph-capture-attribute-two-on-the-div', 'two')
            div.setAttribute('data-ph-capture-attribute-falsey-on-the-div', '0')
            div.setAttribute('data-ph-capture-attribute-false-on-the-div', 'false')

            input = document.createElement('input')
            input.setAttribute('data-ph-capture-attribute-on-the-input', 'is on the input')
            input.value = 'test val'

            sensitiveInput = document.createElement('input')
            sensitiveInput.value = 'test val'
            sensitiveInput.setAttribute('data-ph-capture-attribute-on-the-sensitive-input', 'is on the sensitive-input')
            sensitiveInput.className = 'ph-sensitive'

            hidden = document.createElement('input')
            hidden.setAttribute('type', 'hidden')
            hidden.setAttribute('data-ph-capture-attribute-on-the-hidden', 'is on the hidden')
            hidden.value = 'hidden val'

            password = document.createElement('input')
            password.setAttribute('type', 'password')
            password.setAttribute('data-ph-capture-attribute-on-the-password', 'is on the password')
            password.value = 'password val'

            const divSibling = document.createElement('div')
            const divSibling2 = document.createElement('span')

            div2 = document.createElement('div')
            div2.className = 'parent'
            div2.appendChild(divSibling)
            div2.appendChild(divSibling2)
            div2.appendChild(div)
            div2.appendChild(input)
            div2.appendChild(sensitiveInput)
            div2.appendChild(hidden)
            div2.appendChild(password)
        })

        it('should collect multiple augments from elements', () => {
            const props = autocapture._getAugmentPropertiesFromElement(div)
            expect(props['one-on-the-div']).toBe('one')
            expect(props['two-on-the-div']).toBe('two')
            expect(props['falsey-on-the-div']).toBe('0')
            expect(props['false-on-the-div']).toBe('false')
        })

        it('should collect augment from input value', () => {
            const props = autocapture._getAugmentPropertiesFromElement(input)
            expect(props['on-the-input']).toBe('is on the input')
        })

        it('should collect augment from input with class "ph-sensitive"', () => {
            const props = autocapture._getAugmentPropertiesFromElement(sensitiveInput)
            expect(props['on-the-sensitive-input']).toBeUndefined()
        })

        it('should not collect augment from the hidden element value', () => {
            const props = autocapture._getAugmentPropertiesFromElement(hidden)
            expect(props).toStrictEqual({})
        })

        it('should collect augment from the password element value', () => {
            const props = autocapture._getAugmentPropertiesFromElement(password)
            expect(props).toStrictEqual({})
        })
    })

    describe('isBrowserSupported', () => {
        let orig: typeof document.querySelectorAll

        beforeEach(() => {
            orig = document.querySelectorAll
        })

        afterEach(() => {
            document.querySelectorAll = orig
        })

        it('should return true if document.querySelectorAll is a function', () => {
            document.querySelectorAll = function () {
                return [] as unknown as NodeListOf<Element>
            }
            expect(autocapture.isBrowserSupported()).toBe(true)
        })

        it('should return false if document.querySelectorAll is not a function', () => {
            document.querySelectorAll = undefined as unknown as typeof document.querySelectorAll
            expect(autocapture.isBrowserSupported()).toBe(false)
        })
    })

    describe('enabledForProject', () => {
        it('should enable ce for the project with token "d" when 5 buckets are enabled out of 10', () => {
            expect(autocapture.enabledForProject('d', 10, 5)).toBe(true)
        })
        it('should NOT enable ce for the project with token "a" when 5 buckets are enabled out of 10', () => {
            expect(autocapture.enabledForProject('a', 10, 5)).toBe(false)
        })
    })

    describe('_previousElementSibling', () => {
        it('should return the adjacent sibling', () => {
            const div = document.createElement('div')
            const sibling = document.createElement('div')
            const child = document.createElement('div')
            div.appendChild(sibling)
            div.appendChild(child)
            expect(autocapture._previousElementSibling(child)).toBe(sibling)
        })

        it('should return the first child and not the immediately previous sibling (text)', () => {
            const div = document.createElement('div')
            const sibling = document.createElement('div')
            const child = document.createElement('div')
            div.appendChild(sibling)
            div.appendChild(document.createTextNode('some text'))
            div.appendChild(child)
            expect(autocapture._previousElementSibling(child)).toBe(sibling)
        })

        it('should return null when the previous sibling is a text node', () => {
            const div = document.createElement('div')
            const child = document.createElement('div')
            div.appendChild(document.createTextNode('some text'))
            div.appendChild(child)
            expect(autocapture._previousElementSibling(child)).toBeNull()
        })
    })

    describe('_getDefaultProperties', () => {
        it('should return the default properties', () => {
            expect(autocapture._getDefaultProperties('test')).toEqual({
                $event_type: 'test',
                $ce_version: 1,
            })
        })
    })

    describe('_getCustomProperties', () => {
        let customProps
        let noCustomProps
        let capturedElem: HTMLDivElement
        let capturedElemChild
        let uncapturedElem: HTMLDivElement
        let sensitiveInput: HTMLInputElement
        let sensitiveDiv: HTMLDivElement
        let prop1
        let prop2
        let prop3: HTMLDivElement

        beforeEach(() => {
            capturedElem = document.createElement('div')
            capturedElem.className = 'ce_event'

            capturedElemChild = document.createElement('span')
            capturedElem.appendChild(capturedElemChild)

            uncapturedElem = document.createElement('div')
            uncapturedElem.className = 'uncaptured_event'

            sensitiveInput = document.createElement('input')
            sensitiveInput.className = 'sensitive_event'

            sensitiveDiv = document.createElement('div')
            sensitiveDiv.className = 'sensitive_event'

            prop1 = document.createElement('div')
            prop1.className = '_mp_test_property_1'
            prop1.innerHTML = 'Test prop 1'

            prop2 = document.createElement('div')
            prop2.className = '_mp_test_property_2'
            prop2.innerHTML = 'Test prop 2'

            prop3 = document.createElement('div')
            prop3.className = '_mp_test_property_3'
            prop3.innerHTML = 'Test prop 3'

            document.body.appendChild(uncapturedElem)
            document.body.appendChild(capturedElem)
            document.body.appendChild(sensitiveInput)
            document.body.appendChild(sensitiveDiv)
            document.body.appendChild(prop1)
            document.body.appendChild(prop2)
            document.body.appendChild(prop3)

            autocapture._customProperties = [
                {
                    name: 'Custom Property 1',
                    css_selector: 'div._mp_test_property_1',
                    event_selectors: ['.ce_event'],
                },
                {
                    name: 'Custom Property 2',
                    css_selector: 'div._mp_test_property_2',
                    event_selectors: ['.event_with_no_element'],
                },
                {
                    name: 'Custom Property 3',
                    css_selector: 'div._mp_test_property_3',
                    event_selectors: ['.sensitive_event'],
                },
            ]
        })

        it('should return custom properties for only matching element selectors', () => {
            customProps = autocapture._getCustomProperties([capturedElem])
            expect(customProps).toEqual({
                'Custom Property 1': 'Test prop 1',
            })
        })

        it('should return no custom properties for elements that do not match an event selector', () => {
            noCustomProps = autocapture._getCustomProperties([uncapturedElem])
            expect(noCustomProps).toEqual({})
        })

        it('should return no custom properties for sensitive elements', () => {
            // test password field
            sensitiveInput.setAttribute('type', 'password')
            noCustomProps = autocapture._getCustomProperties([sensitiveInput])
            expect(noCustomProps).toEqual({})
            // verify that capturing the sensitive element along with another element only collects
            // the non-sensitive element's custom properties
            customProps = autocapture._getCustomProperties([capturedElem, sensitiveInput])
            expect(customProps).toEqual({ 'Custom Property 1': 'Test prop 1' })

            // test hidden field
            sensitiveInput.setAttribute('type', 'hidden')
            noCustomProps = autocapture._getCustomProperties([sensitiveInput])
            expect(noCustomProps).toEqual({})
            customProps = autocapture._getCustomProperties([capturedElem, sensitiveInput])
            expect(customProps).toEqual({ 'Custom Property 1': 'Test prop 1' })

            // test field with sensitive-looking name
            sensitiveInput.setAttribute('type', '')
            sensitiveInput.setAttribute('name', 'cc') // cc assumed to indicate credit card field
            noCustomProps = autocapture._getCustomProperties([sensitiveInput])
            expect(noCustomProps).toEqual({})
            customProps = autocapture._getCustomProperties([capturedElem, sensitiveInput])
            expect(customProps).toEqual({ 'Custom Property 1': 'Test prop 1' })

            // test field with sensitive-looking id
            sensitiveInput.setAttribute('name', '')
            sensitiveInput.setAttribute('id', 'cc') // cc assumed to indicate credit card field
            noCustomProps = autocapture._getCustomProperties([sensitiveInput])
            expect(noCustomProps).toEqual({})
            customProps = autocapture._getCustomProperties([capturedElem, sensitiveInput])
            expect(customProps).toEqual({ 'Custom Property 1': 'Test prop 1' })

            // clean up
            sensitiveInput.setAttribute('type', '')
            sensitiveInput.setAttribute('name', '')
            sensitiveInput.setAttribute('id', '')
        })

        it('should return no custom properties for element with sensitive values', () => {
            // verify the base case DOES capture the custom property
            customProps = autocapture._getCustomProperties([sensitiveDiv])
            expect(customProps).toEqual({ 'Custom Property 3': 'Test prop 3' })
            customProps = autocapture._getCustomProperties([capturedElem, sensitiveDiv])
            expect(customProps).toEqual({
                'Custom Property 1': 'Test prop 1',
                'Custom Property 3': 'Test prop 3',
            })

            // test values that look like credit card numbers
            prop3.innerHTML = '4111111111111111' // valid credit card number
            noCustomProps = autocapture._getCustomProperties([sensitiveDiv])
            expect(noCustomProps).toEqual({ 'Custom Property 3': '' })
            customProps = autocapture._getCustomProperties([capturedElem, sensitiveDiv])
            expect(customProps).toEqual({
                'Custom Property 1': 'Test prop 1',
                'Custom Property 3': '',
            })
            prop3.innerHTML = '5105-1051-0510-5100' // valid credit card number
            noCustomProps = autocapture._getCustomProperties([sensitiveDiv])
            expect(noCustomProps).toEqual({ 'Custom Property 3': '' })
            customProps = autocapture._getCustomProperties([capturedElem, sensitiveDiv])
            expect(customProps).toEqual({
                'Custom Property 1': 'Test prop 1',
                'Custom Property 3': '',
            })
            prop3.innerHTML = '1235-8132-1345-5891' // invalid credit card number
            noCustomProps = autocapture._getCustomProperties([sensitiveDiv])
            expect(noCustomProps).toEqual({ 'Custom Property 3': '1235-8132-1345-5891' })
            customProps = autocapture._getCustomProperties([capturedElem, sensitiveDiv])
            expect(customProps).toEqual({
                'Custom Property 1': 'Test prop 1',
                'Custom Property 3': '1235-8132-1345-5891',
            })

            // test values that look like social-security numbers
            prop3.innerHTML = '123-58-1321' // valid SSN
            noCustomProps = autocapture._getCustomProperties([sensitiveDiv])
            expect(noCustomProps).toEqual({ 'Custom Property 3': '' })
            customProps = autocapture._getCustomProperties([capturedElem, sensitiveDiv])
            expect(customProps).toEqual({
                'Custom Property 1': 'Test prop 1',
                'Custom Property 3': '',
            })
            prop3.innerHTML = '1235-81-321' // invalid SSN
            noCustomProps = autocapture._getCustomProperties([sensitiveDiv])
            expect(noCustomProps).toEqual({ 'Custom Property 3': '1235-81-321' })
            customProps = autocapture._getCustomProperties([capturedElem, sensitiveDiv])
            expect(customProps).toEqual({
                'Custom Property 1': 'Test prop 1',
                'Custom Property 3': '1235-81-321',
            })

            // clean up
            prop3.innerHTML = 'Test prop 3'
        })
    })

    describe('_captureEvent', () => {
        let lib: PostHog
        let sandbox: sinon.SinonSandbox

        const getCapturedProps = function (captureSpy: unknown) {
            const captureArgs = (captureSpy as sinon.SinonSpy).args[0]
            return captureArgs[1]
        }

        beforeEach(() => {
            sandbox = sinon.createSandbox()
            lib = makePostHog({
                capture: sandbox.spy(),
                config: {
                    mask_all_element_attributes: false,
                    rageclick: true,
                } as PostHogConfig,
            })
        })

        afterEach(() => {
            sandbox.restore()
        })

        it('should add the custom property when an element matching any of the event selectors is clicked', () => {
            lib = makePostHog({
                _prepare_callback: sandbox.spy((callback) => callback),
                config: {
                    api_host: 'https://test.com',
                    token: 'testtoken',
                    mask_all_element_attributes: false,
                    autocapture: true,
                } as PostHogConfig,
                capture: sandbox.spy(),
                toolbar: {
                    maybeLoadToolbar: jest.fn(),
                } as unknown as PostHog['toolbar'],
                get_property: (property_key: string) =>
                    property_key === AUTOCAPTURE_DISABLED_SERVER_SIDE ? $autocapture_disabled_server_side : undefined,
            })
            $autocapture_disabled_server_side = false
            autocapture.init(lib)
            autocapture.afterDecideResponse(decideResponse, lib)

            const eventElement1 = document.createElement('div')
            const eventElement2 = document.createElement('div')
            const propertyElement = document.createElement('div')
            eventElement1.className = 'event-element-1'
            eventElement1.style.cursor = 'pointer'
            eventElement2.className = 'event-element-2'
            eventElement2.style.cursor = 'pointer'
            propertyElement.className = 'property-element'
            propertyElement.textContent = 'my property value'
            document.body.appendChild(eventElement1)
            document.body.appendChild(eventElement2)
            document.body.appendChild(propertyElement)

            expect((lib.capture as sinon.SinonSpy).callCount).toBe(0)
            simulateClick(eventElement1)
            simulateClick(eventElement2)
            expect((lib.capture as sinon.SinonSpy).callCount).toBe(2)
            const captureArgs1 = (lib.capture as sinon.SinonSpy).args[0]
            const captureArgs2 = (lib.capture as sinon.SinonSpy).args[1]
            const eventType1 = captureArgs1[1]['my property name']
            const eventType2 = captureArgs2[1]['my property name']
            expect(eventType1).toBe('my property value')
            expect(eventType2).toBe('my property value')
            ;(lib.capture as sinon.SinonSpy).resetHistory()
        })

        it('should capture rageclick', () => {
            autocapture.init(lib)

            const elTarget = document.createElement('img')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('a')
            elGrandparent.setAttribute('href', 'https://test.com')
            elGrandparent.appendChild(elParent)
            const fakeEvent = makeMouseEvent({
                target: elTarget,
                clientX: 5,
                clientY: 5,
            })
            Object.setPrototypeOf(fakeEvent, MouseEvent.prototype)
            autocapture._captureEvent(fakeEvent, lib)
            autocapture._captureEvent(fakeEvent, lib)
            autocapture._captureEvent(fakeEvent, lib)

            expect((lib.capture as sinon.SinonSpy).args.map((args) => args[0])).toEqual([
                '$autocapture',
                '$autocapture',
                '$rageclick',
                '$autocapture',
            ])
        })

        it('should capture copy', () => {
            autocapture.init(lib)

            const elTarget = document.createElement('div')
            elTarget.innerText = 'test'
            const elParent = document.createElement('div')
            elParent.appendChild(elTarget)
            const fakeEvent = makeCopyEvent({
                target: elTarget,
                clientX: 5,
                clientY: 5,
            })
            Object.setPrototypeOf(fakeEvent, ClipboardEvent.prototype)

            window!.getSelection = () => {
                return {
                    toString: () => 'test',
                } as Selection
            }

            autocapture._captureEvent(fakeEvent, lib, '$copy-autocapture')

            const spyArgs = (lib.capture as sinon.SinonSpy).args
            expect(spyArgs.length).toBe(1)
            expect(spyArgs[0][0]).toEqual('$copy-autocapture')
            expect(spyArgs[0][1]).toHaveProperty('$selected_content', 'test')
            expect(spyArgs[0][1]).toHaveProperty('$copy_type', 'copy')
        })

        it('should capture copy', () => {
            autocapture.init(lib)

            const elTarget = document.createElement('div')
            elTarget.innerText = 'test'
            const elParent = document.createElement('div')
            elParent.appendChild(elTarget)
            const fakeEvent = makeCutEvent({
                target: elTarget,
                clientX: 5,
                clientY: 5,
            })
            Object.setPrototypeOf(fakeEvent, ClipboardEvent.prototype)

            window!.getSelection = () => {
                return {
                    toString: () => 'cut this test',
                } as Selection
            }

            autocapture._captureEvent(fakeEvent, lib, '$copy-autocapture')

            const spyArgs = (lib.capture as sinon.SinonSpy).args
            expect(spyArgs.length).toBe(1)
            expect(spyArgs[0][0]).toEqual('$copy-autocapture')
            expect(spyArgs[0][1]).toHaveProperty('$selected_content', 'cut this test')
            expect(spyArgs[0][1]).toHaveProperty('$copy_type', 'cut')
        })

        it('should capture augment properties', () => {
            autocapture.init(lib)

            const elTarget = document.createElement('img')
            elTarget.setAttribute('data-ph-capture-attribute-target-augment', 'the target')
            const elParent = document.createElement('span')
            elParent.setAttribute('data-ph-capture-attribute-parent-augment', 'the parent')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('a')
            elGrandparent.setAttribute('href', 'https://test.com')
            elGrandparent.appendChild(elParent)
            const fakeEvent = makeMouseEvent({
                target: elTarget,
                clientX: 5,
                clientY: 5,
            })
            Object.setPrototypeOf(fakeEvent, MouseEvent.prototype)
            autocapture._captureEvent(fakeEvent, lib)

            const captureProperties = (lib.capture as sinon.SinonSpy).args[0][1]
            expect(captureProperties).toHaveProperty('target-augment', 'the target')
            expect(captureProperties).toHaveProperty('parent-augment', 'the parent')
        })

        it('should not capture events when config returns false, when an element matching any of the event selectors is clicked', () => {
            lib = makePostHog({
                _prepare_callback: sandbox.spy((callback) => callback),
                config: {
                    api_host: 'https://test.com',
                    token: 'testtoken',
                    mask_all_element_attributes: false,
                    autocapture: false,
                } as PostHogConfig,
                capture: sandbox.spy(),
                toolbar: {
                    maybeLoadToolbar: jest.fn(),
                } as unknown as PostHog['toolbar'],
                get_property: (property_key: string) =>
                    property_key === AUTOCAPTURE_DISABLED_SERVER_SIDE ? $autocapture_disabled_server_side : undefined,
            })

            autocapture.init(lib)
            autocapture.afterDecideResponse(decideResponse, lib)

            const eventElement1 = document.createElement('div')
            const eventElement2 = document.createElement('div')
            const propertyElement = document.createElement('div')
            eventElement1.className = 'event-element-1'
            eventElement1.style.cursor = 'pointer'
            eventElement2.className = 'event-element-2'
            eventElement2.style.cursor = 'pointer'
            propertyElement.className = 'property-element'
            propertyElement.textContent = 'my property value'
            document.body.appendChild(eventElement1)
            document.body.appendChild(eventElement2)
            document.body.appendChild(propertyElement)

            expect((lib.capture as sinon.SinonSpy).callCount).toBe(0)
            simulateClick(eventElement1)
            simulateClick(eventElement2)
            expect((lib.capture as sinon.SinonSpy).callCount).toBe(0)
            ;(lib.capture as sinon.SinonSpy).resetHistory()
        })

        it('should not capture events when config returns true but server setting is disabled', () => {
            lib = makePostHog({
                _prepare_callback: sandbox.spy((callback) => callback),
                config: {
                    api_host: 'https://test.com',
                    token: 'testtoken',
                    mask_all_element_attributes: false,
                    autocapture: true,
                } as PostHogConfig,
                capture: sandbox.spy(),
                toolbar: {
                    maybeLoadToolbar: jest.fn(),
                } as unknown as PostHog['toolbar'],
                get_property: (property_key: string) =>
                    property_key === AUTOCAPTURE_DISABLED_SERVER_SIDE ? $autocapture_disabled_server_side : undefined,
            })

            // TODO this appears to have no effect on the test 🤷
            $autocapture_disabled_server_side = true
            autocapture.init(lib)
            autocapture.afterDecideResponse(decideResponse, lib)

            const eventElement = document.createElement('a')
            document.body.appendChild(eventElement)

            expect((lib.capture as sinon.SinonSpy).callCount).toBe(0)
            simulateClick(eventElement)
            expect((lib.capture as sinon.SinonSpy).callCount).toBe(0)
            ;(lib.capture as sinon.SinonSpy).resetHistory()
        })

        it('includes necessary metadata as properties when capturing an event', () => {
            const elTarget = document.createElement('a')
            elTarget.setAttribute('href', 'https://test.com')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('div')
            elGrandparent.appendChild(elParent)
            const elGreatGrandparent = document.createElement('table')
            elGreatGrandparent.appendChild(elGrandparent)
            document.body.appendChild(elGreatGrandparent)
            const e = makeMouseEvent({
                target: elTarget,
            })
            autocapture._captureEvent(e, lib)
            expect((lib.capture as sinon.SinonSpy).calledOnce).toBe(true)
            const captureArgs = (lib.capture as sinon.SinonSpy).args[0]
            const event = captureArgs[0]
            const props = captureArgs[1]
            expect(event).toBe('$autocapture')
            expect(props['$event_type']).toBe('click')
            expect(props['$elements'][0]).toHaveProperty('attr__href', 'https://test.com')
            expect(props['$elements'][1]).toHaveProperty('tag_name', 'span')
            expect(props['$elements'][2]).toHaveProperty('tag_name', 'div')
            expect(props['$elements'][props['$elements'].length - 1]).toHaveProperty('tag_name', 'body')
        })

        it('truncate any element property value to 1024 bytes', () => {
            const elTarget = document.createElement('a')
            elTarget.setAttribute('href', 'https://test.com')
            const longString = 'prop'.repeat(400)
            elTarget.dataset.props = longString
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('div')
            elGrandparent.appendChild(elParent)
            const elGreatGrandparent = document.createElement('table')
            elGreatGrandparent.appendChild(elGrandparent)
            document.body.appendChild(elGreatGrandparent)
            const e = makeMouseEvent({
                target: elTarget,
            })
            autocapture._captureEvent(e, lib)
            expect((lib.capture as sinon.SinonSpy).calledOnce).toBe(true)
            const captureArgs = (lib.capture as sinon.SinonSpy).args[0]
            const props = captureArgs[1]
            expect(longString).toBe('prop'.repeat(400))
            expect(props['$elements'][0]).toHaveProperty('attr__data-props', 'prop'.repeat(256) + '...')
        })

        it('gets the href attribute from parent anchor tags', () => {
            const elTarget = document.createElement('img')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('a')
            elGrandparent.setAttribute('href', 'https://test.com')
            elGrandparent.appendChild(elParent)
            autocapture._captureEvent(
                makeMouseEvent({
                    target: elTarget,
                }),
                lib
            )
            expect(getCapturedProps(lib.capture)['$elements'][0]).toHaveProperty('attr__href', 'https://test.com')
        })

        it('does not capture href attribute values from password elements', () => {
            const elTarget = document.createElement('span')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('input')
            elGrandparent.appendChild(elParent)
            elGrandparent.setAttribute('type', 'password')
            autocapture._captureEvent(
                makeMouseEvent({
                    target: elTarget,
                }),
                lib
            )
            expect(getCapturedProps(lib.capture)).not.toHaveProperty('attr__href')
        })

        it('does not capture href attribute values from hidden elements', () => {
            const elTarget = document.createElement('span')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('a')
            elGrandparent.appendChild(elParent)
            elGrandparent.setAttribute('type', 'hidden')
            autocapture._captureEvent(
                makeMouseEvent({
                    target: elTarget,
                }),
                lib
            )
            expect(getCapturedProps(lib.capture)['$elements'][0]).not.toHaveProperty('attr__href')
        })

        it('does not capture href attribute values that look like credit card numbers', () => {
            const elTarget = document.createElement('span')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('a')
            elGrandparent.appendChild(elParent)
            elGrandparent.setAttribute('href', '4111111111111111')
            autocapture._captureEvent(
                makeMouseEvent({
                    target: elTarget,
                }),
                lib
            )
            expect(getCapturedProps(lib.capture)['$elements'][0]).not.toHaveProperty('attr__href')
        })

        it('does not capture href attribute values that look like social-security numbers', () => {
            const elTarget = document.createElement('span')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('a')
            elGrandparent.appendChild(elParent)
            elGrandparent.setAttribute('href', '123-58-1321')
            autocapture._captureEvent(
                makeMouseEvent({
                    target: elTarget,
                }),
                lib
            )
            expect(getCapturedProps(lib.capture)['$elements'][0]).not.toHaveProperty('attr__href')
        })

        it('correctly identifies and formats text content', () => {
            document.body.innerHTML = `
      <div>
        <button id='span1'>Some text</button>
        <div>
          <div>
            <div>
              <img src='' id='img1' alt=""/>
              <button>
                <img src='' id='img2' alt=""/>
              </button>
            </div>
          </div>
        </div>
      </div>
      <button id='span2'>
        Some super duper really long
        Text with new lines that we'll strip out
        and also we will want to make this text
        shorter since it's not likely people really care
        about text content that's super long and it
        also takes up more space and bandwidth.
        Some super duper really long
        Text with new lines that we'll strip out
        and also we will want to make this text
        shorter since it's not likely people really care
        about text content that's super long and it
        also takes up more space and bandwidth.
      </button>

      `
            const span1 = document.getElementById('span1')
            const span2 = document.getElementById('span2')
            const img2 = document.getElementById('img2')

            const e1 = makeMouseEvent({
                target: span2,
            })
            autocapture._captureEvent(e1, lib)

            const props1 = getCapturedProps(lib.capture)
            const text1 =
                "Some super duper really long Text with new lines that we'll strip out and also we will want to make this text shorter since it's not likely people really care about text content that's super long and it also takes up more space and bandwidth. Some super d"
            expect(props1['$elements'][0]).toHaveProperty('$el_text', text1)
            expect(props1['$el_text']).toEqual(text1)
            ;(lib.capture as sinon.SinonSpy).resetHistory()

            const e2 = makeMouseEvent({
                target: span1,
            })
            autocapture._captureEvent(e2, lib)
            const props2 = getCapturedProps(lib.capture)
            expect(props2['$elements'][0]).toHaveProperty('$el_text', 'Some text')
            expect(props2['$el_text']).toEqual('Some text')
            ;(lib.capture as sinon.SinonSpy).resetHistory()

            const e3 = makeMouseEvent({
                target: img2,
            })
            autocapture._captureEvent(e3, lib)
            const props3 = getCapturedProps(lib.capture)
            expect(props3['$elements'][0]).toHaveProperty('$el_text', '')
            expect(props3).not.toHaveProperty('$el_text')
        })

        it('does not capture sensitive text content', () => {
            // ^ valid credit card and social security numbers
            document.body.innerHTML = `
      <div>
        <button id='button1'> Why 123-58-1321 hello there</button>
      </div>
      <button id='button2'>
        4111111111111111
        Why hello there
      </button>
      <button id='button3'>
        Why hello there
        5105-1051-0510-5100
      </button>
      `
            const button1 = document.getElementById('button1')
            const button2 = document.getElementById('button2')
            const button3 = document.getElementById('button3')

            const e1 = makeMouseEvent({
                target: button1,
            })
            autocapture._captureEvent(e1, lib)
            const props1 = getCapturedProps(lib.capture)
            expect(props1['$elements'][0]).toHaveProperty('$el_text')
            expect(props1['$elements'][0]['$el_text']).toMatch(/Why\s+hello\s+there/)
            ;(lib.capture as sinon.SinonSpy).resetHistory()

            const e2 = makeMouseEvent({
                target: button2,
            })
            autocapture._captureEvent(e2, lib)
            const props2 = getCapturedProps(lib.capture)
            expect(props2['$elements'][0]).toHaveProperty('$el_text')
            expect(props2['$elements'][0]['$el_text']).toMatch(/Why\s+hello\s+there/)
            ;(lib.capture as sinon.SinonSpy).resetHistory()

            const e3 = makeMouseEvent({
                target: button3,
            })
            autocapture._captureEvent(e3, lib)
            const props3 = getCapturedProps(lib.capture)
            expect(props3['$elements'][0]).toHaveProperty('$el_text')
            expect(props3['$elements'][0]['$el_text']).toMatch(/Why\s+hello\s+there/)
        })

        it('should capture a submit event with form field props', () => {
            const e = {
                target: document.createElement('form'),
                type: 'submit',
            } as unknown as FormDataEvent
            autocapture._captureEvent(e, lib)
            expect((lib.capture as sinon.SinonSpy).calledOnce).toBe(true)
            const props = getCapturedProps(lib.capture)
            expect(props['$event_type']).toBe('submit')
        })

        it('should capture a click event inside a form with form field props', () => {
            const form = document.createElement('form')
            const link = document.createElement('a')
            const input = document.createElement('input')
            input.name = 'test input'
            input.value = 'test val'
            form.appendChild(link)
            form.appendChild(input)
            const e = makeMouseEvent({
                target: link,
            })
            autocapture._captureEvent(e, lib)
            expect((lib.capture as sinon.SinonSpy).calledOnce).toBe(true)
            const props = getCapturedProps(lib.capture as sinon.SinonSpy)
            expect(props['$event_type']).toBe('click')
        })

        it('should capture a click event inside a shadowroot', () => {
            const main_el = document.createElement('some-element')
            const shadowRoot = main_el.attachShadow({ mode: 'open' })
            const button = document.createElement('a')
            button.innerHTML = 'bla'
            shadowRoot.appendChild(button)
            const e = makeMouseEvent({
                target: main_el,
                composedPath: () => [button, main_el],
            })
            autocapture._captureEvent(e, lib)
            expect((lib.capture as sinon.SinonSpy).calledOnce).toBe(true)
            const props = getCapturedProps(lib.capture)
            expect(props['$event_type']).toBe('click')
        })

        it('should never capture an element with `ph-no-capture` class', () => {
            const a = document.createElement('a')
            const span = document.createElement('span')
            a.appendChild(span)
            autocapture._captureEvent(makeMouseEvent({ target: a }), lib)
            expect((lib.capture as sinon.SinonSpy).calledOnce).toBe(true)
            ;(lib.capture as sinon.SinonSpy).resetHistory()

            autocapture._captureEvent(makeMouseEvent({ target: span }), lib)
            expect((lib.capture as sinon.SinonSpy).calledOnce).toBe(true)
            ;(lib.capture as sinon.SinonSpy).resetHistory()

            a.className = 'test1 ph-no-capture test2'
            autocapture._captureEvent(makeMouseEvent({ target: a }), lib)
            expect((lib.capture as sinon.SinonSpy).callCount).toBe(0)

            autocapture._captureEvent(makeMouseEvent({ target: span }), lib)
            expect((lib.capture as sinon.SinonSpy).callCount).toBe(0)
        })

        it('does not capture any element attributes if mask_all_element_attributes is set', () => {
            const dom = `
      <button id='button1' formmethod='post'>
        Not sensitive
      </button>
      `

            const newLib = makePostHog({
                ...lib,
                config: {
                    ...lib.config,
                    mask_all_element_attributes: true,
                },
            })

            document.body.innerHTML = dom
            const button1 = document.getElementById('button1')

            const e1 = makeMouseEvent({
                target: button1,
            })
            autocapture._captureEvent(e1, newLib)

            const props1 = getCapturedProps(newLib.capture)
            expect('attr__formmethod' in props1['$elements'][0]).toEqual(false)
        })

        it('does not capture any textContent if mask_all_text is set', () => {
            const dom = `
        <a id='a1'>
          Dont capture me!
        </a>
        `

            const newLib = makePostHog({
                ...lib,
                config: {
                    ...lib.config,
                    mask_all_text: true,
                },
            })

            document.body.innerHTML = dom
            const a = document.getElementById('a1')

            const e1 = makeMouseEvent({
                target: a,
            })

            autocapture._captureEvent(e1, newLib)
            const props1 = getCapturedProps(newLib.capture)

            expect(props1['$elements'][0]).not.toHaveProperty('$el_text')
        })

        it('returns elementsChain instead of elements when set', () => {
            const elTarget = document.createElement('a')
            elTarget.setAttribute('href', 'http://test.com')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)

            const e = {
                target: elTarget,
                type: 'click',
            } as unknown as MouseEvent

            const newLib = {
                ...lib,
                elementsChainAsString: true,
            } as PostHog

            autocapture._captureEvent(e, newLib)
            const props1 = getCapturedProps(newLib.capture)

            expect(props1['$elements_chain']).toBeDefined()
            expect(props1['$elements']).toBeUndefined()
        })

        it('returns elementsChain correctly with newlines in css', () => {
            const elTarget = document.createElement('a')
            elTarget.setAttribute('href', 'http://test.com')
            elTarget.setAttribute(
                'class',
                '\ftest-class\n test-class2\ttest-class3       test-class4  \r\n test-class5'
            )
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)

            const e = {
                target: elTarget,
                type: 'click',
            } as unknown as MouseEvent

            const newLib = {
                ...lib,
                elementsChainAsString: true,
            } as PostHog

            autocapture._captureEvent(e, newLib)
            const props1 = getCapturedProps(newLib.capture)

            expect(props1['$elements_chain']).toBe(
                'a.test-class.test-class2.test-class3.test-class4.test-class5:nth-child="1"nth-of-type="1"href="http://test.com"attr__href="http://test.com"attr__class="test-class test-class2 test-class3 test-class4 test-class5";span:nth-child="1"nth-of-type="1"'
            )
        })
    })

    describe('_addDomEventHandlers', () => {
        const lib = makePostHog({
            capture: sinon.spy(),
            config: {
                mask_all_element_attributes: false,
            } as PostHogConfig,
        })

        let navigateSpy: sinon.SinonSpy

        beforeEach(() => {
            document.title = 'test page'
            autocapture._addDomEventHandlers(lib)
            navigateSpy = sinon.spy(autocapture, '_navigate')
            ;(lib.capture as sinon.SinonSpy).resetHistory()
        })

        afterAll(() => {
            navigateSpy.restore()
        })

        it('should capture click events', () => {
            const button = document.createElement('button')
            document.body.appendChild(button)
            simulateClick(button)
            simulateClick(button)
            expect(true).toBe((lib.capture as sinon.SinonSpy).calledTwice)
            const captureArgs1 = (lib.capture as sinon.SinonSpy).args[0]
            const captureArgs2 = (lib.capture as sinon.SinonSpy).args[1]
            const eventType1 = captureArgs1[1]['$event_type']
            const eventType2 = captureArgs2[1]['$event_type']
            expect(eventType1).toBe('click')
            expect(eventType2).toBe('click')
            ;(lib.capture as sinon.SinonSpy).resetHistory()
        })
    })

    describe('afterDecideResponse()', () => {
        let posthog: PostHog
        let persistence: PostHogPersistence

        beforeEach(() => {
            document.title = 'test page'
            autocapture._initializedTokens = []

            persistence = { props: {}, register: jest.fn() } as unknown as PostHogPersistence
            decideResponse = { config: { enable_collect_everything: true } } as DecideResponse

            posthog = makePostHog({
                config: {
                    api_host: 'https://test.com',
                    token: 'testtoken',
                    autocapture: true,
                } as PostHogConfig,
                capture: jest.fn(),
                get_property: (property_key: string) =>
                    property_key === AUTOCAPTURE_DISABLED_SERVER_SIDE ? $autocapture_disabled_server_side : undefined,
                persistence: persistence,
            })

            jest.spyOn(autocapture, '_addDomEventHandlers')
        })

        it('should be enabled before the decide response', () => {
            // _setIsAutocaptureEnabled is called during init
            autocapture._setIsAutocaptureEnabled(posthog)
            expect(autocapture._isAutocaptureEnabled).toBe(true)
        })

        it('should be disabled before the decide response if opt out is in persistence', () => {
            persistence.props[AUTOCAPTURE_DISABLED_SERVER_SIDE] = true

            // _setIsAutocaptureEnabled is called during init
            autocapture._setIsAutocaptureEnabled(posthog)
            expect(autocapture._isAutocaptureEnabled).toBe(false)
        })

        it('should be disabled before the decide response if client side opted out', () => {
            posthog.config.autocapture = false

            // _setIsAutocaptureEnabled is called during init
            autocapture._setIsAutocaptureEnabled(posthog)
            expect(autocapture._isAutocaptureEnabled).toBe(false)
        })

        it.each([
            // when client side is opted out, it is always off
            [false, true, false],
            [false, false, false],
            // when client side is opted in, it is only on, if the remote does not opt out
            [true, true, false],
            [true, false, true],
        ])(
            'when client side config is %p and remote opt out is %p - autocapture enabled should be %p',
            (clientSideOptIn, serverSideOptOut, expected) => {
                posthog.config.autocapture = clientSideOptIn
                decideResponse = {
                    config: { enable_collect_everything: true },
                    autocapture_opt_out: serverSideOptOut,
                } as DecideResponse
                autocapture.afterDecideResponse(decideResponse, posthog)
                expect(autocapture._isAutocaptureEnabled).toBe(expected)
            }
        )

        it('should call _addDomEventHandlders if autocapture is true', () => {
            $autocapture_disabled_server_side = false

            autocapture.afterDecideResponse(decideResponse, posthog)

            expect(autocapture._addDomEventHandlers).toHaveBeenCalled()
        })

        it('should not call _addDomEventHandlders if autocapture is disabled', () => {
            posthog.config = {
                api_host: 'https://test.com',
                token: 'testtoken',
                autocapture: false,
            } as PostHogConfig
            $autocapture_disabled_server_side = true

            autocapture.afterDecideResponse(decideResponse, posthog)

            expect(autocapture._addDomEventHandlers).not.toHaveBeenCalled()
        })

        it('should NOT call _addDomEventHandlders if the decide request fails', () => {
            decideResponse = { status: 0, error: 'Bad HTTP status: 400 Bad Request' } as unknown as DecideResponse

            autocapture.afterDecideResponse(decideResponse, posthog)

            expect(autocapture._addDomEventHandlers).not.toHaveBeenCalled()
        })

        it('should NOT call _addDomEventHandlders when enable_collect_everything is "false"', () => {
            decideResponse = { config: { enable_collect_everything: false } } as DecideResponse

            autocapture.afterDecideResponse(decideResponse, posthog)

            expect(autocapture._addDomEventHandlers).not.toHaveBeenCalled()
        })

        it('should NOT call _addDomEventHandlders when the token has already been initialized', () => {
            $autocapture_disabled_server_side = false
            autocapture.afterDecideResponse(decideResponse, posthog)
            expect(autocapture._addDomEventHandlers).toHaveBeenCalledTimes(1)

            autocapture.afterDecideResponse(decideResponse, posthog)
            expect(autocapture._addDomEventHandlers).toHaveBeenCalledTimes(1)

            posthog.config = {
                api_host: 'https://test.com',
                token: 'anotherproject',
                autocapture: true,
            } as PostHogConfig
            autocapture.afterDecideResponse(decideResponse, posthog)
            expect(autocapture._addDomEventHandlers).toHaveBeenCalledTimes(2)
        })
    })

    describe('shouldCaptureDomEvent autocapture config', () => {
        it('only capture urls which match the url regex allowlist', () => {
            const main_el = document.createElement('some-element')
            const button = document.createElement('a')
            button.innerHTML = 'bla'
            main_el.appendChild(button)
            const e = makeMouseEvent({
                target: main_el,
                composedPath: () => [button, main_el],
            })
            const autocapture_config = {
                url_allowlist: ['https://posthog.com/test/*'],
            }

            window!.location = new URL('https://posthog.com/test/captured') as unknown as Location

            expect(shouldCaptureDomEvent(button, e, autocapture_config)).toBe(true)

            window!.location = new URL('https://posthog.com/docs/not-captured') as unknown as Location
            expect(shouldCaptureDomEvent(button, e, autocapture_config)).toBe(false)
        })

        it('an empty url regex allowlist does not match any url', () => {
            const main_el = document.createElement('some-element')
            const button = document.createElement('a')
            button.innerHTML = 'bla'
            main_el.appendChild(button)
            const e = makeMouseEvent({
                target: main_el,
                composedPath: () => [button, main_el],
            })
            const autocapture_config: AutocaptureConfig = {
                url_allowlist: [],
            }

            window!.location = new URL('https://posthog.com/test/captured') as unknown as Location

            expect(shouldCaptureDomEvent(button, e, autocapture_config)).toBe(false)
        })

        it('only capture event types which match the allowlist', () => {
            const main_el = document.createElement('some-element')
            const button = document.createElement('button')
            button.innerHTML = 'bla'
            main_el.appendChild(button)
            const e = makeMouseEvent({
                target: main_el,
                composedPath: () => [button, main_el],
            })
            const autocapture_config: AutocaptureConfig = {
                dom_event_allowlist: ['click'],
            }
            expect(shouldCaptureDomEvent(button, e, autocapture_config)).toBe(true)

            const autocapture_config_change: AutocaptureConfig = {
                dom_event_allowlist: ['change'],
            }
            expect(shouldCaptureDomEvent(button, e, autocapture_config_change)).toBe(false)
        })

        it('an empty event type allowlist matches no events', () => {
            const main_el = document.createElement('some-element')
            const button = document.createElement('button')
            button.innerHTML = 'bla'
            main_el.appendChild(button)
            const e = makeMouseEvent({
                target: main_el,
                composedPath: () => [button, main_el],
            })
            const autocapture_config = {
                dom_event_allowlist: [],
            }
            expect(shouldCaptureDomEvent(button, e, autocapture_config)).toBe(false)
        })

        it('only capture elements which match the allowlist', () => {
            const main_el = document.createElement('some-element')
            const button = document.createElement('button')
            button.innerHTML = 'bla'
            main_el.appendChild(button)
            const e = makeMouseEvent({
                target: main_el,
                composedPath: () => [button, main_el],
            })
            const autocapture_config: AutocaptureConfig = {
                element_allowlist: ['button'],
            }
            expect(shouldCaptureDomEvent(button, e, autocapture_config)).toBe(true)

            const autocapture_config_change: AutocaptureConfig = {
                element_allowlist: ['a'],
            }
            expect(shouldCaptureDomEvent(button, e, autocapture_config_change)).toBe(false)
        })

        it('an empty event allowlist means we capture no elements', () => {
            const main_el = document.createElement('some-element')
            const button = document.createElement('button')
            button.innerHTML = 'bla'
            main_el.appendChild(button)
            const e = makeMouseEvent({
                target: main_el,
                composedPath: () => [button, main_el],
            })
            const autocapture_config: AutocaptureConfig = {
                element_allowlist: [],
            }
            expect(shouldCaptureDomEvent(button, e, autocapture_config)).toBe(false)
        })

        it('only capture elements which match the css allowlist', () => {
            const main_el = document.createElement('some-element')
            const button = document.createElement('button')
            button.setAttribute('data-track', 'yes')
            button.innerHTML = 'bla'
            main_el.appendChild(button)
            const e = makeMouseEvent({
                target: main_el,
                composedPath: () => [button, main_el],
            })
            const autocapture_config: AutocaptureConfig = {
                css_selector_allowlist: ['[data-track="yes"]'],
            }
            expect(shouldCaptureDomEvent(button, e, autocapture_config)).toBe(true)

            const autocapture_config_change = {
                css_selector_allowlist: ['[data-track="no"]'],
            }
            expect(shouldCaptureDomEvent(button, e, autocapture_config_change)).toBe(false)
        })

        it('an empty css selector list captures no elements', () => {
            const main_el = document.createElement('some-element')
            const button = document.createElement('button')
            button.setAttribute('data-track', 'yes')
            button.innerHTML = 'bla'
            main_el.appendChild(button)
            const e = makeMouseEvent({
                target: main_el,
                composedPath: () => [button, main_el],
            })
            const autocapture_config: AutocaptureConfig = {
                css_selector_allowlist: [],
            }
            expect(shouldCaptureDomEvent(button, e, autocapture_config)).toBe(false)
        })
    })
})
