import { each, extend, includes, registerEvent } from './utils'
import {
    autocaptureCompatibleElements,
    getClassNames,
    getDirectAndNestedSpanText,
    getElementsChainString,
    getSafeText,
    isAngularStyleAttr,
    isDocumentFragment,
    isElementNode,
    isSensitiveElement,
    isTag,
    isTextNode,
    makeSafeText,
    shouldCaptureDomEvent,
    shouldCaptureElement,
    shouldCaptureValue,
    splitClassString,
} from './autocapture-utils'
import RageClick from './extensions/rageclick'
import { AutocaptureConfig, DecideResponse, Properties } from './types'
import { PostHog } from './posthog-core'
import { AUTOCAPTURE_DISABLED_SERVER_SIDE } from './constants'

import { isBoolean, isFunction, isNull, isObject, isUndefined } from './utils/type-utils'
import { logger } from './utils/logger'
import { document, window } from './utils/globals'

const COPY_AUTOCAPTURE_EVENT = '$copy_autocapture'

function limitText(length: number, text: string): string {
    if (text.length > length) {
        return text.slice(0, length) + '...'
    }
    return text
}

export class Autocapture {
    instance: PostHog
    _initialized: boolean = false
    _isDisabledServerSide: boolean | null = null
    rageclicks = new RageClick()
    _elementsChainAsString = false
    _decideResponse?: DecideResponse

    constructor(instance: PostHog) {
        this.instance = instance
    }

    private get config(): AutocaptureConfig {
        const config = isObject(this.instance.config.autocapture) ? this.instance.config.autocapture : {}
        // precompile the regex
        config.url_allowlist = config.url_allowlist?.map((url) => new RegExp(url))
        return config
    }

    private _addDomEventHandlers(): void {
        if (!this.isBrowserSupported()) {
            logger.info('Disabling Automatic Event Collection because this browser is not supported')
            return
        }

        if (!window || !document) {
            return
        }
        const handler = (e: Event) => {
            e = e || window?.event
            try {
                this._captureEvent(e)
            } catch (error) {
                logger.error('Failed to capture event', error)
            }
        }

        const copiedTextHandler = (e: Event) => {
            e = e || window?.event
            this._captureEvent(e, COPY_AUTOCAPTURE_EVENT)
        }

        registerEvent(document, 'submit', handler, false, true)
        registerEvent(document, 'change', handler, false, true)
        registerEvent(document, 'click', handler, false, true)

        if (this.config.capture_copied_text) {
            registerEvent(document, 'copy', copiedTextHandler, false, true)
            registerEvent(document, 'cut', copiedTextHandler, false, true)
        }
    }

    public startIfEnabled() {
        if (this.isEnabled && !this._initialized) {
            this._addDomEventHandlers()
            this._initialized = true
        }
    }

    public afterDecideResponse(response: DecideResponse) {
        if (response.elementsChainAsString) {
            this._elementsChainAsString = response.elementsChainAsString
        }

        if (this.instance.persistence) {
            this.instance.persistence.register({
                [AUTOCAPTURE_DISABLED_SERVER_SIDE]: !!response['autocapture_opt_out'],
            })
        }
        // store this in-memory in case persistence is disabled
        this._isDisabledServerSide = !!response['autocapture_opt_out']
        this.startIfEnabled()
    }

    public get isEnabled(): boolean {
        const persistedServerDisabled = this.instance.persistence?.props[AUTOCAPTURE_DISABLED_SERVER_SIDE]
        const memoryDisabled = this._isDisabledServerSide

        if (
            isNull(memoryDisabled) &&
            !isBoolean(persistedServerDisabled) &&
            !this.instance.config.advanced_disable_decide
        ) {
            // We only enable if we know that the server has not disabled it (unless decide is disabled)
            return false
        }

        const disabledServer = this._isDisabledServerSide ?? !!persistedServerDisabled
        const disabledClient = !this.instance.config.autocapture
        return !disabledClient && !disabledServer
    }

    private _previousElementSibling(el: Element): Element | null {
        if (el.previousElementSibling) {
            return el.previousElementSibling
        }
        let _el: Element | null = el
        do {
            _el = _el.previousSibling as Element | null // resolves to ChildNode->Node, which is Element's parent class
        } while (_el && !isElementNode(_el))
        return _el
    }

    private _getAugmentPropertiesFromElement(elem: Element): Properties {
        const shouldCaptureEl = shouldCaptureElement(elem)
        if (!shouldCaptureEl) {
            return {}
        }

        const props: Properties = {}

        each(elem.attributes, function (attr: Attr) {
            if (attr.name && attr.name.indexOf('data-ph-capture-attribute') === 0) {
                const propertyKey = attr.name.replace('data-ph-capture-attribute-', '')
                const propertyValue = attr.value
                if (propertyKey && propertyValue && shouldCaptureValue(propertyValue)) {
                    props[propertyKey] = propertyValue
                }
            }
        })
        return props
    }

