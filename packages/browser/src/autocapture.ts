import type { Client, Disposable, Extension } from '@posthog/browser-common'
import { addEventListener, each, extend } from '@posthog/browser-common/utils/general-utils'
import {
    autocaptureCompatibleElements,
    getClassNames,
    getDirectAndNestedSpanText,
    getElementsChainString,
    getEventTarget,
    getSafeText,
    isAngularStyleAttr,
    isSensitiveElement,
    makeSafeText,
    MAX_DOM_ANCESTOR_DEPTH,
    shouldCaptureDomEvent,
    shouldCaptureElement,
    shouldCaptureRageclick,
    shouldCaptureValue,
    splitClassString,
} from '@posthog/browser-common/utils/autocapture-utils'

import RageClick from './extensions/rageclick'
import { EventName, Properties, RemoteConfigResult } from './types'
import { AUTOCAPTURE_DISABLED_SERVER_SIDE } from './constants'
import type { AutocaptureConfig, AutocaptureConfigSource } from './autocapture-config'

import { isBoolean, isFunction, isNull, stripUrlHash } from '@posthog/core'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { document, window } from '@posthog/browser-common/utils/globals'
import { convertToURL } from '@posthog/browser-common/utils/request-utils'
import { isElementNode, isShadowRoot, isTag, isTextNode } from '@posthog/browser-common/utils/element-utils'
import { includes } from '@posthog/core'

const COPY_AUTOCAPTURE_EVENT = '$copy_autocapture'

