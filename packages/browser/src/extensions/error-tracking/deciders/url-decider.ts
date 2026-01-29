import type { SDKPolicyConfigUrlTrigger } from '../../../types'
import { urlMatchesTriggers, compileRegexCache } from '../../../utils/policyMatching'
import type { Decider, DeciderContext } from './types'

/**
 * URL Decider - handles URL-based blocking and triggering.
 *
 * State:
 * - Starts unblocked (capture allowed)
 * - Visiting a blocklisted URL → blocked
 * - Visiting a trigger URL → unblocked
 */
export class URLDecider implements Decider {
    readonly name = 'url'

    private _context: DeciderContext | null = null
    private _urlTriggers: SDKPolicyConfigUrlTrigger[] = []
    private _urlBlocklist: SDKPolicyConfigUrlTrigger[] = []
    private _compiledTriggerRegexes: Map<string, RegExp> = new Map()
    private _compiledBlocklistRegexes: Map<string, RegExp> = new Map()
    private _lastCheckedUrl: string = ''
    private _blocked: boolean = false

    init(context: DeciderContext): void {
        this._context = context

        const config = context.config.errorTracking
        this._urlTriggers = config?.url_triggers ?? []
        this._urlBlocklist = config?.url_blocklist ?? []

        this._compileRegexCaches()
        this._setupUrlMonitoring()

        this._log('Initialized', {
            triggerPatterns: this._urlTriggers.length,
            blocklistPatterns: this._urlBlocklist.length,
        })

        this._checkCurrentUrl()
    }

    shouldCapture(): boolean | null {
        if (this._urlTriggers.length === 0 && this._urlBlocklist.length === 0) {
            return null
        }
        return !this._blocked
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

        this._log('URL checked', { url, matchesBlocklist, matchesTrigger })

        if (matchesBlocklist) {
            this._blocked = true
            this._log('BLOCKED', { url })
        } else if (matchesTrigger) {
            this._blocked = false
            this._log('UNBLOCKED', { url })
        }
    }

    private _setupUrlMonitoring(): void {
        const win = this._context?.window
        if (!win || (this._urlTriggers.length === 0 && this._urlBlocklist.length === 0)) {
            return
        }

        const checkUrl = () => this._checkCurrentUrl()

        win.addEventListener('popstate', checkUrl)
        win.addEventListener('hashchange', checkUrl)

        if (win.history) {
            const originalPushState = win.history.pushState.bind(win.history)
            const originalReplaceState = win.history.replaceState.bind(win.history)

            win.history.pushState = function (...args) {
                originalPushState(...args)
                checkUrl()
            }

            win.history.replaceState = function (...args) {
                originalReplaceState(...args)
                checkUrl()
            }
        }
    }
}
