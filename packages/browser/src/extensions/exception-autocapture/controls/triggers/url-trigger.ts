import { UrlTrigger } from '../../../../types'
import { addEventListener } from '../../../../utils'
import { compileRegexCache, urlMatchesTriggers } from '../../../../utils/policyMatching'
import type { Trigger, LogFn } from './types'

export interface URLTriggerOptions {
    readonly window: Window | undefined
    readonly log: LogFn
}

export class URLTrigger implements Trigger {
    readonly name = 'url'

    private _window: Window | undefined
    private _urlTriggers: UrlTrigger[] = []
    private _compiledTriggerRegexes: Map<string, RegExp> = new Map()
    private _lastCheckedUrl: string = ''
    private _triggered: boolean = false
    private _initialized: boolean = false
    private _originalPushState: History['pushState'] | null = null
    private _originalReplaceState: History['replaceState'] | null = null

    init(urlTriggers: UrlTrigger[], options: URLTriggerOptions): void {
        if (this._initialized) {
            this._teardownUrlMonitoring()
        }

        this._window = options.window
        this._urlTriggers = urlTriggers
        this._compiledTriggerRegexes = new Map()
        this._lastCheckedUrl = ''
        this._triggered = false

        this._compileRegexCaches()
        this._setupUrlMonitoring()
        this._checkCurrentUrl()

        this._initialized = true
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
        return this._window?.location?.href ?? null
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