const logger = createLogger('[AutoCapture]')

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
    elementAttributeIgnorelist: string[] | undefined,
    disableCaptureUrlHashes: boolean = false
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
            props['attr__' + attr.name] = limitText(
                1024,
                attr.name === 'href' && disableCaptureUrlHashes ? stripUrlHash(value) : value
            )
        }
    })

    let nthChild = 1
    let nthOfType = 1
    let currentElem: Element | null = elem
    while ((currentElem = previousElementSibling(currentElem))) {
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
        disableCaptureUrlHashes,
    }: {
        e: Event
        maskAllElementAttributes: boolean
        maskAllText: boolean
        elementAttributeIgnoreList?: string[] | undefined
        elementsChainAsString: boolean
        disableCaptureUrlHashes: boolean
    }
): { props: Properties; explicitNoCapture?: boolean } {
    if (!isElementNode(target)) {
        return { props: {} }
    }

    const targetElementList: Element[] = [target]
    const seen = new Set<Node>([target])
    let curEl: Element = target
    while (curEl.parentNode && !isTag(curEl, 'body')) {
        // bail out of abnormally deep or cyclic (patched parentNode) ancestor chains
        if (targetElementList.length >= MAX_DOM_ANCESTOR_DEPTH) {
            break
        }
        if (isShadowRoot(curEl.parentNode)) {
            const host = curEl.parentNode.host
            if (seen.has(host)) {
                break
            }
            seen.add(host)
            targetElementList.push(host)
            curEl = host
            continue
        }
        if (!isElementNode(curEl.parentNode)) {
            break
        }
        if (seen.has(curEl.parentNode)) {
            break
        }
        seen.add(curEl.parentNode)
        targetElementList.push(curEl.parentNode)
        curEl = curEl.parentNode
    }

    const elementsJson: Properties[] = []
    const autocaptureAugmentProperties: Properties = {}
    let href: string | false = false
    let explicitNoCapture = false

    each(targetElementList, (el) => {
        const shouldCaptureEl = shouldCaptureElement(el)

        // if the element or a parent element is an anchor tag
        // include the href as a property
        if (isTag(el, 'a')) {
            const hrefAttr = el.getAttribute('href')
            href =
                shouldCaptureEl && !!hrefAttr && shouldCaptureValue(hrefAttr)
                    ? disableCaptureUrlHashes
                        ? stripUrlHash(hrefAttr)
                        : hrefAttr
                    : false
        }

        // allow users to programmatically prevent capturing of elements by adding class 'ph-no-capture'
        const classes = getClassNames(el)
        if (includes(classes, 'ph-no-capture')) {
            explicitNoCapture = true
        }

        elementsJson.push(
            getPropertiesFromElement(
                el,
                maskAllElementAttributes,
                maskAllText,
                elementAttributeIgnoreList,
                disableCaptureUrlHashes
            )
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
        if (isTag(target, 'a') || isTag(target, 'button')) {
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

export class Autocapture implements Extension {
    readonly name = 'autocapture'
    _initialized: boolean = false
    _isDisabledServerSide: boolean | null = null
    _hasReceivedConfigResponse: boolean = false
    _elementSelectors: Set<string> | null
    rageclicks: RageClick
    _elementsChainAsString = false
    private _client?: Client
    private readonly _config: AutocaptureConfig = {
        enabled: false,
        rageclick: false,
        maskAllElementAttributes: false,
        maskAllText: false,
        disableCaptureUrlHashes: false,
        remoteRequestsDisabled: false,
    }
    private _remoteConfigSubscription?: Disposable
    private _domEventHandler?: EventListener
    private _copiedTextHandler?: EventListener
    private _disposed = false

    constructor(private readonly _configSource: AutocaptureConfigSource) {
        this._configSource.refresh(this._config)
        this.rageclicks = new RageClick(this._config.rageclick)
        this._elementSelectors = null
    }

    setup(client: Client): void {
        this._compileUrlPatterns()
        this._client = client
        const subscription = client.onRemoteConfig(
            this.onRemoteConfig.bind(this) as Parameters<Client['onRemoteConfig']>[0]
        )
        if (this._disposed) {
            subscription.dispose()
            return
        }
        this._remoteConfigSubscription = subscription
        this.startIfEnabled()
    }

    dispose(): void {
        if (this._disposed) {
            return
        }
        this._disposed = true
        this._client = undefined
        this._remoteConfigSubscription?.dispose()
        this._remoteConfigSubscription = undefined
        this._removeDomEventHandlers()
    }

    private _refreshConfig(): Readonly<AutocaptureConfig> {
        this._configSource.refresh(this._config)
        return this._config
    }

    private _compileUrlPatterns(): Readonly<AutocaptureConfig> {
        this._refreshConfig()
        this._config.url_allowlist = this._config.url_allowlist?.map((url) => new RegExp(url))
        this._config.url_ignorelist = this._config.url_ignorelist?.map((url) => new RegExp(url))
        return this._config
    }

    _addDomEventHandlers(): void {
        if (!this.isBrowserSupported()) {
            logger.info('Disabling Automatic Event Collection because this browser is not supported')
            return
        }

        if (!window || !document) {
            return
        }

        const handler = (this._domEventHandler = (e: Event) => {
            e = e || window?.event
            try {
                this._captureEvent(e)
            } catch (error) {
                logger.error('Failed to capture event', error)
            }
        })

        addEventListener(document, 'submit', handler, { capture: true })
        addEventListener(document, 'change', handler, { capture: true })
        addEventListener(document, 'click', handler, { capture: true })

        if (this._refreshConfig().capture_copied_text) {
            const copiedTextHandler = (this._copiedTextHandler = (e: Event) => {
                e = e || window?.event
                try {
                    this._captureEvent(e, COPY_AUTOCAPTURE_EVENT)
                } catch (error) {
                    logger.error('Failed to capture copy/cut event', error)
                }
            })

            addEventListener(document, 'copy', copiedTextHandler, { capture: true })
            addEventListener(document, 'cut', copiedTextHandler, { capture: true })
        }
    }

    private _removeDomEventHandlers(): void {
        if (this._domEventHandler) {
            document?.removeEventListener('submit', this._domEventHandler, true)
            document?.removeEventListener('change', this._domEventHandler, true)
            document?.removeEventListener('click', this._domEventHandler, true)
            this._domEventHandler = undefined
        }
        if (this._copiedTextHandler) {
            document?.removeEventListener('copy', this._copiedTextHandler, true)
            document?.removeEventListener('cut', this._copiedTextHandler, true)
            this._copiedTextHandler = undefined
        }
        this._initialized = false
    }

    public startIfEnabled(): void {
        if (!this._disposed && this._client && this.isEnabled && !this._initialized) {
            this._addDomEventHandlers()
            this._initialized = true
        }
    }

    public onRemoteConfig(result: RemoteConfigResult): void {
        if (this._disposed) {
            return
        }
        this._hasReceivedConfigResponse = true
        if (!result.ok) {
            // Failed fetch = opt-out unknown: keep the last known persisted server
            // value instead of defaulting to enabled, so a network error cannot turn
            // autocapture on for an opted-out project. No persistence write.
            this.startIfEnabled()
            return
        }

        const response = result.config
        if (response.elementsChainAsString) {
            this._elementsChainAsString = response.elementsChainAsString
        }

        // A missing autocapture_opt_out carries no opt-out information:
        // keep the last known server value, as with a failed fetch.
        const optOut = response['autocapture_opt_out']
        if (isBoolean(optOut)) {
            this._client?.kv.set(AUTOCAPTURE_DISABLED_SERVER_SIDE, optOut)
            // store this in-memory in case persistence is disabled
            this._isDisabledServerSide = optOut
        }
        this.startIfEnabled()
    }

    public setElementSelectors(selectors: Set<string>): void {
        this._elementSelectors = selectors
    }

    public getElementSelectors(element: Element | null): string[] | null {
        const elementSelectors: string[] = []

        this._elementSelectors?.forEach((selector) => {
            const matchedElements = document?.querySelectorAll(selector)
            matchedElements?.forEach((matchedElement: Element) => {
                if (element === matchedElement) {
                    elementSelectors.push(selector)
                }
            })
        })

        return elementSelectors
    }

    public get isEnabled(): boolean {
        if (this._disposed) {
            return false
        }
        const persistedServerDisabled = this._client?.kv.get<boolean>(AUTOCAPTURE_DISABLED_SERVER_SIDE)
        const memoryDisabled = this._isDisabledServerSide

        // The /flags-disabled bypass only applies while no config outcome has arrived;
        // once a response (or failure) has been seen, an unknown opt-out stays off.
        const config = this._refreshConfig()
        const clientConfigOnly = config.remoteRequestsDisabled && !this._hasReceivedConfigResponse
        if (isNull(memoryDisabled) && !isBoolean(persistedServerDisabled) && !clientConfigOnly) {
            // We only enable if we know that the server has not disabled it
            return false
        }

        const disabledServer = this._isDisabledServerSide ?? !!persistedServerDisabled
        const disabledClient = !config.enabled
        return !disabledClient && !disabledServer
    }

    private _captureEvent(e: Event, eventName: EventName = '$autocapture'): boolean | void {
        if (!this.isEnabled) {
            return
        }

        /*** Don't mess with this code without running IE8 tests on it ***/
        let target = getEventTarget(e)
        if (isTextNode(target)) {
            // defeat Safari bug (see: http://www.quirksmode.org/js/events_properties.html)
            target = (target.parentNode || null) as Element | null
        }

        const config = this._compileUrlPatterns()
        if (eventName === '$autocapture' && e.type === 'click' && e instanceof MouseEvent) {
            if (
                !!config.rageclick &&
                this.rageclicks?.isRageClick(e.clientX, e.clientY, e.timeStamp || new Date().getTime())
            ) {
                if (shouldCaptureRageclick(target, config.rageclick)) {
                    this._captureEvent(e, '$rageclick')
                }
            }
        }

        const isCopyAutocapture = eventName === COPY_AUTOCAPTURE_EVENT
        if (
            target &&
            shouldCaptureDomEvent(
                target,
                e,
                config,
                // mostly this method cares about the target element, but in the case of copy events,
                // we want some of the work this check does without insisting on the target element's type
                isCopyAutocapture,
                // we also don't want to restrict copy checks to clicks,
                // so we pass that knowledge in here, rather than add the logic inside the check
                isCopyAutocapture ? ['copy', 'cut'] : undefined,
                { config: { get_current_url: config.getCurrentUrl } }
            )
        ) {
            const { props, explicitNoCapture } = autocapturePropertiesForElement(target, {
                e,
                maskAllElementAttributes: config.maskAllElementAttributes,
                maskAllText: config.maskAllText,
                elementAttributeIgnoreList: config.element_attribute_ignorelist,
                elementsChainAsString: this._elementsChainAsString,
                disableCaptureUrlHashes: config.disableCaptureUrlHashes,
            })

            if (explicitNoCapture) {
                return false
            }

            const elementSelectors = this.getElementSelectors(target)
            if (elementSelectors && elementSelectors.length > 0) {
                props['$element_selectors'] = elementSelectors
            }

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

            void this._client
                ?.capture(eventName, props)
                .catch((error) => logger.error('Failed to capture event', error))
            return true
        }
    }

    isBrowserSupported(): boolean {
        return isFunction(document?.querySelectorAll)
    }
}
