import { UrlTrigger } from '../../../../types'
import { addEventListener } from '../../../../utils'
import { compileRegexCache, urlMatchesTriggers } from '../../../../utils/policyMatching'
import type { Trigger, TriggerOptions } from './types'
import type { PersistenceHelper } from './persistence'

export class URLTrigger implements Trigger {
    readonly name = 'url'

    private readonly _window: Window | undefined
    private readonly _urlTriggers: UrlTrigger[]
    private readonly _persistence: PersistenceHelper

    private _compiledTriggerRegexes: Map<string, RegExp> = new Map()
    private _lastCheckedUrl: string = ''
    private _matchedUrlInSession: boolean = false

    constructor(options: TriggerOptions, urlTriggers: UrlTrigger[]) {
        this._window = options.window
        this._urlTriggers = urlTriggers
        this._persistence = options.persistenceHelperFactory.create('url')

        this._compileRegexCaches()
        this._setupUrlMonitoring()
        this._checkCurrentUrl()
    }

    matches(sessionId: string): boolean | null {
        if (this._urlTriggers.length === 0) {
            return null
        }

        // Check if already triggered for this session (from persistence)
        if (this._persistence.sessionMatchesTrigger(sessionId)) {
            return true
        }

        // Check if we matched a URL in this session (in-memory)
        if (this._matchedUrlInSession) {
            this._persistence.matchTriggerInSession(sessionId)
            return true
        }

        return false
    }

    private _compileRegexCaches(): void {
        this._compiledTriggerRegexes = compileRegexCache(this._urlTriggers, 'URL trigger')
    }

    private _getCurrentUrl(): string | null {
        return this._window?.location?.href ?? null
    }

    private _checkCurrentUrl(): void {
        if (this._matchedUrlInSession) {
            return // Already matched
        }

        const url = this._getCurrentUrl()
        if (!url || url === this._lastCheckedUrl) {
            return
        }
        this._lastCheckedUrl = url

        const matchesTrigger =
            this._urlTriggers.length > 0 && urlMatchesTriggers(url, this._urlTriggers, this._compiledTriggerRegexes)

        if (matchesTrigger) {
            this._matchedUrlInSession = true
        }
    }

    private _setupUrlMonitoring(): void {
        const win = this._window
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
