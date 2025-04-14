import { PostHog } from '../posthog-core'
import { window } from '../utils/globals'
import { addEventListener } from '../utils'
import { logger } from '../utils/logger'
import { patch } from './replay/rrweb-plugins/patch'

/**
 * This class is used to capture pageview events when the user navigates using the history API (pushState, replaceState)
 * and when the user navigates using the browser's back/forward buttons.
 *
 * The behavior is controlled by the `capture_pageview` configuration option:
 * - When set to `'history_change'`, this class will capture pageviews on history API changes
 */
export class HistoryAutocapture {
    private _instance: PostHog
    private _popstateListener: (() => void) | undefined
    private _lastPathname: string

    constructor(instance: PostHog) {
        this._instance = instance
        this._lastPathname = window?.location?.pathname || ''
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
        logger.info('History API monitoring stopped')
    }

    public monitorHistoryChanges(): void {
        if (!window || !window.history) {
            return
        }

        // Old fashioned, we could also use arrow functions but I think the closure for a patch is more reliable
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this

        if (!(window.history.pushState as any)?.__posthog_wrapped__) {
            patch(window.history, 'pushState', (originalPushState) => {
                return function patchedPushState(
                    this: History,
                    state: any,
                    title: string,
                    url?: string | URL | null
                ): void {
                    ;(originalPushState as History['pushState']).call(this, state, title, url)
                    self._capturePageview('pushState')
                }
            })
        }

        if (!(window.history.replaceState as any)?.__posthog_wrapped__) {
            patch(window.history, 'replaceState', (originalReplaceState) => {
                return function patchedReplaceState(
                    this: History,
                    state: any,
                    title: string,
                    url?: string | URL | null
                ): void {
                    ;(originalReplaceState as History['replaceState']).call(this, state, title, url)
                    self._capturePageview('replaceState')
                }
            })
        }

        this._setupPopstateListener()
    }

    private _capturePageview(navigationType: 'pushState' | 'replaceState' | 'popstate'): void {
        try {
            const currentPathname = window?.location?.pathname

            if (!currentPathname) {
                return
            }

            // Only capture pageview if the pathname has changed and the feature is enabled
            if (currentPathname !== this._lastPathname && this.isEnabled) {
                this._instance.capture('$pageview', { navigation_type: navigationType })
            }

            this._lastPathname = currentPathname
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
}
