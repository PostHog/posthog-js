import { DecideResponse } from '../../types'
import { PostHog } from '../../posthog-core'
import { AUTOCAPTURE_DISABLED_SERVER_SIDE } from '../../constants'

import { isBoolean, isFunction, isNull } from '../../utils/type-utils'
import { logger } from '../../utils/logger'
import { assignableWindow, document } from '../../utils/globals'
import { LazyExtension, LOGGER_PREFIX } from '../heatmaps'

export interface DOMAutocapture extends LazyExtension {
    setElementsChainAsString: (elementsChainAsString: boolean) => void
    setElementSelectors: (selectors: Set<string>) => void
    getElementSelectors(element: Element | null): string[] | null
}

export class Autocapture implements LazyExtension {
    instance: PostHog
    _initialized: boolean = false
    _isDisabledServerSide: boolean | null = null
    _domAutocapture?: DOMAutocapture

    constructor(instance: PostHog) {
        this.instance = instance
    }

    public startIfEnabled() {
        if (this.isEnabled && !this._initialized) {
            this._initialized = true

            if (!this._domAutocapture) {
                assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(
                    this.instance,
                    'dom-autocapture',
                    (err) => {
                        if (err) {
                            this._initialized = false
                            return logger.error(LOGGER_PREFIX + ` could not load lazy js`, err)
                        }

                        this._onScriptLoaded()
                    }
                )
            } else {
                this._onScriptLoaded()
            }
        }
    }

    private _onScriptLoaded() {
        this._domAutocapture = assignableWindow.__PosthogExtensions__?.DOMAutocapture?.(this.instance)
        if (this._domAutocapture) {
            this._domAutocapture.startIfEnabled()
        }
    }

    public afterDecideResponse(response: DecideResponse) {
        if (response.elementsChainAsString) {
            // TODO what about if the extension loads after the decide response?
            this._domAutocapture?.setElementsChainAsString(response.elementsChainAsString)
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

    public setElementSelectors(selectors: Set<string>): void {
        this._domAutocapture?.setElementSelectors(selectors)
    }

    public getElementSelectors(element: Element | null): string[] | null {
        return this._domAutocapture?.getElementSelectors(element) || null
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

    isBrowserSupported(): boolean {
        return isFunction(document?.querySelectorAll)
    }
}
