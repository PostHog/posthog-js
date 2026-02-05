import { UrlTrigger } from '../../../../types'
import { addEventListener } from '../../../../utils'
import { compileRegexCache, urlMatchesTriggers } from '../../../../utils/policyMatching'
import type { Decider, DeciderContext } from './types'

export class URLDecider implements Decider {
    readonly name = 'url'

    private _context: DeciderContext | null = null
    private _urlTriggers: UrlTrigger[] = []
    private _compiledTriggerRegexes: Map<string, RegExp> = new Map()
    private _lastCheckedUrl: string = ''
    private _triggered: boolean = false

    init(context: DeciderContext): void {
        this._context = context
        this._urlTriggers = context.config?.urlTriggers ?? []

        this._compileRegexCaches()
        this._setupUrlMonitoring()

        this._checkCurrentUrl()
    }

    shouldCapture(): boolean | null {
        if (this._urlTriggers.length === 0) {
            return null
        }
        return this._triggered
    }

    private _compileRegexCaches(): void {
        this._compiledTriggerRegexes = compileRegexCache(this._urlTriggers, 'URL trigger')
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

        const matchesTrigger =
            this._urlTriggers.length > 0 && urlMatchesTriggers(url, this._urlTriggers, this._compiledTriggerRegexes)

        if (matchesTrigger) {
            this._triggered = true
        }
    }

    private _setupUrlMonitoring(): void {
        const win = this._context?.window
        if (!win || this._urlTriggers.length === 0) {
            return
        }

        const checkUrl = () => this._checkCurrentUrl()

        addEventListener(win, 'popstate', checkUrl)
        addEventListener(win, 'hashchange', checkUrl)

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
