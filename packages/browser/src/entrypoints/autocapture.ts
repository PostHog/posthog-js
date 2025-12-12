import { makeSafeText, shouldCaptureDomEvent, shouldCaptureRageclick } from '../autocapture-utils'
import { autocapturePropertiesForElement } from '../autocapture'
import { getEventTarget } from '../utils/dom-event-utils'
import RageClick from '../extensions/rageclick'
import { AutocaptureConfig, COPY_AUTOCAPTURE_EVENT, EventName } from '../types'
import { PostHog } from '../posthog-core'

import { isObject } from '@posthog/core'
import { assignableWindow, document, LazyLoadedAutocaptureInterface, window } from '../utils/globals'
import { isTextNode } from '../utils/element-utils'

class LazyLoadedAutocapture implements LazyLoadedAutocaptureInterface {
    private _rageclicks: RageClick
    private _elementSelectors: Set<string> | null = null

    constructor(private readonly _instance: PostHog) {
        this._rageclicks = new RageClick(_instance.config.rageclick)
    }

    private get _elementsChainAsString(): boolean {
        return this._instance.autocapture?._elementsChainAsString ?? false
    }

    private get _config(): AutocaptureConfig {
        const config = isObject(this._instance.config.autocapture) ? this._instance.config.autocapture : {}
        config.url_allowlist = config.url_allowlist?.map((url) => new RegExp(url))
        config.url_ignorelist = config.url_ignorelist?.map((url) => new RegExp(url))
        return config
    }

    setElementSelectors(selectors: Set<string>): void {
        this._elementSelectors = selectors
    }

    getElementSelectors(element: Element | null): string[] | null {
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

    _captureEvent(e: Event, eventName: EventName = '$autocapture', timestamp?: Date): boolean | void {
        if (!this._instance.autocapture?.isEnabled) {
            return false
        }

        let target = getEventTarget(e)
        if (isTextNode(target)) {
            target = (target.parentNode || null) as Element | null
        }

        if (eventName === '$autocapture' && e.type === 'click' && e instanceof MouseEvent) {
            if (
                !!this._instance.config.rageclick &&
                this._rageclicks?.isRageClick(e.clientX, e.clientY, e.timeStamp || new Date().getTime())
            ) {
                if (shouldCaptureRageclick(target, this._instance.config.rageclick)) {
                    this._captureEvent(e, '$rageclick', timestamp)
                }
            }
        }

        const isCopyAutocapture = eventName === COPY_AUTOCAPTURE_EVENT
        if (
            target &&
            shouldCaptureDomEvent(
                target,
                e,
                this._config,
                isCopyAutocapture,
                isCopyAutocapture ? ['copy', 'cut'] : undefined
            )
        ) {
            const { props, explicitNoCapture } = autocapturePropertiesForElement(target, {
                e,
                maskAllElementAttributes: this._instance.config.mask_all_element_attributes,
                maskAllText: this._instance.config.mask_all_text,
                elementAttributeIgnoreList: this._config.element_attribute_ignorelist,
                elementsChainAsString: this._elementsChainAsString,
            })

            if (explicitNoCapture) {
                return false
            }

            const elementSelectors = this.getElementSelectors(target)
            if (elementSelectors && elementSelectors.length > 0) {
                props['$element_selectors'] = elementSelectors
            }

            if (eventName === COPY_AUTOCAPTURE_EVENT) {
                const selectedContent = makeSafeText(window?.getSelection()?.toString())
                const clipType = (e as ClipboardEvent).type || 'clipboard'
                if (!selectedContent) {
                    return false
                }
                props['$selected_content'] = selectedContent
                props['$copy_type'] = clipType
            }

            this._instance.capture(eventName, props, timestamp ? { timestamp } : undefined)
            return true
        }
    }
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.initAutocapture = (ph: PostHog): LazyLoadedAutocaptureInterface => {
    return new LazyLoadedAutocapture(ph)
}
