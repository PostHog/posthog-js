/* Store some session-level attribution-related properties in the persistence layer
 *
 * These have the same lifespan as a session_id, meaning that if the session_id changes, these properties will be reset.
 *
 * We only store the entry URL and referrer, and derive many props (such as utm tags) from those.
 *
 * Given that the cookie is limited to 4K bytes, we don't want to store too much data, so we chose not to store device
 * properties (such as browser, OS, etc) here, as usually getting the current value of those from event properties is
 * sufficient.
 */
import { getPersonInfo, getPersonPropsFromInfo } from './utils/event-utils'
import type { SessionIdManager } from './sessionid'
import type { PostHogPersistence } from './posthog-persistence'
import { CLIENT_SESSION_PROPS } from './constants'
import type { PostHog } from './posthog-core'
import { stripEmptyProperties } from './utils'
import { stripLeadingDollar, isString, isNumber } from '@posthog/core'

interface LegacySessionSourceProps {
    initialPathName: string
    referringDomain: string // Is actually referring host, but named referring domain for internal consistency. Should contain a port if there is one.
    utm_medium?: string
    utm_source?: string
    utm_campaign?: string
    utm_content?: string
    utm_term?: string
}

interface CurrentSessionSourceProps {
    r: string // Referring host
    u: string | undefined // full URL
}

interface StoredSessionSourceProps {
    sessionId: string
    props: LegacySessionSourceProps | CurrentSessionSourceProps
}

const generateSessionSourceParams = (posthog?: PostHog): LegacySessionSourceProps | CurrentSessionSourceProps => {
    return getPersonInfo(posthog?.config.mask_personal_data_properties, posthog?.config.custom_personal_data_properties)
}

export class SessionPropsManager {
    private readonly _instance: PostHog
    private readonly _sessionIdManager: SessionIdManager
    private readonly _persistence: PostHogPersistence
    private readonly _sessionSourceParamGenerator: (
        instance?: PostHog
    ) => LegacySessionSourceProps | CurrentSessionSourceProps
    private _cachedSessionProps: Record<string, any> | null = null

    constructor(
        instance: PostHog,
        sessionIdManager: SessionIdManager,
        persistence: PostHogPersistence,
        sessionSourceParamGenerator?: (instance?: PostHog) => LegacySessionSourceProps | CurrentSessionSourceProps
    ) {
        this._instance = instance
        this._sessionIdManager = sessionIdManager
        this._persistence = persistence
        this._sessionSourceParamGenerator = sessionSourceParamGenerator || generateSessionSourceParams

        this._sessionIdManager.onSessionId(this._onSessionIdCallback)
    }

    _getStored(): StoredSessionSourceProps | undefined {
        return this._persistence.props[CLIENT_SESSION_PROPS]
    }

    _onSessionIdCallback = (sessionId: string) => {
        const stored = this._getStored()
        if (stored && stored.sessionId === sessionId) {
            return
        }

        // Invalidate cached session props when session changes
        this._cachedSessionProps = null

        const newProps: StoredSessionSourceProps = {
            sessionId,
            props: this._sessionSourceParamGenerator(this._instance),
        }
        this._persistence.register({ [CLIENT_SESSION_PROPS]: newProps })
    }

    getSetOnceProps() {
        const p = this._getStored()?.props
        if (!p) {
            return {}
        }
        if ('r' in p) {
            return getPersonPropsFromInfo(p)
        } else {
            return {
                $referring_domain: p.referringDomain,
                $pathname: p.initialPathName,
                utm_source: p.utm_source,
                utm_campaign: p.utm_campaign,
                utm_medium: p.utm_medium,
                utm_content: p.utm_content,
                utm_term: p.utm_term,
            }
        }
    }

    getSessionProps() {
        // Cache session props since they only change when the session changes
        if (this._cachedSessionProps) {
            return this._cachedSessionProps
        }

        // it's the same props, but don't include null for unset properties, and add a prefix
        const setOnceProps = this.getSetOnceProps()
        const p: Record<string, any> = {}
        const keys = Object.keys(setOnceProps)
        for (let i = 0; i < keys.length; i++) {
            let k = keys[i]
            const v = setOnceProps[k]
            // only include non-empty string or number values
            if ((isString(v) && v.length > 0) || isNumber(v)) {
                if (k === '$current_url') {
                    // $session_entry_current_url would be a weird name, call it $session_entry_url instead
                    k = 'url'
                }
                p[`$session_entry_${stripLeadingDollar(k)}`] = v
            }
        }
        this._cachedSessionProps = p
        return p
    }
}
