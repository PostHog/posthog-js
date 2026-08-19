import { PostHog } from '../posthog-core'
import { EVENT_PAGEVIEW } from '../constants'
import { window } from '@posthog/browser-common/utils/globals'
import { addEventListener } from '@posthog/browser-common/utils/general-utils'
import { logger } from '@posthog/browser-common/utils/logger'
import { patch } from './replay/rrweb-plugins/patch'
import { isObject } from '@posthog/core'
import type { CapturePageviewOptions } from '../types'
import type { Extension } from './types'

type HistoryLocation = Pick<Location, 'pathname' | 'search' | 'hash'>

/**
 * Captures pageviews when selected URL components change through the history API, browser back/forward navigation,
 * or hash navigation.
 */
export class HistoryAutocapture implements Extension {
    private _instance: PostHog
    private _popstateListener: (() => void) | undefined
    private _hashchangeListener: (() => void) | undefined
    private _lastLocation: HistoryLocation | undefined

    constructor(instance: PostHog) {
        this._instance = instance
        this._lastLocation = this._getCurrentLocation()
    }

    initialize() {
        this.startIfEnabled()
    }

    public get isEnabled(): boolean {
        const capturePageview = this._instance.config.capture_pageview
        return capturePageview === 'history_change' || isObject(capturePageview)
    }

    public startIfEnabled(): void {
        if (this.isEnabled) {
            logger.info('History API monitoring enabled, starting...')
            this.monitorHistoryChanges()
        }
    }

    public startIfEnabledOrStop(): void {
        this.stop()
        this._lastLocation = this._getCurrentLocation()
        this.startIfEnabled()
    }

    public stop(): void {
        if (this._popstateListener) {
            this._popstateListener()
        }
        this._popstateListener = undefined

        if (this._hashchangeListener) {
            this._hashchangeListener()
        }
        this._hashchangeListener = undefined

        logger.info('History API monitoring stopped')
    }

    public monitorHistoryChanges(): void {
        if (!window || !window.history) {
            return
        }

        this._patchHistoryMethod('pushState')
        this._patchHistoryMethod('replaceState')

        this._setupPopstateListener()
        if (this._shouldCaptureHashChanges()) {
            this._setupHashchangeListener()
        }
    }

    private _patchHistoryMethod(method: 'pushState' | 'replaceState'): void {
        if (!window || (window.history[method] as any)?.__posthog_wrapped__) {
            return
        }

        // Old fashioned, we could also use arrow functions but I think the closure for a patch is more reliable
        const self = this
        patch(window.history, method, (originalMethod) => {
            return function patchedHistoryMethod(
                this: History,
                state: any,
                title: string,
                url?: string | URL | null
            ): void {
                ;(originalMethod as (state: any, title: string, url?: string | URL | null) => void).call(
                    this,
                    state,
                    title,
                    url
                )
                self._capturePageview(method)
            }
        })
    }

    private _getCurrentLocation(): HistoryLocation | undefined {
        const location = window?.location

        if (!location?.pathname) {
            return
        }

        return {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
        }
    }

    private _getCaptureOptions(): CapturePageviewOptions {
        const capturePageview = this._instance.config.capture_pageview

        if (capturePageview === 'history_change') {
            return { path: true }
        }

        return isObject(capturePageview) ? capturePageview : {}
    }

    private _shouldCaptureHashChanges(): boolean {
        return !!this._getCaptureOptions().hash && !this._instance.config.disable_capture_url_hashes
    }

    private _hasLocationChanged(currentLocation: HistoryLocation): boolean {
        const options = this._getCaptureOptions()
        const lastLocation = this._lastLocation

        return !!(
            lastLocation &&
            ((options.path && currentLocation.pathname !== lastLocation.pathname) ||
                (options.search && currentLocation.search !== lastLocation.search) ||
                (this._shouldCaptureHashChanges() && currentLocation.hash !== lastLocation.hash))
        )
    }

    private _capturePageview(navigationType: 'pushState' | 'replaceState' | 'popstate' | 'hashchange'): void {
        try {
            const currentLocation = this._getCurrentLocation()

            if (!currentLocation) {
                return
            }

            if (this.isEnabled && this._hasLocationChanged(currentLocation)) {
                this._instance.capture(EVENT_PAGEVIEW, { navigation_type: navigationType })
            }

            this._lastLocation = currentLocation
        } catch (error) {
            logger.error(`Error capturing ${navigationType} pageview`, error)
        }
    }

    private _setupPopstateListener(): void {
        if (this._popstateListener) {
            return
        }

        const handler = () => {
            this._capturePageview('popstate')
        }

        addEventListener(window, 'popstate', handler)
        this._popstateListener = () => {
            if (window) {
                window.removeEventListener('popstate', handler)
            }
        }
    }

    private _setupHashchangeListener(): void {
        if (this._hashchangeListener) {
            return
        }

        const handler = () => {
            this._capturePageview('hashchange')
        }

        addEventListener(window, 'hashchange', handler)
        this._hashchangeListener = () => {
            if (window) {
                window.removeEventListener('hashchange', handler)
            }
        }
    }
}
