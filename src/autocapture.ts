import {
    _bind_instance_methods,
    _each,
    _extend,
    _includes,
    _isFunction,
    _isUndefined,
    _register_event,
    _safewrap_instance_methods,
    logger,
} from './utils'
import {
    getClassName,
    getSafeText,
    isElementNode,
    isSensitiveElement,
    isTag,
    isTextNode,
    shouldCaptureDomEvent,
    shouldCaptureElement,
    shouldCaptureValue,
    usefulElements,
    isAngularStyleAttr,
    isDocumentFragment,
} from './autocapture-utils'
import RageClick from './extensions/rageclick'
import { AutoCaptureCustomProperty, DecideResponse, Properties } from './types'
import { PostHog } from './posthog-core'

const autocapture = {
    _initializedTokens: [] as string[],

    _previousElementSibling: function (el: Element): Element | null {
        if (el.previousElementSibling) {
            return el.previousElementSibling
        } else {
            let _el: Element | null = el
            do {
                _el = _el.previousSibling as Element | null // resolves to ChildNode->Node, which is Element's parent class
            } while (_el && !isElementNode(_el))
            return _el
        }
    },

    _getPropertiesFromElement: function (elem: Element, maskInputs: boolean, maskText: boolean): Properties {
        const tag_name = elem.tagName.toLowerCase()
        const props: Properties = {
            tag_name: tag_name,
        }
        if (usefulElements.indexOf(tag_name) > -1 && !maskText) {
            props['$el_text'] = getSafeText(elem)
        }

        const classes = getClassName(elem)
        if (classes.length > 0)
            props['classes'] = classes.split(' ').filter(function (c) {
                return c !== ''
            })

        _each(elem.attributes, function (attr: Attr) {
            // Only capture attributes we know are safe
            if (isSensitiveElement(elem) && ['name', 'id', 'class'].indexOf(attr.name) === -1) return

            if (!maskInputs && shouldCaptureValue(attr.value) && !isAngularStyleAttr(attr.name)) {
                props['attr__' + attr.name] = attr.value
            }
        })

        let nthChild = 1
        let nthOfType = 1
        let currentElem: Element | null = elem
        while ((currentElem = this._previousElementSibling(currentElem))) {
            // eslint-disable-line no-cond-assign
            nthChild++
            if (currentElem.tagName === elem.tagName) {
                nthOfType++
            }
        }
        props['nth_child'] = nthChild
        props['nth_of_type'] = nthOfType

        return props
    },

    _getDefaultProperties: function (eventType: string): Properties {
        return {
            $event_type: eventType,
            $ce_version: 1,
        }
    },

    _extractCustomPropertyValue: function (customProperty: AutoCaptureCustomProperty): string {
        const propValues: string[] = []
        _each(document.querySelectorAll(customProperty['css_selector']), function (matchedElem) {
            let value

            if (['input', 'select'].indexOf(matchedElem.tagName.toLowerCase()) > -1) {
                value = matchedElem['value']
            } else if (matchedElem['textContent']) {
                value = matchedElem['textContent']
            }

            if (shouldCaptureValue(value)) {
                propValues.push(value)
            }
        })
        return propValues.join(', ')
    },

    // TODO: delete custom_properties after changeless typescript refactor
    _getCustomProperties: function (targetElementList: Element[]): Properties {
        const props: Properties = {} // will be deleted
        _each(this._customProperties, (customProperty) => {
            _each(customProperty['event_selectors'], (eventSelector) => {
                const eventElements = document.querySelectorAll(eventSelector)
                _each(eventElements, (eventElement) => {
                    if (_includes(targetElementList, eventElement) && shouldCaptureElement(eventElement)) {
                        props[customProperty['name']] = this._extractCustomPropertyValue(customProperty)
                    }
                })
            })
        })
        return props
    },

    _getEventTarget: function (e: Event): Element | null {
        // https://developer.mozilla.org/en-US/docs/Web/API/Event/target#Compatibility_notes
        if (typeof e.target === 'undefined') {
            return (e.srcElement as Element) || null
        } else {
            if ((e.target as HTMLElement)?.shadowRoot) {
                return (e.composedPath()[0] as Element) || null
            }
            return (e.target as Element) || null
        }
    },

    _captureEvent: function (e: Event, instance: PostHog): boolean | void {
        /*** Don't mess with this code without running IE8 tests on it ***/
        let target = this._getEventTarget(e)
        if (isTextNode(target)) {
            // defeat Safari bug (see: http://www.quirksmode.org/js/events_properties.html)
            target = (target.parentNode || null) as Element | null
        }

        if (e.type === 'click' && e instanceof MouseEvent) {
            this.rageclicks?.click(e.clientX, e.clientY, new Date().getTime())
        }

        if (target && shouldCaptureDomEvent(target, e)) {
            const targetElementList = [target]
            let curEl = target
            while (curEl.parentNode && !isTag(curEl, 'body')) {
                if (isDocumentFragment(curEl.parentNode)) {
                    targetElementList.push((curEl.parentNode as any).host)
                    curEl = (curEl.parentNode as any).host
                    continue
                }
                targetElementList.push(curEl.parentNode as Element)
                curEl = curEl.parentNode as Element
            }

            const elementsJson: Properties[] = []
            let href,
                explicitNoCapture = false
            _each(targetElementList, (el) => {
                const shouldCaptureEl = shouldCaptureElement(el)

                // if the element or a parent element is an anchor tag
                // include the href as a property
                if (el.tagName.toLowerCase() === 'a') {
                    href = el.getAttribute('href')
                    href = shouldCaptureEl && shouldCaptureValue(href) && href
                }

                // allow users to programmatically prevent capturing of elements by adding class 'ph-no-capture'
                const classes = getClassName(el).split(' ')
                if (_includes(classes, 'ph-no-capture')) {
                    explicitNoCapture = true
                }

                elementsJson.push(
                    this._getPropertiesFromElement(
                        el,
                        instance.get_config('mask_all_element_attributes'),
                        instance.get_config('mask_all_text')
                    )
                )
            })

            if (!instance.get_config('mask_all_text')) {
                elementsJson[0]['$el_text'] = getSafeText(target)
            }

            if (href) {
                elementsJson[0]['attr__href'] = href
            }

            if (explicitNoCapture) {
                return false
            }

            const props = _extend(
                this._getDefaultProperties(e.type),
                {
                    $elements: elementsJson,
                },
                this._getCustomProperties(targetElementList)
            )

            instance.capture('$autocapture', props)
            return true
        }
    },

    // only reason is to stub for unit tests
    // since you can't override window.location props
    _navigate: function (href: string): void {
        window.location.href = href
    },

    _addDomEventHandlers: function (instance: PostHog): void {
        const handler = (e: Event) => {
            e = e || window.event
            this._captureEvent(e, instance)
        }
        _register_event(document, 'submit', handler, false, true)
        _register_event(document, 'change', handler, false, true)
        _register_event(document, 'click', handler, false, true)
    },

    _customProperties: [] as AutoCaptureCustomProperty[],
    rageclicks: null as RageClick | null,

    init: function (instance: PostHog): void {
        this.rageclicks = new RageClick(instance)
    },

    afterDecideResponse: function (response: DecideResponse, instance: PostHog): void {
        const token = instance.get_config('token')
        if (this._initializedTokens.indexOf(token) > -1) {
            logger.log('autocapture already initialized for token "' + token + '"')
            return
        }

        this._initializedTokens.push(token)

        if (
            response &&
            response['config'] &&
            response['config']['enable_collect_everything'] &&
            instance.get_config('autocapture')
        ) {
            // TODO: delete custom_properties after changeless typescript refactor
            if (response['custom_properties']) {
                this._customProperties = response['custom_properties']
            }
            this._addDomEventHandlers(instance)
        } else {
            instance['__autocapture_enabled'] = false
        }
    },

    // this is a mechanism to ramp up CE with no server-side interaction.
    // when CE is active, every page load results in a decide request. we
    // need to gently ramp this up so we don't overload decide. this decides
    // deterministically if CE is enabled for this project by modding the char
    // value of the project token.
    enabledForProject: function (
        token: string | null | undefined,
        numBuckets: number,
        numEnabledBuckets: number
    ): boolean {
        if (!token) {
            return true
        }
        numBuckets = !_isUndefined(numBuckets) ? numBuckets : 10
        numEnabledBuckets = !_isUndefined(numEnabledBuckets) ? numEnabledBuckets : 10
        let charCodeSum = 0
        for (let i = 0; i < token.length; i++) {
            charCodeSum += token.charCodeAt(i)
        }
        return charCodeSum % numBuckets < numEnabledBuckets
    },

    isBrowserSupported: function (): boolean {
        return _isFunction(document.querySelectorAll)
    },
}

_bind_instance_methods(autocapture)
_safewrap_instance_methods(autocapture)

export { autocapture }
