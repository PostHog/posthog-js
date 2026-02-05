import { UrlTrigger } from '../../../../types'
import { addEventListener } from '../../../../utils'
import { compileRegexCache, urlMatchesTriggers } from '../../../../utils/policyMatching'
import type { Trigger, LogFn, GetPersistedSessionId, SetPersistedSessionId } from './types'

export interface URLTriggerOptions {
    readonly window: Window | undefined
    readonly log: LogFn
    readonly getPersistedSessionId?: GetPersistedSessionId
    readonly setPersistedSessionId?: SetPersistedSessionId
}

export class URLTrigger implements Trigger {
    readonly name = 'url'

    private _window: Window | undefined
    private _urlTriggers: UrlTrigger[] = []
    private _compiledTriggerRegexes: Map<string, RegExp> = new Map()
    private _lastCheckedUrl: string = ''
    private _matchedUrlInSession: boolean = false
    private _initialized: boolean = false
    private _originalPushState: History['pushState'] | null = null
    private _originalReplaceState: History['replaceState'] | null = null
    private _getPersistedSessionId: GetPersistedSessionId | undefined
    private _setPersistedSessionId: SetPersistedSessionId | undefined

    init(urlTriggers: UrlTrigger[], options: URLTriggerOptions): void {
        if (this._initialized) {
            this._teardownUrlMonitoring()
        }

        this._window = options.window
        this._urlTriggers = urlTriggers
        this._compiledTriggerRegexes = new Map()
        this._lastCheckedUrl = ''
        this._matchedUrlInSession = false
        this._getPersistedSessionId = options.getPersistedSessionId
        this._setPersistedSessionId = options.setPersistedSessionId

        this._compileRegexCaches()
        this._setupUrlMonitoring()
        this._checkCurrentUrl()

        this._initialized = true
    }

    matches(sessionId: string): boolean | null {
        if (this._urlTriggers.length === 0) {
            return null
        }

        // Check if already triggered for this session (from persistence)
        const persistedSessionId = this._getPersistedSessionId?.()
        if (persistedSessionId === sessionId) {
            return true
        }

        // Check if we matched a URL in this session (in-memory)
        if (this._matchedUrlInSession) {
            this._setPersistedSessionId?.(sessionId)
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
            this._originalPushState = win.history.pushState.bind(win.history)
            this._originalReplaceState = win.history.replaceState.bind(win.history)

            const originalPushState = this._originalPushState
            const originalReplaceState = this._originalReplaceState

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

    private _teardownUrlMonitoring(): void {
        const win = this._window
        if (!win?.history) {
            return
        }

        if (this._originalPushState) {
            win.history.pushState = this._originalPushState
        }
        if (this._originalReplaceState) {
            win.history.replaceState = this._originalReplaceState
        }

        this._originalPushState = null
        this._originalReplaceState = null
    }
}
