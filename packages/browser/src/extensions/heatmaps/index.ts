import { Properties, RemoteConfig } from '../../types'
import { PostHog } from '../../posthog-core'

import { assignableWindow, document, LazyLoadedHeatmapsInterface, window } from '../../utils/globals'
import { HEATMAPS_ENABLED_SERVER_SIDE } from '../../constants'
import { isObject, isUndefined } from '@posthog/core'
import { createLogger } from '../../utils/logger'
import { addEventListener } from '../../utils'

const logger = createLogger('[Heatmaps]')

const MAX_QUEUED_EVENTS = 1000
const DEFAULT_FLUSH_INTERVAL = 5000

export type HeatmapEventBuffer =
    | {
          [key: string]: Properties[]
      }
    | undefined

interface QueuedHeatmapEvent {
    event: MouseEvent
    type: string
    timestamp: number
}

export class Heatmaps {
    instance: PostHog
    _enabledServerSide: boolean = false
    _initialized = false

    private _lazyLoadedHeatmaps: LazyLoadedHeatmapsInterface | undefined
    private _eventQueue: QueuedHeatmapEvent[] = []
    private _onClickHandler: ((e: Event) => void) | undefined
    private _onMouseMoveHandler: ((e: Event) => void) | undefined

    constructor(instance: PostHog) {
        this.instance = instance
        this._enabledServerSide = !!this.instance.persistence?.props[HEATMAPS_ENABLED_SERVER_SIDE]
    }

    public get flushIntervalMilliseconds(): number {
        let flushInterval = DEFAULT_FLUSH_INTERVAL
        if (
            isObject(this.instance.config.capture_heatmaps) &&
            this.instance.config.capture_heatmaps.flush_interval_milliseconds
        ) {
            flushInterval = this.instance.config.capture_heatmaps.flush_interval_milliseconds
        }
        return flushInterval
    }

    public get isEnabled(): boolean {
        if (!isUndefined(this.instance.config.capture_heatmaps)) {
            return this.instance.config.capture_heatmaps !== false
        }
        if (!isUndefined(this.instance.config.enable_heatmaps)) {
            return this.instance.config.enable_heatmaps
        }
        return this._enabledServerSide
    }

    public startIfEnabled(): void {
        if (this.isEnabled) {
            if (this._initialized) {
                return
            }
            this._setupListeners()
            this._initialized = true

            this._loadScript(() => {
                this._start()
            })
        } else {
            this._removeListeners()
            if (this._lazyLoadedHeatmaps) {
                this._lazyLoadedHeatmaps.stop()
                this._lazyLoadedHeatmaps = undefined
            }
            this._eventQueue = []
        }
    }

    public onRemoteConfig(response: RemoteConfig): void {
        const optIn = !!response['heatmaps']

        if (this.instance.persistence) {
            this.instance.persistence.register({
                [HEATMAPS_ENABLED_SERVER_SIDE]: optIn,
            })
        }
        this._enabledServerSide = optIn
        this.startIfEnabled()
    }

    public getAndClearBuffer(): HeatmapEventBuffer {
        if (this._lazyLoadedHeatmaps) {
            return this._lazyLoadedHeatmaps.getAndClearBuffer()
        }
        return undefined
    }

    private _setupListeners(): void {
        if (!window || !document) {
            return
        }

        this._onClickHandler = (e) => this._queueEvent((e || window?.event) as MouseEvent, 'click')
        addEventListener(document, 'click', this._onClickHandler, { capture: true })

        this._onMouseMoveHandler = (e) => this._queueEvent((e || window?.event) as MouseEvent, 'mousemove')
        addEventListener(document, 'mousemove', this._onMouseMoveHandler, { capture: true })
    }

    private _removeListeners(): void {
        if (!window || !document) {
            return
        }

        if (this._onClickHandler) {
            document.removeEventListener('click', this._onClickHandler, { capture: true })
        }

        if (this._onMouseMoveHandler) {
            document.removeEventListener('mousemove', this._onMouseMoveHandler, { capture: true })
        }

        this._initialized = false
    }

    _onClick(event: MouseEvent, type: string = 'click'): void {
        this._queueEvent(event, type)
    }

    private _queueEvent(event: MouseEvent, type: string): void {
        if (this._lazyLoadedHeatmaps) {
            this._lazyLoadedHeatmaps._onClick(event, type)
            return
        }

        if (this._eventQueue.length < MAX_QUEUED_EVENTS) {
            this._eventQueue.push({ event, type, timestamp: Date.now() })
        }
    }

    private _loadScript(cb: () => void): void {
        if (assignableWindow.__PosthogExtensions__?.initHeatmaps) {
            cb()
            return
        }
        assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this.instance, 'heatmaps', (err) => {
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

        if (!this._lazyLoadedHeatmaps && assignableWindow.__PosthogExtensions__?.initHeatmaps) {
            this._lazyLoadedHeatmaps = assignableWindow.__PosthogExtensions__.initHeatmaps(this.instance)
            this._lazyLoadedHeatmaps.start()

            this._processQueuedEvents()
            logger.info('started')
        }
    }

    private _processQueuedEvents(): void {
        if (!this._lazyLoadedHeatmaps || this._eventQueue.length === 0) {
            return
        }

        logger.info(`processing ${this._eventQueue.length} queued events`)

        const queuedEvents = this._eventQueue
        this._eventQueue = []

        for (const { event, type } of queuedEvents) {
            try {
                this._lazyLoadedHeatmaps._onClick(event, type)
            } catch (error) {
                logger.error('Failed to process queued event', error)
            }
        }
    }
}
