import { PostHog } from '../posthog-core'
import { window } from '../utils/globals'
import { addEventListener } from '../utils'
import { logger } from '../utils/logger'
import { patch } from './replay/rrweb-plugins/patch'

/**
 * This class is used to capture pageview events when the user navigates using the history API (pushState, replaceState).
 * It is also used to capture pageview events when the user navigates using the browser's back/forward buttons.
 */
export class HistoryAutocapture {
    private _instance: PostHog
    private _initialized = false
    private _popstateListener: (() => void) | undefined
    private _lastPathname: string | undefined

    constructor(instance: PostHog) {
        this._instance = instance
        this._lastPathname = window?.location?.pathname
    }

    public get isEnabled(): boolean {
        const config = this._instance.config.capture_history_events
        return config === 'always' || config === 'pathname'
    }

    public startIfEnabled(): void {
        if (this.isEnabled && !this._initialized) {
            logger.info('History API monitoring enabled, starting...')
            this.monitorHistoryChanges()
        }
    }

    public stop(): void {
        if (this._popstateListener) {
            this._popstateListener()
        }
        this._popstateListener = undefined
        this._initialized = false
        logger.info('History API monitoring stopped')
    }

    public monitorHistoryChanges(): void {
        if (!window || !window.history) {
            return
        }

        const instance = this

        if (!(window.history.pushState as any)?.__posthog_wrapped__) {
            patch(window.history, 'pushState', (originalPushState: any) => {
                return function (this: History, ...args: any[]) {
                    const result = originalPushState.apply(this, args)
                    instance.capturePageview('pushState')
                    return result
                }
            })
        }

        if (!(window.history.replaceState as any)?.__posthog_wrapped__) {
            patch(window.history, 'replaceState', (originalReplaceState: any) => {
                return function (this: History, ...args: any[]) {
                    const result = originalReplaceState.apply(this, args)
                    instance.capturePageview('replaceState')
                    return result
                }
            })
        }

        this._setupPopstateListener()
        this._initialized = true
    }

    private capturePageview(navigationType: 'pushState' | 'replaceState' | 'popstate'): void {
        try {
            if (this.shouldCaptureHistoryChange()) {
                this._instance.capture('$pageview', { navigation_type: navigationType })
            }
        } catch (error) {
            logger.error(`Error capturing ${navigationType} pageview`, error)
        }
    }

    private shouldCaptureHistoryChange(): boolean {
        const config = this._instance.config.capture_history_events

        if (config === 'never') {
            return false
        }

        if (config === 'always') {
            return true
        }

        // If config is 'pathname', we only capture if the pathname changed
        if (config === 'pathname') {
            const currentPathname = window?.location?.pathname
            if (currentPathname !== this._lastPathname) {
                this._lastPathname = currentPathname
                return true
            }
            return false
        }

        return false
    }

    private _setupPopstateListener(): void {
        if (this._popstateListener) {
            return
        }

        const handler = () => this.capturePageview('popstate')

        addEventListener(window, 'popstate', handler)

        this._popstateListener = () => {
            if (window) {
                window.removeEventListener('popstate', handler)
            }
        }
    }
}
