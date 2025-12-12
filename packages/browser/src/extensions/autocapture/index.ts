import { PostHog } from '../../posthog-core'
import { AUTOCAPTURE_DISABLED_SERVER_SIDE } from '../../constants'
import { isBoolean, isFunction, isNull, isObject } from '@posthog/core'
import { assignableWindow, document, LazyLoadedAutocaptureInterface, window } from '../../utils/globals'
import { createLogger } from '../../utils/logger'
import { AutocaptureConfig, COPY_AUTOCAPTURE_EVENT, RemoteConfig } from '../../types'
import { addEventListener } from '../../utils'

const logger = createLogger('[AutoCapture]')

const MAX_QUEUED_EVENTS = 1000

interface QueuedEvent {
    event: Event
    timestamp: number
}

export class Autocapture {
    instance: PostHog
    _initialized: boolean = false
    _isDisabledServerSide: boolean | null = null
    _elementSelectors: Set<string> | null = null
    _elementsChainAsString = false

    private _lazyLoadedAutocapture: LazyLoadedAutocaptureInterface | undefined
    private _eventQueue: QueuedEvent[] = []

    constructor(instance: PostHog) {
        this.instance = instance
    }

    private get _config(): AutocaptureConfig {
        const config = isObject(this.instance.config.autocapture) ? this.instance.config.autocapture : {}
        config.url_allowlist = config.url_allowlist?.map((url) => new RegExp(url))
        config.url_ignorelist = config.url_ignorelist?.map((url) => new RegExp(url))
        return config
    }

    public get isEnabled(): boolean {
        const persistedServerDisabled = this.instance.persistence?.props[AUTOCAPTURE_DISABLED_SERVER_SIDE]
        const memoryDisabled = this._isDisabledServerSide

        if (isNull(memoryDisabled) && !isBoolean(persistedServerDisabled) && !this.instance._shouldDisableFlags()) {
            return false
        }

        const disabledServer = this._isDisabledServerSide ?? !!persistedServerDisabled
        const disabledClient = !this.instance.config.autocapture
        return !disabledClient && !disabledServer
    }

    public startIfEnabled(): void {
        // Don't do anything if autocapture is disabled by the client config
        if (!this.instance.config.autocapture) {
            return
        }

        // Add event handlers on first call (so events can be queued before server config arrives)
        if (!this._initialized) {
            this._addDomEventHandlers()
            this._initialized = true
        }

        // Only load the lazy script if we know autocapture is enabled (server config received)
        if (this.isEnabled && !this._lazyLoadedAutocapture) {
            this._loadScript(() => {
                this._start()
            })
        }
    }

    public onRemoteConfig(response: RemoteConfig): void {
        if (response.elementsChainAsString) {
            this._elementsChainAsString = response.elementsChainAsString
        }

        if (this.instance.persistence) {
            this.instance.persistence.register({
                [AUTOCAPTURE_DISABLED_SERVER_SIDE]: !!response['autocapture_opt_out'],
            })
        }
        this._isDisabledServerSide = !!response['autocapture_opt_out']
        this.startIfEnabled()
    }

    public setElementSelectors(selectors: Set<string>): void {
        this._elementSelectors = selectors
        if (this._lazyLoadedAutocapture) {
            this._lazyLoadedAutocapture.setElementSelectors(selectors)
        }
    }

    public getElementSelectors(element: Element | null): string[] | null {
        if (this._lazyLoadedAutocapture) {
            return this._lazyLoadedAutocapture.getElementSelectors(element)
        }
        return null
    }

    public isBrowserSupported(): boolean {
        return isFunction(document?.querySelectorAll)
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

        addEventListener(document, 'submit', handler, { capture: true })
        addEventListener(document, 'change', handler, { capture: true })
        addEventListener(document, 'click', handler, { capture: true })

        if (this._config.capture_copied_text) {
            const copiedTextHandler = (e: Event) => {
                e = e || window?.event
                this._captureEvent(e, COPY_AUTOCAPTURE_EVENT)
            }

            addEventListener(document, 'copy', copiedTextHandler, { capture: true })
            addEventListener(document, 'cut', copiedTextHandler, { capture: true })
        }
    }

    private _captureEvent(e: Event, eventName?: string): void {
        // If lazy impl is loaded, delegate directly (isEnabled check happens in lazy impl)
        if (this._lazyLoadedAutocapture) {
            this._lazyLoadedAutocapture._captureEvent(e, eventName)
            return
        }

        // Don't queue if client explicitly disabled autocapture
        if (!this.instance.config.autocapture) {
            return
        }

        // Queue events until we have the lazy impl loaded
        if (this._eventQueue.length < MAX_QUEUED_EVENTS) {
            this._eventQueue.push({ event: e, timestamp: Date.now() })
        }
    }

    private _loadScript(cb: () => void): void {
        if (assignableWindow.__PosthogExtensions__?.initAutocapture) {
            cb()
            return
        }
        assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this.instance, 'autocapture', (err) => {
            if (err) {
                logger.error('failed to load script', err)
                return
            }
            cb()
        })
    }

    private _start(): void {
        if (!document) {
            logger.error('`document` not found. Cannot start.')
            return
        }

        if (!this._lazyLoadedAutocapture && assignableWindow.__PosthogExtensions__?.initAutocapture) {
            this._lazyLoadedAutocapture = assignableWindow.__PosthogExtensions__.initAutocapture(this.instance)

            if (this._elementSelectors) {
                this._lazyLoadedAutocapture.setElementSelectors(this._elementSelectors)
            }

            this._processQueuedEvents()
            logger.info('started')
        }
    }

    private _processQueuedEvents(): void {
        if (!this._lazyLoadedAutocapture || this._eventQueue.length === 0) {
            return
        }

        logger.info(`processing ${this._eventQueue.length} queued events`)

        const queuedEvents = this._eventQueue
        this._eventQueue = []

        for (const { event, timestamp } of queuedEvents) {
            try {
                this._lazyLoadedAutocapture._captureEvent(event, undefined, new Date(timestamp))
            } catch (error) {
                logger.error('Failed to process queued event', error)
            }
        }
    }
}
