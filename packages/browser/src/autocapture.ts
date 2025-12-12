import { each, extend } from './utils'
import {
    autocaptureCompatibleElements,
    getClassNames,
    getDirectAndNestedSpanText,
    getElementsChainString,
    getSafeText,
    isAngularStyleAttr,
    isSensitiveElement,
    shouldCaptureElement,
    shouldCaptureValue,
    splitClassString,
} from './autocapture-utils'

import { Properties } from './types'

export { Autocapture } from './extensions/autocapture'

import { window } from './utils/globals'
import { convertToURL } from './utils/request-utils'
import { isDocumentFragment, isElementNode, isTag } from './utils/element-utils'
import { includes } from '@posthog/core'

function limitText(length: number, text: string): string {
    if (text.length > length) {
        return text.slice(0, length) + '...'
    }
    return text
}

export function getAugmentPropertiesFromElement(elem: Element): Properties {
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

export function previousElementSibling(el: Element): Element | null {
    if (el.previousElementSibling) {
        return el.previousElementSibling
    }
    let _el: Element | null = el
    do {
        _el = _el.previousSibling as Element | null // resolves to ChildNode->Node, which is Element's parent class
    } while (_el && !isElementNode(_el))
    return _el
}

export function getDefaultProperties(eventType: string): Properties {
    return {
        $event_type: eventType,
        $ce_version: 1,
    }
}

export function getPropertiesFromElement(
    elem: Element,
    maskAllAttributes: boolean,
    maskText: boolean,
    elementAttributeIgnorelist: string[] | undefined
): Properties {
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
    each(elem.attributes, function (attr: Attr) {
        // Only capture attributes we know are safe
        if (isSensitiveElement(elem) && ['name', 'id', 'class', 'aria-label'].indexOf(attr.name) === -1) return

        if (elementAttributeIgnorelist?.includes(attr.name)) return

        if (!maskAllAttributes && shouldCaptureValue(attr.value) && !isAngularStyleAttr(attr.name)) {
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
    while ((currentElem = previousElementSibling(currentElem))) {
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

export function autocapturePropertiesForElement(
    target: Element,
    {
        e,
        maskAllElementAttributes,
        maskAllText,
        elementAttributeIgnoreList,
        elementsChainAsString,
    }: {
        e: Event
        maskAllElementAttributes: boolean
        maskAllText: boolean
        elementAttributeIgnoreList?: string[] | undefined
        elementsChainAsString: boolean
    }
): { props: Properties; explicitNoCapture?: boolean } {
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
    let href: string | false = false
    let explicitNoCapture = false

    each(targetElementList, (el) => {
        const shouldCaptureEl = shouldCaptureElement(el)

        // if the element or a parent element is an anchor tag
        // include the href as a property
        if (el.tagName.toLowerCase() === 'a') {
            href = el.getAttribute('href')
            href = shouldCaptureEl && href && shouldCaptureValue(href) && href
        }

        // allow users to programmatically prevent capturing of elements by adding class 'ph-no-capture'
        const classes = getClassNames(el)
        if (includes(classes, 'ph-no-capture')) {
            explicitNoCapture = true
        }

        elementsJson.push(
            getPropertiesFromElement(el, maskAllElementAttributes, maskAllText, elementAttributeIgnoreList)
        )

        const augmentProperties = getAugmentPropertiesFromElement(el)
        extend(autocaptureAugmentProperties, augmentProperties)
    })

    if (explicitNoCapture) {
        return { props: {}, explicitNoCapture }
    }

    if (!maskAllText) {
        // if the element is a button or anchor tag get the span text from any
        // children and include it as/with the text property on the parent element
        if (target.tagName.toLowerCase() === 'a' || target.tagName.toLowerCase() === 'button') {
            elementsJson[0]['$el_text'] = getDirectAndNestedSpanText(target)
        } else {
            elementsJson[0]['$el_text'] = getSafeText(target)
        }
    }

    let externalHref: string | undefined
    if (href) {
        elementsJson[0]['attr__href'] = href
        const hrefHost = convertToURL(href)?.host
        const locationHost = window?.location?.host
        if (hrefHost && locationHost && hrefHost !== locationHost) {
            externalHref = href
        }
    }

    const props = extend(
        getDefaultProperties(e.type),
        // Sending "$elements" is deprecated. Only one client on US cloud uses this.
        !elementsChainAsString ? { $elements: elementsJson } : {},
        // Always send $elements_chain, as it's needed downstream in site app filtering
        { $elements_chain: getElementsChainString(elementsJson) },
        elementsJson[0]?.['$el_text'] ? { $el_text: elementsJson[0]?.['$el_text'] } : {},
        externalHref && e.type === 'click' ? { $external_click_url: externalHref } : {},
        autocaptureAugmentProperties
    )

    return { props }
}
