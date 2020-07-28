import sinon from 'sinon'

import { autocapture } from '../autocapture'

import { _ } from '../utils'

const triggerMouseEvent = function (node, eventType) {
    node.dispatchEvent(
        new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
        })
    )
}

const simulateClick = function (el) {
    triggerMouseEvent(el, 'click')
}

describe('Autocapture system', () => {
    let testContext = {}

    afterEach(() => {
        testContext = {}
        document.getElementsByTagName('html')[0].innerHTML = ''
    })

    describe('_getPropertiesFromElement', () => {
        let div, div2, input, sensitiveInput, hidden, password
        beforeEach(() => {
            div = document.createElement('div')
            div.className = 'class1 class2 class3'
            div.innerHTML = 'my <span>sweet <i>inner</i></span> text'

            input = document.createElement('input')
            input.value = 'test val'

            sensitiveInput = document.createElement('input')
            sensitiveInput.value = 'test val'
            sensitiveInput.className = 'ph-sensitive'

            hidden = document.createElement('div')
            hidden.setAttribute('type', 'hidden')
            hidden.value = 'hidden val'

            password = document.createElement('div')
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
            const props = autocapture._getPropertiesFromElement(div)
            expect(props['tag_name']).toBe('div')
        })

        it('should contain class list', () => {
            const props = autocapture._getPropertiesFromElement(div)
            expect(props['classes']).toEqual(['class1', 'class2', 'class3'])
        })

        it('should not collect input value', () => {
            const props = autocapture._getPropertiesFromElement(input)
            expect(props['value']).toBeUndefined()
        })

        it('should strip element value with class "ph-sensitive"', () => {
            const props = autocapture._getPropertiesFromElement(sensitiveInput)
            expect(props['value']).toBeUndefined()
        })

        it('should strip hidden element value', () => {
            const props = autocapture._getPropertiesFromElement(hidden)
            expect(props['value']).toBeUndefined()
        })

        it('should strip password element value', () => {
            const props = autocapture._getPropertiesFromElement(password)
            expect(props['value']).toBeUndefined()
        })

        it('should contain nth-of-type', () => {
            const props = autocapture._getPropertiesFromElement(div)
            expect(props['nth_of_type']).toBe(2)
        })

        it('should contain nth-child', () => {
            const props = autocapture._getPropertiesFromElement(password)
            expect(props['nth_child']).toBe(7)
        })
    })

    describe('isBrowserSupported', () => {
        let orig
        beforeEach(() => {
            orig = document.querySelectorAll
        })

        afterEach(() => {
            document.querySelectorAll = orig
        })

        it('should return true if document.querySelectorAll is a function', () => {
            document.querySelectorAll = function () {}
            expect(autocapture.isBrowserSupported()).toBe(true)
        })

        it('should return false if document.querySelectorAll is not a function', () => {
            document.querySelectorAll = undefined
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

    describe('_loadScript', () => {
        it('should insert the given script before the one already on the page', () => {
            document.body.appendChild(document.createElement('script'))
            const callback = (_) => _
            autocapture._loadScript('https://fake_url', callback)
            const scripts = document.getElementsByTagName('script')
            const new_script = scripts[0]

            expect(scripts.length).toBe(2)
            expect(new_script.type).toBe('text/javascript')
            expect(new_script.src).toBe('https://fake_url/')
            expect(new_script.onload).toBe(callback)
        })

        it("should add the script to the page when there aren't any preexisting scripts on the page", () => {
            const callback = (_) => _
            autocapture._loadScript('https://fake_url', callback)
            const scripts = document.getElementsByTagName('script')
            const new_script = scripts[0]

            expect(scripts.length).toBe(1)
            expect(new_script.type).toBe('text/javascript')
            expect(new_script.src).toBe('https://fake_url/')
            expect(new_script.onload).toBe(callback)
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
        let capturedElem
        let capturedElemChild
        let uncapturedElem
        let sensitiveInput
        let sensitiveDiv
        let prop1
        let prop2
        let prop3

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
        let lib, sandbox

        const getCapturedProps = function (captureSpy) {
            const captureArgs = captureSpy.args[0]
            const event = captureArgs[0]
            const props = captureArgs[1]
            return props
        }

        beforeEach(() => {
            sandbox = sinon.createSandbox()
            lib = {
                _ceElementTextProperties: [],
                get_distinct_id() {
                    return 'distinctid'
                },
                capture: sandbox.spy(),
            }
        })

        afterEach(() => {
            sandbox.restore()
        })

        it('should add the custom property when an element matching any of the event selectors is clicked', () => {
            lib = {
                _send_request: sandbox.spy((url, params, options, callback) =>
                    callback({
                        config: {
                            enable_collect_everything: true,
                        },
                        custom_properties: [
                            {
                                event_selectors: ['.event-element-1', '.event-element-2'],
                                css_selector: '.property-element',
                                name: 'my property name',
                            },
                        ],
                    })
                ),
                _prepare_callback: sandbox.spy((callback) => callback),
                get_config: sandbox.spy(function (key) {
                    switch (key) {
                        case 'api_host':
                            return 'https://test.com'
                        case 'token':
                            return 'testtoken'
                    }
                }),
                token: 'testtoken',
                capture: sandbox.spy(),
                get_distinct_id() {
                    return 'distinctid'
                },
            }
            autocapture.init(lib)

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

            expect(lib.capture.callCount).toBe(0)
            simulateClick(eventElement1)
            simulateClick(eventElement2)
            expect(lib.capture.callCount).toBe(2)
            const captureArgs1 = lib.capture.args[0]
            const captureArgs2 = lib.capture.args[1]
            const eventType1 = captureArgs1[1]['my property name']
            const eventType2 = captureArgs2[1]['my property name']
            expect(eventType1).toBe('my property value')
            expect(eventType2).toBe('my property value')
            lib.capture.resetHistory()
        })

        it('includes necessary metadata as properties when capturing an event', () => {
            const elTarget = document.createElement('a')
            elTarget.setAttribute('href', 'http://test.com')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('div')
            elGrandparent.appendChild(elParent)
            const elGreatGrandparent = document.createElement('table')
            elGreatGrandparent.appendChild(elGrandparent)
            document.body.appendChild(elGreatGrandparent)
            const e = {
                target: elTarget,
                type: 'click',
            }
            autocapture._captureEvent(e, lib)
            expect(lib.capture.calledOnce).toBe(true)
            const captureArgs = lib.capture.args[0]
            const event = captureArgs[0]
            const props = captureArgs[1]
            expect(event).toBe('$autocapture')
            expect(props['$event_type']).toBe('click')
            expect(props['$elements'][0]).toHaveProperty('attr__href', 'http://test.com')
            expect(props['$elements'][1]).toHaveProperty('tag_name', 'span')
            expect(props['$elements'][2]).toHaveProperty('tag_name', 'div')
            expect(props['$elements'][props['$elements'].length - 1]).toHaveProperty('tag_name', 'body')
        })

        it('gets the href attribute from parent anchor tags', () => {
            const elTarget = document.createElement('img')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('a')
            elGrandparent.setAttribute('href', 'http://test.com')
            elGrandparent.appendChild(elParent)
            autocapture._captureEvent(
                {
                    target: elTarget,
                    type: 'click',
                },
                lib
            )
            expect(getCapturedProps(lib.capture)['$elements'][0]).toHaveProperty('attr__href', 'http://test.com')
        })

        it('does not capture href attribute values from password elements', () => {
            const elTarget = document.createElement('span')
            const elParent = document.createElement('span')
            elParent.appendChild(elTarget)
            const elGrandparent = document.createElement('input')
            elGrandparent.appendChild(elParent)
            elGrandparent.setAttribute('type', 'password')
            autocapture._captureEvent(
                {
                    target: elTarget,
                    type: 'click',
                },
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
                {
                    target: elTarget,
                    type: 'click',
                },
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
                {
                    target: elTarget,
                    type: 'click',
                },
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
                {
                    target: elTarget,
                    type: 'click',
                },
                lib
            )
            expect(getCapturedProps(lib.capture)['$elements'][0]).not.toHaveProperty('attr__href')
        })

        it('correctly identifies and formats text content', () => {
            const dom = `
      <div>
        <button id='span1'>Some text</button>
        <div>
          <div>
            <div>
              <img src='' id='img1'/>
              <button>
                <img src='' id='img2'/>
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
            document.body.innerHTML = dom
            const span1 = document.getElementById('span1')
            const span2 = document.getElementById('span2')
            const img1 = document.getElementById('img1')
            const img2 = document.getElementById('img2')

            const e1 = {
                target: span2,
                type: 'click',
            }
            autocapture._captureEvent(e1, lib)

            const props1 = getCapturedProps(lib.capture)
            expect(props1['$elements'][0]).toHaveProperty(
                '$el_text',
                "Some super duper really long Text with new lines that we'll strip out and also we will want to make this text shorter since it's not likely people really care about text content that's super long and it also takes up more space and bandwidth. Some super d"
            )
            lib.capture.resetHistory()

            const e2 = {
                target: span1,
                type: 'click',
            }
            autocapture._captureEvent(e2, lib)
            const props2 = getCapturedProps(lib.capture)
            expect(props2['$elements'][0]).toHaveProperty('$el_text', 'Some text')
            lib.capture.resetHistory()

            const e3 = {
                target: img2,
                type: 'click',
            }
            autocapture._captureEvent(e3, lib)
            const props3 = getCapturedProps(lib.capture)
            expect(props3['$elements'][0]).toHaveProperty('$el_text', '')
        })

        it('does not capture sensitive text content', () => {
            const dom = `
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
      ` // ^ valid credit card and social security numbers

            document.body.innerHTML = dom
            const button1 = document.getElementById('button1')
            const button2 = document.getElementById('button2')
            const button3 = document.getElementById('button3')

            const e1 = {
                target: button1,
                type: 'click',
            }
            autocapture._captureEvent(e1, lib)
            const props1 = getCapturedProps(lib.capture)
            expect(props1['$elements'][0]).toHaveProperty('$el_text')
            expect(props1['$elements'][0]['$el_text']).toMatch(/Why\s+hello\s+there/)
            lib.capture.resetHistory()

            const e2 = {
                target: button2,
                type: 'click',
            }
            autocapture._captureEvent(e2, lib)
            const props2 = getCapturedProps(lib.capture)
            expect(props2['$elements'][0]).toHaveProperty('$el_text')
            expect(props2['$elements'][0]['$el_text']).toMatch(/Why\s+hello\s+there/)
            lib.capture.resetHistory()

            const e3 = {
                target: button3,
                type: 'click',
            }
            autocapture._captureEvent(e3, lib)
            const props3 = getCapturedProps(lib.capture)
            expect(props3['$elements'][0]).toHaveProperty('$el_text')
            expect(props3['$elements'][0]['$el_text']).toMatch(/Why\s+hello\s+there/)
        })

        it('should capture a submit event with form field props', () => {
            const e = {
                target: document.createElement('form'),
                type: 'submit',
            }
            autocapture._captureEvent(e, lib)
            expect(lib.capture.calledOnce).toBe(true)
            const props = getCapturedProps(lib.capture)
            expect(props['$event_type']).toBe('submit')
        })

        it('should capture a click event inside a form with form field props', () => {
            var form = document.createElement('form')
            var link = document.createElement('a')
            var input = document.createElement('input')
            input.name = 'test input'
            input.value = 'test val'
            form.appendChild(link)
            form.appendChild(input)
            const e = {
                target: link,
                type: 'click',
            }
            autocapture._captureEvent(e, lib)
            expect(lib.capture.calledOnce).toBe(true)
            const props = getCapturedProps(lib.capture)
            expect(props['$event_type']).toBe('click')
        })

        it('should never capture an element with `ph-no-capture` class', () => {
            const a = document.createElement('a')
            const span = document.createElement('span')
            a.appendChild(span)
            autocapture._captureEvent({ target: a, type: 'click' }, lib)
            expect(lib.capture.calledOnce).toBe(true)
            lib.capture.resetHistory()

            autocapture._captureEvent({ target: span, type: 'click' }, lib)
            expect(lib.capture.calledOnce).toBe(true)
            lib.capture.resetHistory()

            a.className = 'test1 ph-no-capture test2'
            autocapture._captureEvent({ target: a, type: 'click' }, lib)
            expect(lib.capture.callCount).toBe(0)

            autocapture._captureEvent({ target: span, type: 'click' }, lib)
            expect(lib.capture.callCount).toBe(0)
        })
    })

    describe('_addDomEventHandlers', () => {
        const lib = {
            capture: sinon.spy(),
            get_distinct_id() {
                return 'distinctid'
            },
        }

        let navigateSpy

        beforeEach(() => {
            document.title = 'test page'
            autocapture._addDomEventHandlers(lib)
            navigateSpy = sinon.spy(autocapture, '_navigate')
            lib.capture.resetHistory()
        })

        afterAll(() => {
            navigateSpy.restore()
        })

        it('should capture click events', () => {
            const button = document.createElement('button')
            document.body.appendChild(button)
            simulateClick(button)
            simulateClick(button)
            expect(true).toBe(lib.capture.calledTwice)
            const captureArgs1 = lib.capture.args[0]
            const captureArgs2 = lib.capture.args[1]
            const eventType1 = captureArgs1[1]['$event_type']
            const eventType2 = captureArgs2[1]['$event_type']
            expect(eventType1).toBe('click')
            expect(eventType2).toBe('click')
            lib.capture.resetHistory()
        })
    })

    describe('init', () => {
        let lib, sandbox, _maybeLoadEditorStub

        beforeEach(() => {
            document.title = 'test page'
            sandbox = sinon.createSandbox()
            sandbox.spy(autocapture, '_addDomEventHandlers')
            autocapture._initializedTokens = []
            _maybeLoadEditorStub = sandbox.stub(autocapture, '_maybeLoadEditor').returns(false)
            lib = {
                _prepare_callback: sandbox.spy((callback) => callback),
                _send_request: sandbox.spy((url, params, options, callback) =>
                    callback({ config: { enable_collect_everything: true } })
                ),
                get_config: sandbox.spy(function (key) {
                    switch (key) {
                        case 'api_host':
                            return 'https://test.com'
                        case 'token':
                            return 'testtoken'
                    }
                }),
                token: 'testtoken',
                capture: sandbox.spy(),
                get_distinct_id() {
                    return 'distinctid'
                },
            }
        })

        afterEach(() => {
            sandbox.restore()
        })

        it('should call _addDomEventHandlders', () => {
            autocapture.init(lib)
            expect(autocapture._addDomEventHandlers.calledOnce).toBe(true)
        })

        it('should NOT call _addDomEventHandlders if the decide request fails', () => {
            lib._send_request = sandbox.spy((url, params, options, callback) =>
                callback({ status: 0, error: 'Bad HTTP status: 400 Bad Request' })
            )
            autocapture.init(lib)
            expect(autocapture._addDomEventHandlers.called).toBe(false)
        })

        it('should NOT call _addDomEventHandlders when loading editor', () => {
            _maybeLoadEditorStub.returns(true)
            autocapture.init(lib)
            expect(autocapture._addDomEventHandlers.calledOnce).toBe(false)
        })

        it('should NOT call _addDomEventHandlders when enable_collect_everything is "false"', () => {
            lib._send_request = sandbox.spy((url, params, options, callback) =>
                callback({ config: { enable_collect_everything: false } })
            )
            autocapture.init(lib)
            expect(autocapture._addDomEventHandlers.calledOnce).toBe(false)
        })

        it('should NOT call _addDomEventHandlders when the token has already been initialized', () => {
            var lib2 = Object.assign({}, lib)
            var lib3 = Object.assign({ token: 'anotherproject' }, lib)
            lib3.get_config = sandbox.spy(function (key) {
                switch (key) {
                    case 'api_host':
                        return 'https://test.com'
                    case 'token':
                        return 'anotherproject'
                }
            })
            autocapture.init(lib)
            expect(autocapture._addDomEventHandlers.callCount).toBe(1)
            autocapture.init(lib2)
            expect(autocapture._addDomEventHandlers.callCount).toBe(1)
            autocapture.init(lib3)
            expect(autocapture._addDomEventHandlers.callCount).toBe(2)
        })

        it('should call instance._send_request', () => {
            autocapture.init(lib)
            expect(lib._send_request.calledOnce).toBe(true)
            expect(lib._send_request.firstCall.args[0]).toBe('https://test.com/decide/')
            expect(lib._send_request.firstCall.args[1]).toEqual({
                data: _.base64Encode(
                    _.JSONEncode({
                        token: 'testtoken',
                        distinct_id: 'distinctid',
                    })
                ),
            })
            expect(lib._send_request.firstCall.args[2]).toEqual({ method: 'POST' })
            expect(typeof lib._send_request.firstCall.args[3]).toBe('function')
        })

        it('should check whether to load the editor', () => {
            autocapture.init(lib)
            expect(autocapture._maybeLoadEditor.calledOnce).toBe(true)
            expect(autocapture._maybeLoadEditor.calledWith(lib)).toBe(true)
        })
    })

    describe('_maybeLoadEditor', () => {
        let hash,
            editorParams,
            sandbox,
            lib = {}

        beforeEach(() => {
            window.localStorage.clear()

            testContext.clock = sinon.useFakeTimers()

            sandbox = sinon.createSandbox()
            sandbox.stub(autocapture, '_loadEditor')
            lib.get_config = sandbox.stub()
            lib.get_config.withArgs('token').returns('test_token')
            lib.get_config.withArgs('app_host').returns('test_app_host')

            const userFlags = {
                flag_1: 0,
                flag_2: 1,
            }
            editorParams = {
                action: 'mpeditor',
                desiredHash: '#myhash',
                projectId: 3,
                projectOwnerId: 722725,
                readOnly: false,
                token: 'test_token',
                userFlags,
                userId: 12345,
            }
            const hashParams = {
                access_token: 'test_access_token',
                state: encodeURIComponent(JSON.stringify(editorParams)),
                expires_in: 3600,
            }

            hash = Object.keys(hashParams)
                .map((k) => `${k}=${hashParams[k]}`)
                .join('&')
        })

        afterEach(() => {
            sandbox.restore()
            testContext.clock.restore()
        })

        it('should initialize the visual editor when the hash state contains action "mpeditor"', () => {
            window.location.hash = `#${hash}`
            autocapture._maybeLoadEditor(lib)
            expect(autocapture._loadEditor.calledOnce).toBe(true)
            expect(autocapture._loadEditor.calledWith(lib, editorParams)).toBe(true)
            expect(JSON.parse(window.localStorage.getItem('_postHogEditorParams'))).toEqual(editorParams)
        })

        it('should initialize the visual editor when the hash state contains action "ph_authorize"', () => {
            editorParams = {
                ...editorParams,
                action: 'ph_authorize',
            }
            const hashParams = {
                state: encodeURIComponent(JSON.stringify(editorParams)),
            }

            hash = Object.keys(hashParams)
                .map((k) => `${k}=${hashParams[k]}`)
                .join('&')

            window.location.hash = `#${hash}`
            autocapture._maybeLoadEditor(lib)
            expect(autocapture._loadEditor.calledOnce).toBe(true)
            expect(autocapture._loadEditor.calledWith(lib, editorParams)).toBe(true)
            expect(JSON.parse(window.localStorage.getItem('_postHogEditorParams'))).toEqual(editorParams)
        })

        it('should initialize the visual editor when there are editor params in the session', () => {
            window.localStorage.setItem('_postHogEditorParams', JSON.stringify(editorParams))
            autocapture._maybeLoadEditor(lib)
            expect(autocapture._loadEditor.calledOnce).toBe(true)
            expect(autocapture._loadEditor.calledWith(lib, editorParams)).toBe(true)
            expect(JSON.parse(window.localStorage.getItem('_postHogEditorParams'))).toEqual(editorParams)
        })

        it('should NOT initialize the visual editor when the activation query param does not exist', () => {
            autocapture._maybeLoadEditor(lib)
            expect(autocapture._loadEditor.calledOnce).toBe(false)
        })

        it('should return false when parsing invalid JSON from fragment state', () => {
            const hashParams = {
                access_token: 'test_access_token',
                state: 'literally',
                expires_in: 3600,
            }
            hash = Object.keys(hashParams)
                .map((k) => `${k}=${hashParams[k]}`)
                .join('&')
            window.location.hash = `#${hash}`
            var spy = sinon.spy(autocapture, '_maybeLoadEditor')
            spy(lib)
            expect(spy.returned(false)).toBe(true)
        })

        it('should work if calling editor params `__posthog`', () => {
            const hashParams = {
                access_token: 'test_access_token',
                __posthog: encodeURIComponent(JSON.stringify(editorParams)),
                expires_in: 3600,
            }
            hash = Object.keys(hashParams)
                .map((k) => `${k}=${hashParams[k]}`)
                .join('&')
            window.location.hash = `#${hash}`
            autocapture._maybeLoadEditor(lib)
            expect(autocapture._loadEditor.calledOnce).toBe(true)
            expect(autocapture._loadEditor.calledWith(lib, editorParams)).toBe(true)
            expect(JSON.parse(window.localStorage.getItem('_postHogEditorParams'))).toEqual(editorParams)
        })
    })

    describe('load and close editor', () => {
        const lib = {}
        let sandbox

        beforeEach(() => {
            autocapture._editorLoaded = false
            sandbox = sinon.createSandbox()
            sandbox.stub(autocapture, '_loadScript').callsFake((path, callback) => callback())
            lib.get_config = sandbox.stub()
            lib.get_config.withArgs('app_host').returns('example.com')
            lib.get_config.withArgs('token').returns('token')
            window.ph_load_editor = sandbox.spy()
        })

        afterEach(() => {
            sandbox.restore()
        })

        it('should load if not previously loaded', () => {
            const editorParams = {
                accessToken: 'accessToken',
                expiresAt: 'expiresAt',
                apiKey: 'apiKey',
                apiURL: 'http://localhost:8000',
            }
            const loaded = autocapture._loadEditor(lib, editorParams)
            expect(window.ph_load_editor.calledOnce).toBe(true)
            expect(window.ph_load_editor.calledWithExactly(editorParams)).toBe(true)
            expect(loaded).toBe(true)
        })

        it('should NOT load if previously loaded', () => {
            autocapture._loadEditor(lib, 'accessToken')
            const loaded = autocapture._loadEditor(lib, 'accessToken')
            expect(loaded).toBe(false)
        })
    })
})
