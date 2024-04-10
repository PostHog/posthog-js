import { _register_event } from './utils'
import RageClick from './extensions/rageclick'
import { Properties } from './types'
import { PostHog } from './posthog-core'

import { document, window } from './utils/globals'

export class Heatmaps {
    instance: PostHog
    rageclicks = new RageClick()
    _isDisabledServerSide: boolean | null = null
    _initialized = false
    _mouseMoveTimeout: number | undefined

    constructor(instance: PostHog) {
        this.instance = instance

        if (this.isEnabled) {
            this._setupListeners()
        }
    }

    public get isEnabled(): boolean {
        return !!this.instance.config.__preview_heatmaps
    }

    private _setupListeners(): void {
        if (!window || !document) {
            return
        }

        _register_event(document, 'click', (e) => this._onClick((e || window?.event) as MouseEvent), false, true)
        _register_event(
            document,
            'mousemove',
            (e) => this._onMouseMove((e || window?.event) as MouseEvent),
            false,
            true
        )
    }

    private _getProperties(e: MouseEvent): Properties {
        return {
            $mouse_x: e.clientX,
            $mouse_y: e.clientY,
        }
    }

    private _onClick(e: MouseEvent): void {
        const properties = this._getProperties(e)

        if (this.rageclicks?.isRageClick(e.clientX, e.clientY, new Date().getTime())) {
            this._capture({
                ...properties,
                $heatmap_event: 'rageclick',
            })
        }

        // TODO: Detect deadclicks

        this._capture({
            ...properties,
            $heatmap_event: 'click',
        })
    }

    private _onMouseMove(e: Event): void {
        const properties = this._getProperties(e as MouseEvent)

        clearTimeout(this._mouseMoveTimeout)

        this._mouseMoveTimeout = setTimeout(() => {
            this._capture({
                ...properties,
                $heatmap_event: 'mousemove',
            })
        }, 1000)
    }

    private _capture(properties: Properties): void {
        this.instance.capture('$heatmap', properties, {
            _batchKey: 'heatmaps',
        })
    }
}
