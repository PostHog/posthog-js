import type { RemoteConfig, SDKPolicyConfigUrlTrigger } from '../../../types'
import { urlMatchesTriggers, compileRegexCache } from '../../../utils/policyMatching'
import type { Decider, DeciderContext, DeciderResult } from './types'

// Store original history methods at module level for proper cleanup
let originalPushState: typeof history.pushState | null = null
let originalReplaceState: typeof history.replaceState | null = null

/**
 * URL Decider - handles URL-based ingestion control.
 *
 * Logic:
 * - By default, allows capture
 * - Visiting a blocklisted URL → blocks capture
 * - Visiting a trigger URL → unblocks capture
 */
export class URLDecider implements Decider {
    readonly name = 'url'

    private _context: DeciderContext | null = null
    private _urlTriggers: SDKPolicyConfigUrlTrigger[] = []
    private _urlBlocklist: SDKPolicyConfigUrlTrigger[] = []
    private _compiledTriggerRegexes: Map<string, RegExp> = new Map()
    private _compiledBlocklistRegexes: Map<string, RegExp> = new Map()

    private _blocked: boolean = false
    private _lastCheckedUrl: string = ''
    private _cleanupFn: (() => void) | null = null

    init(context: DeciderContext, config: RemoteConfig): void {
        this._context = context

        const errorTracking = config.errorTracking
        this._urlTriggers = errorTracking?.url_triggers ?? []
        this._urlBlocklist = errorTracking?.url_blocklist ?? []

        this._compileRegexCaches()
        this._setupUrlMonitoring()

        this._log('Initialized', {
            triggerPatterns: this._urlTriggers.length,
            blocklistPatterns: this._urlBlocklist.length,
        })

        // Check initial URL
        this._checkCurrentUrl()
    }

    evaluate(): DeciderResult | null {
        // No URL config = no opinion
        if (this._urlTriggers.length === 0 && this._urlBlocklist.length === 0) {
            return null
        }

        return {
            shouldCapture: !this._blocked,
            reason: this._blocked ? 'URL is currently blocked' : 'URL allows capture',
        }
    }

    /**
     * Called externally when a trigger condition is met (e.g., event trigger).
     * Allows other deciders to unblock URL state.
     */
    unblock(): void {
        if (this._blocked) {
            this._blocked = false
            this._log('Externally unblocked')
        }
    }

    shutdown(): void {
        this._cleanupFn?.()
        this._cleanupFn = null
        this._lastCheckedUrl = ''
        this._blocked = false
    }

    private _log(message: string, data?: Record<string, unknown>): void {
        this._context?.log(`[${this.name}] ${message}`, data)
    }

    private _compileRegexCaches(): void {
        this._compiledTriggerRegexes = compileRegexCache(this._urlTriggers, 'URL trigger')
        this._compiledBlocklistRegexes = compileRegexCache(this._urlBlocklist, 'URL blocklist')
    }

    private _getCurrentUrl(): string | null {
        return this._context?.window?.location?.href ?? null
    }

    private _checkCurrentUrl(): void {
        const url = this._getCurrentUrl()
        if (!url || url === this._lastCheckedUrl) {
            return
        }
        this._lastCheckedUrl = url

        const matchesBlocklist =
            this._urlBlocklist.length > 0 &&
            urlMatchesTriggers(url, this._urlBlocklist, this._compiledBlocklistRegexes)

        const matchesTrigger =
            this._urlTriggers.length > 0 &&
            urlMatchesTriggers(url, this._urlTriggers, this._compiledTriggerRegexes)

        this._log('URL checked', {
            url,
            matchesBlocklist,
            matchesTrigger,
            wasBlocked: this._blocked,
        })

        if (matchesBlocklist && !this._blocked) {
            this._blocked = true
            this._log('BLOCKED - URL matches blocklist', { url })
        } else if (matchesTrigger && this._blocked) {
            this._blocked = false
            this._log('UNBLOCKED - URL matches trigger', { url })
        }
    }

    private _setupUrlMonitoring(): void {
        this._cleanupFn?.()

        const win = this._context?.window
        if (!win || (this._urlTriggers.length === 0 && this._urlBlocklist.length === 0)) {
            return
        }

        const checkUrl = () => this._checkCurrentUrl()

        // Listen for navigation events
        win.addEventListener('popstate', checkUrl)
        win.addEventListener('hashchange', checkUrl)

        // Wrap history methods for SPA navigation
        if (win.history) {
            if (!originalPushState) {
                originalPushState = win.history.pushState.bind(win.history)
            }
            if (!originalReplaceState) {
                originalReplaceState = win.history.replaceState.bind(win.history)
            }

            win.history.pushState = function (...args) {
                originalPushState?.apply(this, args)
                checkUrl()
            }

            win.history.replaceState = function (...args) {
                originalReplaceState?.apply(this, args)
                checkUrl()
            }
        }

        this._cleanupFn = () => {
            win.removeEventListener('popstate', checkUrl)
            win.removeEventListener('hashchange', checkUrl)

            if (originalPushState && win.history) {
                win.history.pushState = originalPushState
            }
            if (originalReplaceState && win.history) {
                win.history.replaceState = originalReplaceState
            }
        }
    }
}
