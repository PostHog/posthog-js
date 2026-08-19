import { PostHog } from '../posthog-core'
import { EVENT_PAGEVIEW } from '../constants'
import { window } from '@posthog/browser-common/utils/globals'
import { addEventListener } from '@posthog/browser-common/utils/general-utils'
import { logger } from '@posthog/browser-common/utils/logger'
import { patch } from './replay/rrweb-plugins/patch'
import type { Extension } from './types'

/**
 * This class is used to capture pageview events when the user navigates using the history API (pushState, replaceState),
 * when the user navigates using the browser's back/forward buttons, and when only the URL fragment changes
 * (e.g. hash-based routing or in-page anchor links, which fire `hashchange` rather than `popstate`).
 *
 * The behavior is controlled by the `capture_pageview` configuration option:
 * - When set to `'history_change'`, this class will capture pageviews on history API changes
 */
export class HistoryAutocapture implements Extension {
    private _instance: PostHog
    private _popstateListener: (() => void) | undefined
    private _hashchangeListener: (() => void) | undefined
    private _lastLocation: string

    constructor(instance: PostHog) {
        this._instance = instance
        this._lastLocation = this._getComparableLocation()
    }

    initialize() {
        this.startIfEnabled()
    }

    public get isEnabled(): boolean {
        return this._instance.config.capture_pageview === 'history_change'
    }

    public startIfEnabled(): void {
        if (this.isEnabled) {
            logger.info('History API monitoring enabled, starting...')
            this.monitorHistoryChanges()
        }
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
        this._setupHashchangeListener()
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

    private _getComparableLocation(): string {
        const location = window?.location

        if (!location?.pathname) {
            return ''
        }

        const hash = this._instance.config.disable_capture_url_hashes ? '' : location.hash

        return location.pathname + location.search + hash
    }

    private _capturePageview(navigationType: 'pushState' | 'replaceState' | 'popstate' | 'hashchange'): void {
        try {
            const currentLocation = this._getComparableLocation()

            if (!currentLocation) {
                return
            }

            // Only capture pageview if the URL (path, query, and hash) has changed and the feature is enabled
            if (currentLocation !== this._lastLocation && this.isEnabled) {
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

        // Direct `location.hash` changes and in-page anchor navigations fire `hashchange`, not
        // `popstate` and not the patched `pushState`/`replaceState`. Without this listener, a
        // hash-only navigation would neither emit a `$pageview` nor keep `_lastLocation` in sync,
        // leaving it stale so a later same-URL history call would look like a change and capture a
        // false pageview. (When `disable_capture_url_hashes` is set, `_getComparableLocation`
        // strips the hash, so this handler correctly stays a no-op.)
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
