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

    constructor(instance: PostHog) {
        this._instance = instance
        this.startIfEnabled()
    }

    /**
     * Whether history events capture is enabled based on client configuration
     */
    public get isEnabled(): boolean {
        return Boolean(this._instance.config.capture_history_events)
    }

    /**
     * Start monitoring History API based on configuration
     */
    public startIfEnabled(): void {
        if (this.isEnabled && !this._initialized) {
            logger.info('History API monitoring enabled, starting...')
            this.monitorHistoryChanges()
        }
    }

    /**
     * Stop monitoring History API events and clean up listeners
     */
    public stop(): void {
        this._popstateListener?.()
        this._popstateListener = undefined

        this._initialized = false

        logger.info('History API monitoring stopped')
    }

    /**
     * Set up listeners for History API methods to capture pageview events for SPA navigation
     */
    public monitorHistoryChanges(): void {
        if (!window || !window.history) {
            return
        }

        // Capture PostHog instance reference for use in closure
        const instance = this._instance
        const isEnabled = () => this.isEnabled

        // Only patch if not already patched
        if (!(window.history.pushState as any)?.__posthog_wrapped__) {
            patch(window.history, 'pushState', (originalPushState: any) => {
                return function (this: History, ...args: any[]) {
                    const result = originalPushState.apply(this, args)
                    try {
                        if (isEnabled()) {
                            instance.capture('$pageview', { navigation_type: 'pushState' })
                        }
                    } catch (error) {
                        logger.error('Error in patched pushState', error)
                    }
                    return result
                }
            })
        }

        // Only patch if not already patched
        if (!(window.history.replaceState as any)?.__posthog_wrapped__) {
            patch(window.history, 'replaceState', (originalReplaceState: any) => {
                return function (this: History, ...args: any[]) {
                    const result = originalReplaceState.apply(this, args)
                    try {
                        if (isEnabled()) {
                            instance.capture('$pageview', { navigation_type: 'replaceState' })
                        }
                    } catch (error) {
                        logger.error('Error in patched replaceState', error)
                    }
                    return result
                }
            })
        }

        // Listen for popstate events from the browser's back/forward buttons
        this._setupPopstateListener()

        this._initialized = true
    }

    /**
     * Set up listener for popstate events to capture browser back/forward navigation
     */
    private _setupPopstateListener(): void {
        if (this._popstateListener) {
            return
        }

        const handler = () => {
            try {
                if (this.isEnabled) {
                    this._instance.capture('$pageview', { navigation_type: 'popstate' })
                }
            } catch (error) {
                logger.error('Error handling popstate event', error)
            }
        }

        addEventListener(window, 'popstate', handler)

        // Create a function to remove the listener
        this._popstateListener = () => {
            if (window) {
                window.removeEventListener('popstate', handler)
            }
        }
    }
}
