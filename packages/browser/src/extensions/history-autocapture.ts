import { PostHog } from '../posthog-core'
import { EVENT_PAGEVIEW } from '../constants'
import { window } from '@posthog/browser-common/utils/globals'
import { addEventListener } from '@posthog/browser-common/utils/general-utils'
import { logger } from '@posthog/browser-common/utils/logger'
import { patch } from './replay/rrweb-plugins/patch'
import { isObject } from '@posthog/core'
import { maskUrl } from '@posthog/browser-common/utils/event-utils'
import { isAwaitingConsent } from '../consent'
import type { Properties } from '@posthog/types'
import type { CapturePageviewOptions } from '../types'
import type { Extension } from './types'

type HistoryLocation = Pick<Location, 'pathname' | 'search' | 'hash'>

type NavigationType = 'pushState' | 'replaceState' | 'popstate' | 'hashchange'

type PendingPageview = { properties: Properties; timestamp: Date }

// A consent banner usually closes within seconds, so this only has to cover a short burst of
// navigation. The cap keeps a page that never gets consent from growing the buffer without limit.
const MAX_PENDING_PAGEVIEWS = 50

/**
 * Captures pageviews when selected URL components change through the history API, browser back/forward navigation,
 * or hash navigation.
 */
export class HistoryAutocapture implements Extension {
    private _instance: PostHog
    private _popstateListener: (() => void) | undefined
    private _hashchangeListener: (() => void) | undefined
    private _lastLocation: HistoryLocation | undefined
    private _pendingPageviews: PendingPageview[] = []

    constructor(instance: PostHog) {
        this._instance = instance
        this._lastLocation = this._getCurrentLocation()
    }

    initialize() {
        this.startIfEnabled()
    }

    public get isEnabled(): boolean {
        const options = this._getCaptureOptions()
        return !!(options.path || options.search || this._shouldCaptureHashChanges(options))
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

    private _shouldCaptureHashChanges(options: CapturePageviewOptions = this._getCaptureOptions()): boolean {
        return !!options.hash && !this._instance.config.disable_capture_url_hashes
    }

    private _hasLocationChanged(currentLocation: HistoryLocation): boolean {
        const options = this._getCaptureOptions()
        const lastLocation = this._lastLocation

        return !!(
            lastLocation &&
            ((options.path && currentLocation.pathname !== lastLocation.pathname) ||
                (options.search && currentLocation.search !== lastLocation.search) ||
                (this._shouldCaptureHashChanges(options) && currentLocation.hash !== lastLocation.hash))
        )
    }

    private _capturePageview(navigationType: NavigationType): void {
        try {
            const currentLocation = this._getCurrentLocation()

            if (!currentLocation) {
                return
            }

            if (this._hasLocationChanged(currentLocation)) {
                if (isAwaitingConsent(this._instance)) {
                    // capture() drops the event before it is built while consent is pending, so hold
                    // the navigation and send it once the user opts in.
                    this._addPendingPageview(navigationType)
                } else {
                    this._instance.capture(EVENT_PAGEVIEW, { navigation_type: navigationType })
                }
            }

            this._lastLocation = currentLocation
        } catch (error) {
            logger.error(`Error capturing ${navigationType} pageview`, error)
        }
    }

    private _addPendingPageview(navigationType: NavigationType): void {
        const { mask_personal_data_properties, custom_personal_data_properties, disable_capture_url_hashes } =
            this._instance.config

        this._pendingPageviews.push({
            // The URL and the path have to travel with the event: by the time it is sent the user
            // has navigated on, so `location` no longer describes this navigation.
            properties: {
                navigation_type: navigationType,
                $current_url: maskUrl(
                    window?.location?.href,
                    mask_personal_data_properties,
                    custom_personal_data_properties,
                    disable_capture_url_hashes
                ),
                $pathname: window?.location?.pathname,
            },
            timestamp: new Date(),
        })

        if (this._pendingPageviews.length > MAX_PENDING_PAGEVIEWS) {
            this._pendingPageviews.shift()
        }
    }

    /**
     * Sends the navigations that happened while consent was pending, each with the timestamp and the
     * URL it was seen at.
     */
    public flushPendingPageviews(): void {
        const pending = this._pendingPageviews
        this._pendingPageviews = []

        for (const { properties, timestamp } of pending) {
            this._instance.capture(EVENT_PAGEVIEW, properties, { timestamp })
        }
    }

    /** Drops the held navigations, for when the user rejects consent rather than granting it. */
    public discardPendingPageviews(): void {
        this._pendingPageviews = []
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