    private _getPropertiesFromElement(elem: Element, maskInputs: boolean, maskText: boolean): Properties {
        const tag_name = elem.tagName.toLowerCase()
        const props: Properties = {
            tag_name: tag_name,
        }
        if (autocaptureCompatibleElements.indexOf(tag_name) > -1 && !maskText) {
            if (tag_name.toLowerCase() === 'a' || tag_name.toLowerCase() === 'button') {
                props['$el_text'] = limitText(1024, getDirectAndNestedSpanText(elem))
            } else {
                props['$el_text'] = limitText(1024, getSafeText(elem))
            }
        }

        const classes = getClassNames(elem)
        if (classes.length > 0)
            props['classes'] = classes.filter(function (c) {
                return c !== ''
            })

        // capture the deny list here because this not-a-class class makes it tricky to use this.config in the function below
        const elementAttributeIgnorelist = this.config?.element_attribute_ignorelist
        each(elem.attributes, function (attr: Attr) {
            // Only capture attributes we know are safe
            if (isSensitiveElement(elem) && ['name', 'id', 'class', 'aria-label'].indexOf(attr.name) === -1) return

            if (elementAttributeIgnorelist?.includes(attr.name)) return

            if (!maskInputs && shouldCaptureValue(attr.value) && !isAngularStyleAttr(attr.name)) {
                let value = attr.value
                if (attr.name === 'class') {
                    // html attributes can _technically_ contain linebreaks,
                    // but we're very intolerant of them in the class string,
                    // so we strip them.
                    value = splitClassString(value).join(' ')
                }
                props['attr__' + attr.name] = limitText(1024, value)
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
    }

    private _getDefaultProperties(eventType: string): Properties {
        return {
            $event_type: eventType,
            $ce_version: 1,
        }
    }

    private _getEventTarget(e: Event): Element | null {
        // https://developer.mozilla.org/en-US/docs/Web/API/Event/target#Compatibility_notes
        if (isUndefined(e.target)) {
            return (e.srcElement as Element) || null
        } else {
            if ((e.target as HTMLElement)?.shadowRoot) {
                return (e.composedPath()[0] as Element) || null
            }
            return (e.target as Element) || null
        }
    }

    private _captureEvent(e: Event, eventName = '$autocapture'): boolean | void {
        if (!this.isEnabled) {
            return
        }

        /*** Don't mess with this code without running IE8 tests on it ***/
        let target = this._getEventTarget(e)
        if (isTextNode(target)) {
            // defeat Safari bug (see: http://www.quirksmode.org/js/events_properties.html)
            target = (target.parentNode || null) as Element | null
        }

        if (eventName === '$autocapture' && e.type === 'click' && e instanceof MouseEvent) {
            if (
                this.instance.config.rageclick &&
                this.rageclicks?.isRageClick(e.clientX, e.clientY, new Date().getTime())
            ) {
                this._captureEvent(e, '$rageclick')
            }
        }

        const isCopyAutocapture = eventName === COPY_AUTOCAPTURE_EVENT
        if (
            target &&
            shouldCaptureDomEvent(
                target,
                e,
                this.config,
                // mostly this method cares about the target element, but in the case of copy events,
                // we want some of the work this check does without insisting on the target element's type
                isCopyAutocapture,
                // we also don't want to restrict copy checks to clicks,
                // so we pass that knowledge in here, rather than add the logic inside the check
                isCopyAutocapture ? ['copy', 'cut'] : undefined
            )
        ) {
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
            const autocaptureAugmentProperties: Properties = {}
            let href,
                explicitNoCapture = false

            each(targetElementList, (el) => {
                const shouldCaptureEl = shouldCaptureElement(el)

                // if the element or a parent element is an anchor tag
                // include the href as a property
                if (el.tagName.toLowerCase() === 'a') {
                    href = el.getAttribute('href')
                    href = shouldCaptureEl && shouldCaptureValue(href) && href
                }

                // allow users to programmatically prevent capturing of elements by adding class 'ph-no-capture'
                const classes = getClassNames(el)
                if (includes(classes, 'ph-no-capture')) {
                    explicitNoCapture = true
                }

                elementsJson.push(
                    this._getPropertiesFromElement(
                        el,
                        this.instance.config.mask_all_element_attributes,
                        this.instance.config.mask_all_text
                    )
                )

                const augmentProperties = this._getAugmentPropertiesFromElement(el)
                extend(autocaptureAugmentProperties, augmentProperties)
            })

            if (!this.instance.config.mask_all_text) {
                // if the element is a button or anchor tag get the span text from any
                // children and include it as/with the text property on the parent element
                if (target.tagName.toLowerCase() === 'a' || target.tagName.toLowerCase() === 'button') {
                    elementsJson[0]['$el_text'] = getDirectAndNestedSpanText(target)
                } else {
                    elementsJson[0]['$el_text'] = getSafeText(target)
                }
            }

            if (href) {
                elementsJson[0]['attr__href'] = href
            }

            if (explicitNoCapture) {
                return false
            }

            const props = extend(
                this._getDefaultProperties(e.type),
                this._elementsChainAsString
                    ? {
                          $elements_chain: getElementsChainString(elementsJson),
                      }
                    : {
                          $elements: elementsJson,
                      },
                elementsJson[0]?.['$el_text'] ? { $el_text: elementsJson[0]?.['$el_text'] } : {},
                autocaptureAugmentProperties
            )

            if (eventName === COPY_AUTOCAPTURE_EVENT) {
                // you can't read the data from the clipboard event,
                // but you can guess that you can read it from the window's current selection
                const selectedContent = makeSafeText(window?.getSelection()?.toString())
                const clipType = (e as ClipboardEvent).type || 'clipboard'
                if (!selectedContent) {
                    return false
                }
                props['$selected_content'] = selectedContent
                props['$copy_type'] = clipType
            }

            this.instance.capture(eventName, props)
            return true
        }
    }

    isBrowserSupported(): boolean {
        return isFunction(document?.querySelectorAll)
    }
}
