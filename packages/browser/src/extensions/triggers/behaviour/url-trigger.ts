import type { PostHog } from '@posthog/types'
import { UrlTrigger } from '../../../types'
import { addEventListener } from '../../../utils'
import { logger } from '../../../utils/logger'
import type { Trigger, TriggerOptions } from './types'
import type { PersistenceHelper } from './persistence'

function urlMatchesTriggers(url: string, triggers: UrlTrigger[], compiledRegexCache?: Map<string, RegExp>): boolean {
    return triggers.some((trigger) => {
        switch (trigger.matching) {
            case 'regex': {
                const regex = compiledRegexCache?.get(trigger.url) ?? new RegExp(trigger.url)
                return regex.test(url)
            }
            default:
                return false
        }
    })
}

function compileRegexCache(triggers: UrlTrigger[], logPrefix?: string): Map<string, RegExp> {
    const cache = new Map<string, RegExp>()

    for (const trigger of triggers) {
        if (trigger.matching === 'regex' && !cache.has(trigger.url)) {
            try {
                cache.set(trigger.url, new RegExp(trigger.url))
            } catch (e) {
                logger.error(`${logPrefix ? logPrefix + ' ' : ''}Invalid regex pattern:`, trigger.url, e)
            }
        }
    }

    return cache
}

export class URLTrigger implements Trigger {
    readonly name = 'url'
    urlTriggers: UrlTrigger[] = []

    private readonly _window: Window | undefined
    private readonly _persistence: PersistenceHelper
    private readonly _posthog: PostHog
    private _monitoringSetUp = false

    private _compiledTriggerRegexes: Map<string, RegExp> = new Map()
    private _lastCheckedUrl: string = ''

    constructor(options: TriggerOptions) {
        this._window = options.window
        this._persistence = options.persistence.withPrefix('url')
        this._posthog = options.posthog
    }

    init(urlTriggers: UrlTrigger[]): void {
        this.urlTriggers = urlTriggers
        this._lastCheckedUrl = ''

        this._compileRegexCaches()

        if (!this._monitoringSetUp && this.urlTriggers.length > 0) {
            this._monitoringSetUp = true
            this._setupUrlMonitoring()
        }

        this._checkCurrentUrl()
    }

    matches(sessionId: string): boolean | null {
        if (this.urlTriggers.length === 0) {
            return null
        }

        return this._persistence.isTriggered(sessionId)
    }

    clearPersistedState(): void {
        this._persistence.clear()
    }

    private _compileRegexCaches(): void {
        this._compiledTriggerRegexes = compileRegexCache(this.urlTriggers, 'URL trigger')
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
            this.urlTriggers.length > 0 && urlMatchesTriggers(url, this.urlTriggers, this._compiledTriggerRegexes)

        if (matchesTrigger) {
            this._persistence.setTriggered(this._posthog.get_session_id())
        }
    }

    private _setupUrlMonitoring(): void {
        const win = this._window
        if (!win || this.urlTriggers.length === 0) {
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
