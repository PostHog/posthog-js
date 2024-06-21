/// <reference lib="dom" />
/* eslint-disable compat/compat */

import { Autocapture } from '../autocapture'
import { shouldCaptureDomEvent } from '../autocapture-utils'
import { AUTOCAPTURE_DISABLED_SERVER_SIDE } from '../constants'
import { AutocaptureConfig, DecideResponse, PostHogConfig } from '../types'
import { PostHog } from '../posthog-core'
import { PostHogPersistence } from '../posthog-persistence'
import { window } from '../utils/globals'

// JS DOM doesn't have ClipboardEvent, so we need to mock it
// see https://github.com/jsdom/jsdom/issues/1568
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

function setWindowTextSelection(s: string): void {
    window!.getSelection = () => {
        return {
            toString: () => s,
        } as Selection
    }
}

describe('Autocapture system', () => {
    const originalWindowLocation = window!.location

    let $autocapture_disabled_server_side: boolean
    let autocapture: Autocapture
    let posthog: PostHog
    let captureMock: jest.Mock
    let persistence: PostHogPersistence

    beforeEach(() => {
        jest.spyOn(window!.console, 'log').mockImplementation()

        Object.defineProperty(window, 'location', {
            configurable: true,
            enumerable: true,
            writable: true,
            // eslint-disable-next-line compat/compat
            value: new URL('https://example.com'),
        })

        captureMock = jest.fn()
        persistence = { props: {}, register: jest.fn() } as unknown as PostHogPersistence
        posthog = makePostHog({
            config: {
                api_host: 'https://test.com',
                token: 'testtoken',
                autocapture: true,
            } as PostHogConfig,
            capture: captureMock,
            get_property: (property_key: string) =>
                property_key === AUTOCAPTURE_DISABLED_SERVER_SIDE ? $autocapture_disabled_server_side : undefined,
            persistence: persistence,
        })

        autocapture = new Autocapture(posthog)
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
            const props = autocapture['_getPropertiesFromElement'](div, false, false)
            expect(props['tag_name']).toBe('div')
        })

        it('should contain class list', () => {
            const props = autocapture['_getPropertiesFromElement'](div, false, false)
            expect(props['classes']).toEqual(['class1', 'class2', 'class3'])
        })

        it('should not collect input value', () => {
            const props = autocapture['_getPropertiesFromElement'](input, false, false)
            expect(props['value']).toBeUndefined()
        })

        it('should strip element value with class "ph-sensitive"', () => {
            const props = autocapture['_getPropertiesFromElement'](sensitiveInput, false, false)
            expect(props['value']).toBeUndefined()
        })

        it('should strip hidden element value', () => {
            const props = autocapture['_getPropertiesFromElement'](hidden, false, false)
            expect(props['value']).toBeUndefined()
        })

        it('should strip password element value', () => {
            const props = autocapture['_getPropertiesFromElement'](password, false, false)
            expect(props['value']).toBeUndefined()
        })

        it('should contain nth-of-type', () => {
            const props = autocapture['_getPropertiesFromElement'](div, false, false)
            expect(props['nth_of_type']).toBe(2)
        })

        it('should contain nth-child', () => {
            const props = autocapture['_getPropertiesFromElement'](password, false, false)
            expect(props['nth_child']).toBe(7)
        })

        it('should filter out Angular content attributes', () => {
            const angularDiv = document.createElement('div')
            angularDiv.setAttribute('_ngcontent-dpm-c448', '')
            angularDiv.setAttribute('_nghost-dpm-c448', '')
            const props = autocapture['_getPropertiesFromElement'](angularDiv, false, false)
            expect(props['_ngcontent-dpm-c448']).toBeUndefined()
            expect(props['_nghost-dpm-c448']).toBeUndefined()
        })

        it('should filter element attributes based on the ignorelist', () => {
            posthog.config.autocapture = {
                element_attribute_ignorelist: ['data-attr', 'data-attr-2'],
            }
            div.setAttribute('data-attr', 'value')
            div.setAttribute('data-attr-2', 'value')
            div.setAttribute('data-attr-3', 'value')
            const props = autocapture['_getPropertiesFromElement'](div, false, false)
            expect(props['attr__data-attr']).toBeUndefined()
            expect(props['attr__data-attr-2']).toBeUndefined()
            expect(props['attr__data-attr-3']).toBe('value')
        })

        it('an empty ignorelist does nothing', () => {
            posthog.config.autocapture = {
                element_attribute_ignorelist: [],
            }
            div.setAttribute('data-attr', 'value')
            div.setAttribute('data-attr-2', 'value')
            div.setAttribute('data-attr-3', 'value')
            const props = autocapture['_getPropertiesFromElement'](div, false, false)
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
            const props = autocapture['_getAugmentPropertiesFromElement'](div)
            expect(props['one-on-the-div']).toBe('one')
            expect(props['two-on-the-div']).toBe('two')
            expect(props['falsey-on-the-div']).toBe('0')
            expect(props['false-on-the-div']).toBe('false')
        })

        it('should collect augment from input value', () => {
            const props = autocapture['_getAugmentPropertiesFromElement'](input)
            expect(props['on-the-input']).toBe('is on the input')
        })

        it('should collect augment from input with class "ph-sensitive"', () => {
            const props = autocapture['_getAugmentPropertiesFromElement'](sensitiveInput)
            expect(props['on-the-sensitive-input']).toBeUndefined()
        })

        it('should not collect augment from the hidden element value', () => {
            const props = autocapture['_getAugmentPropertiesFromElement'](hidden)
            expect(props).toStrictEqual({})
        })

        it('should collect augment from the password element value', () => {
            const props = autocapture['_getAugmentPropertiesFromElement'](password)
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

    describe('_previousElementSibling', () => {
        it('should return the adjacent sibling', () => {
            const div = document.createElement('div')
            const sibling = document.createElement('div')
            const child = document.createElement('div')
            div.appendChild(sibling)
            div.appendChild(child)
            expect(autocapture['_previousElementSibling'](child)).toBe(sibling)
        })

        it('should return the first child and not the immediately previous sibling (text)', () => {
            const div = document.createElement('div')
            const sibling = document.createElement('div')
            const child = document.createElement('div')
            div.appendChild(sibling)
            div.appendChild(document.createTextNode('some text'))
            div.appendChild(child)
            expect(autocapture['_previousElementSibling'](child)).toBe(sibling)
        })

        it('should return null when the previous sibling is a text node', () => {
            const div = document.createElement('div')
            const child = document.createElement('div')
            div.appendChild(document.createTextNode('some text'))
            div.appendChild(child)
            expect(autocapture['_previousElementSibling'](child)).toBeNull()
        })
    })

    describe('_getDefaultProperties', () => {
        it('should return the default properties', () => {
            expect(autocapture['_getDefaultProperties']('test')).toEqual({
                $event_type: 'test',
                $ce_version: 1,
            })
        })
    })

    describe('_captureEvent', () => {
        beforeEach(() => {
            posthog.config.rageclick = true
            // Trigger proper enabling
            autocapture.afterDecideResponse({} as DecideResponse)
        })

        it('should capture rageclick', () => {
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
            autocapture['_captureEvent'](fakeEvent)
            autocapture['_captureEvent'](fakeEvent)
            autocapture['_captureEvent'](fakeEvent)

            expect(captureMock).toHaveBeenCalledTimes(4)
            expect(captureMock.mock.calls.map((args) => args[0])).toEqual([
                '$autocapture',
                '$autocapture',
                '$rageclick',
                '$autocapture',
            ])
        })

        describe('clipboard autocapture', () => {
            let elTarget: HTMLDivElement

            beforeEach(() => {
                elTarget = document.createElement('div')
                elTarget.innerText = 'test'
                const elParent = document.createElement('div')
                elParent.appendChild(elTarget)
            })

            it('should capture copy', () => {
                const fakeEvent = makeCopyEvent({
                    target: elTarget,
                    clientX: 5,
                    clientY: 5,
                })

                setWindowTextSelection('copy this test')

                autocapture['_captureEvent'](fakeEvent, '$copy_autocapture')

                expect(captureMock).toHaveBeenCalledTimes(1)
                expect(captureMock.mock.calls[0][0]).toEqual('$copy_autocapture')
                expect(captureMock.mock.calls[0][1]).toHaveProperty('$selected_content', 'copy this test')
                expect(captureMock.mock.calls[0][1]).toHaveProperty('$copy_type', 'copy')
            })

            it('should capture cut', () => {
                const fakeEvent = makeCutEvent({
                    target: elTarget,
                    clientX: 5,
                    clientY: 5,
                })

                setWindowTextSelection('cut this test')

                autocapture['_captureEvent'](fakeEvent, '$copy_autocapture')

                const spyArgs = captureMock.mock.calls
                expect(spyArgs.length).toBe(1)
                expect(spyArgs[0][0]).toEqual('$copy_autocapture')
                expect(spyArgs[0][1]).toHaveProperty('$selected_content', 'cut this test')
                expect(spyArgs[0][1]).toHaveProperty('$copy_type', 'cut')
            })

            it('ignores empty selection', () => {
                const fakeEvent = makeCopyEvent({
                    target: elTarget,
                    clientX: 5,
                    clientY: 5,
                })

                setWindowTextSelection('')

                autocapture['_captureEvent'](fakeEvent, '$copy_autocapture')

                const spyArgs = captureMock.mock.calls
                expect(spyArgs.length).toBe(0)
            })

            it('runs selection through the safe text before capture', () => {
                const fakeEvent = makeCopyEvent({
                    target: elTarget,
                    clientX: 5,
                    clientY: 5,
                })

                // oh no, a social security number!
                setWindowTextSelection('123-45-6789')

                autocapture['_captureEvent'](fakeEvent, '$copy_autocapture')

                const spyArgs = captureMock.mock.calls
                expect(spyArgs.length).toBe(0)
            })
        })

        it('should capture augment properties', () => {
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
            autocapture['_captureEvent'](fakeEvent)

            const captureProperties = captureMock.mock.calls[0][1]
            expect(captureProperties).toHaveProperty('target-augment', 'the target')
            expect(captureProperties).toHaveProperty('parent-augment', 'the parent')
        })

        it('should not capture events when config returns false, when an element matching any of the event selectors is clicked', () => {
            posthog.config.autocapture = false
            autocapture.afterDecideResponse({} as DecideResponse)

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

            expect(captureMock).toHaveBeenCalledTimes(0)
            simulateClick(eventElement1)
            simulateClick(eventElement2)
            expect(captureMock).toHaveBeenCalledTimes(0)
        })

        it('should not capture events when config returns true but server setting is disabled', () => {
            autocapture.afterDecideResponse({
                autocapture_opt_out: true,
            } as DecideResponse)

            const eventElement = document.createElement('a')
            document.body.appendChild(eventElement)

            expect(captureMock).toHaveBeenCalledTimes(0)
            simulateClick(eventElement)
            expect(captureMock).toHaveBeenCalledTimes(0)
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
            autocapture['_captureEvent'](e)
            expect(captureMock).toHaveBeenCalledTimes(1)
            const captureArgs = captureMock.mock.calls[0]
            const event = captureArgs[0]
            const props = captureArgs[1]
            expect(event).toBe('$autocapture')
            expect(props['$event_type']).toBe('click')
            expect(props['$elements'][0]).toHaveProperty('attr__href', 'https://test.com')
            expect(props['$elements'][1]).toHaveProperty('tag_name', 'span')
            expect(props['$elements'][2]).toHaveProperty('tag_name', 'div')
            expect(props['$elements'][props['$elements'].length - 1]).toHaveProperty('tag_name', 'body')
            expect(props['$external_click_url']).toEqual('https://test.com')
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
            autocapture['_captureEvent'](e)
            expect(captureMock).toHaveBeenCalledTimes(1)
            const captureArgs = captureMock.mock.calls[0]
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
            autocapture['_captureEvent'](
                makeMouseEvent({
                    target: elTarget,
                })
            )
            const props = captureMock.mock.calls[0][1]
            expect(props['$elements'][0]).toHaveProperty('attr__href', 'https://test.com')
            expect(props['$external_click_url']).toEqual('https://test.com')
        })

        it('does not include $click_external_href for same site', () => {
            window!.location = new URL('https://www.example.com/location') as unknown as Location
            const elTarget = document.createElement('img')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('a')
            elGrandparent.setAttribute('href', 'https://www.example.com/link')
            elGrandparent.appendChild(elParent)
            autocapture['_captureEvent'](
                makeMouseEvent({
                    target: elTarget,
                })
            )
            const props = captureMock.mock.calls[0][1]
            expect(props['$elements'][0]).toHaveProperty('attr__href', 'https://www.example.com/link')
            expect(props['$external_click_url']).toBeUndefined()
        })

        it('does not capture href attribute values from password elements', () => {
            const elTarget = document.createElement('span')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('input')
            elGrandparent.appendChild(elParent)
            elGrandparent.setAttribute('type', 'password')
            autocapture['_captureEvent'](
                makeMouseEvent({
                    target: elTarget,
                })
            )
            expect(captureMock.mock.calls[0][1]).not.toHaveProperty('attr__href')
        })

        it('does not capture href attribute values from hidden elements', () => {
            const elTarget = document.createElement('span')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('a')
            elGrandparent.appendChild(elParent)
            elGrandparent.setAttribute('type', 'hidden')
            autocapture['_captureEvent'](
                makeMouseEvent({
                    target: elTarget,
                })
            )
            expect(captureMock.mock.calls[0][1]['$elements'][0]).not.toHaveProperty('attr__href')
        })

        it('does not capture href attribute values that look like credit card numbers', () => {
            const elTarget = document.createElement('span')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('a')
            elGrandparent.appendChild(elParent)
            elGrandparent.setAttribute('href', '4111111111111111')
            autocapture['_captureEvent'](
                makeMouseEvent({
                    target: elTarget,
                })
            )
            expect(captureMock.mock.calls[0][1]['$elements'][0]).not.toHaveProperty('attr__href')
        })

        it('does not capture href attribute values that look like social-security numbers', () => {
            const elTarget = document.createElement('span')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('a')
            elGrandparent.appendChild(elParent)
            elGrandparent.setAttribute('href', '123-58-1321')
            autocapture['_captureEvent'](
                makeMouseEvent({
                    target: elTarget,
                })
            )
            expect(captureMock.mock.calls[0][1]['$elements'][0]).not.toHaveProperty('attr__href')
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
            captureMock.mockClear()
            autocapture['_captureEvent'](e1)

            const props1 = captureMock.mock.calls[0][1]
            const text1 =
                "Some super duper really long Text with new lines that we'll strip out and also we will want to make this text shorter since it's not likely people really care about text content that's super long and it also takes up more space and bandwidth. Some super d"
            expect(props1['$elements'][0]).toHaveProperty('$el_text', text1)
            expect(props1['$el_text']).toEqual(text1)

            const e2 = makeMouseEvent({
                target: span1,
            })
            captureMock.mockClear()
            autocapture['_captureEvent'](e2)
            const props2 = captureMock.mock.calls[0][1]
            expect(props2['$elements'][0]).toHaveProperty('$el_text', 'Some text')
            expect(props2['$el_text']).toEqual('Some text')

            const e3 = makeMouseEvent({
                target: img2,
            })
            captureMock.mockClear()
            autocapture['_captureEvent'](e3)
            const props3 = captureMock.mock.calls[0][1]
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
            autocapture['_captureEvent'](e1)
            const props1 = captureMock.mock.calls[0][1]
            expect(props1['$elements'][0]).toHaveProperty('$el_text')
            expect(props1['$elements'][0]['$el_text']).toMatch(/Why\s+hello\s+there/)

            const e2 = makeMouseEvent({
                target: button2,
            })
            autocapture['_captureEvent'](e2)
            const props2 = captureMock.mock.calls[0][1]
            expect(props2['$elements'][0]).toHaveProperty('$el_text')
            expect(props2['$elements'][0]['$el_text']).toMatch(/Why\s+hello\s+there/)

            const e3 = makeMouseEvent({
                target: button3,
            })
            autocapture['_captureEvent'](e3)
            const props3 = captureMock.mock.calls[0][1]
            expect(props3['$elements'][0]).toHaveProperty('$el_text')
            expect(props3['$elements'][0]['$el_text']).toMatch(/Why\s+hello\s+there/)
        })

        it('should capture a submit event with form field props', () => {
            const e = {
                target: document.createElement('form'),
                type: 'submit',
            } as unknown as FormDataEvent
            autocapture['_captureEvent'](e)
            expect(captureMock).toHaveBeenCalledTimes(1)
            const props = captureMock.mock.calls[0][1]
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
            autocapture['_captureEvent'](e)
            expect(captureMock).toHaveBeenCalledTimes(1)
            const props = captureMock.mock.calls[0][1]
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
            autocapture['_captureEvent'](e)
            expect(captureMock).toHaveBeenCalledTimes(1)
            const props = captureMock.mock.calls[0][1]
            expect(props['$event_type']).toBe('click')
        })

        it('should never capture an element with `ph-no-capture` class', () => {
            const a = document.createElement('a')
            const span = document.createElement('span')
            a.appendChild(span)
            autocapture['_captureEvent'](makeMouseEvent({ target: a }))
            expect(captureMock).toHaveBeenCalledTimes(1)

            autocapture['_captureEvent'](makeMouseEvent({ target: span }))
            expect(captureMock).toHaveBeenCalledTimes(2)

            captureMock.mockClear()
            a.className = 'test1 ph-no-capture test2'
            autocapture['_captureEvent'](makeMouseEvent({ target: a }))
            expect(captureMock).toHaveBeenCalledTimes(0)

            autocapture['_captureEvent'](makeMouseEvent({ target: span }))
            expect(captureMock).toHaveBeenCalledTimes(0)
        })

        it('does not capture any element attributes if mask_all_element_attributes is set', () => {
            const dom = `
      <button id='button1' formmethod='post'>
        Not sensitive
      </button>
      `

            posthog.config.mask_all_element_attributes = true

            document.body.innerHTML = dom
            const button1 = document.getElementById('button1')

            const e1 = makeMouseEvent({
                target: button1,
            })
            autocapture['_captureEvent'](e1)

            const props1 = captureMock.mock.calls[0][1]
            expect('attr__formmethod' in props1['$elements'][0]).toEqual(false)
        })

        it('does not capture any textContent if mask_all_text is set', () => {
            const dom = `
        <a id='a1'>
          Dont capture me!
        </a>
        `
            posthog.config.mask_all_text = true

            document.body.innerHTML = dom
            const a = document.getElementById('a1')
            const e1 = makeMouseEvent({
                target: a,
            })

            autocapture['_captureEvent'](e1)
            const props1 = captureMock.mock.calls[0][1]

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

            autocapture.afterDecideResponse({
                elementsChainAsString: true,
            } as DecideResponse)

            autocapture['_captureEvent'](e)
            const props1 = captureMock.mock.calls[0][1]

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

            autocapture['_elementsChainAsString'] = true
            autocapture['_captureEvent'](e)
            const props1 = captureMock.mock.calls[0][1]

            expect(props1['$elements_chain']).toBe(
                'a.test-class.test-class2.test-class3.test-class4.test-class5:nth-child="1"nth-of-type="1"href="http://test.com"attr__href="http://test.com"attr__class="test-class test-class2 test-class3 test-class4 test-class5";span:nth-child="1"nth-of-type="1"'
            )
        })

        it('correctly captures text when multiple button children elements', () => {
            const parent = document.createElement('div')
            const button = document.createElement('button')
            const image = document.createElement('img')
            const textOne = document.createElement('span')
            textOne.textContent = 'the button text'
            const textTwo = document.createElement('span')
            textTwo.textContent = `
            with more
            <!-- -->
            info
            `
            parent.appendChild(button)
            button.appendChild(image)
            button.appendChild(textOne)
            button.appendChild(textTwo)

            const e = {
                target: image,
                type: 'click',
            } as unknown as MouseEvent

            autocapture['_captureEvent'](e)

            expect(captureMock).toHaveBeenCalledTimes(1)
            const props = captureMock.mock.calls[0][1]
            const capturedButton = props['$elements'][1]
            expect(capturedButton['tag_name']).toBe('button')
            expect(capturedButton['$el_text']).toBe('the button text with more <!-- --> info')
        })
    })

    describe('_addDomEventHandlers', () => {
        beforeEach(() => {
            document.title = 'test page'
            posthog.config.mask_all_element_attributes = false
            autocapture.afterDecideResponse({} as DecideResponse)
        })

        it('should capture click events', () => {
            const button = document.createElement('button')
            document.body.appendChild(button)
            simulateClick(button)
            simulateClick(button)
            expect(captureMock).toHaveBeenCalledTimes(2)
            expect(captureMock.mock.calls[0][0]).toBe('$autocapture')
            expect(captureMock.mock.calls[0][1]['$event_type']).toBe('click')
            expect(captureMock.mock.calls[1][0]).toBe('$autocapture')
            expect(captureMock.mock.calls[1][1]['$event_type']).toBe('click')
        })
    })

    describe('afterDecideResponse()', () => {
        beforeEach(() => {
            document.title = 'test page'

            jest.spyOn(autocapture, '_addDomEventHandlers')
        })

        it('should not be enabled before the decide response', () => {
            expect(autocapture.isEnabled).toBe(false)
        })

        it('should be enabled before the decide response if decide is disabled', () => {
            posthog.config.advanced_disable_decide = true
            expect(autocapture.isEnabled).toBe(true)
        })

        it('should be disabled before the decide response if opt out is in persistence', () => {
            persistence.props[AUTOCAPTURE_DISABLED_SERVER_SIDE] = true
            expect(autocapture.isEnabled).toBe(false)
        })

        it('should be disabled before the decide response if client side opted out', () => {
            posthog.config.autocapture = false
            expect(autocapture.isEnabled).toBe(false)
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
                autocapture.afterDecideResponse({
                    autocapture_opt_out: serverSideOptOut,
                } as DecideResponse)
                expect(autocapture.isEnabled).toBe(expected)
            }
        )

        it('should call _addDomEventHandlders if autocapture is true', () => {
            $autocapture_disabled_server_side = false
            autocapture.afterDecideResponse({} as DecideResponse)
            expect(autocapture['_addDomEventHandlers']).toHaveBeenCalled()
        })

        it('should not call _addDomEventHandlders if autocapture is disabled', () => {
            expect(autocapture['_addDomEventHandlers']).not.toHaveBeenCalled()
            posthog.config = {
                api_host: 'https://test.com',
                token: 'testtoken',
                autocapture: false,
            } as PostHogConfig
            $autocapture_disabled_server_side = true

            autocapture.afterDecideResponse({} as DecideResponse)

            expect(autocapture['_addDomEventHandlers']).not.toHaveBeenCalled()
        })

        it('should NOT call _addDomEventHandlders when the token has already been initialized', () => {
            $autocapture_disabled_server_side = false
            autocapture.afterDecideResponse({} as DecideResponse)
            expect(autocapture['_addDomEventHandlers']).toHaveBeenCalledTimes(1)

            autocapture.afterDecideResponse({} as DecideResponse)
            expect(autocapture['_addDomEventHandlers']).toHaveBeenCalledTimes(1)
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
