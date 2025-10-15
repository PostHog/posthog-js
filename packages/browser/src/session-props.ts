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
import { each, stripEmptyProperties } from './utils'
import { stripLeadingDollar } from '@posthog/core'

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
    private _bootstrappedSessionProps?: Record<string, any>
    private _bootstrapSessionId?: string

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
        this._bootstrappedSessionProps = instance.config.bootstrap?.sessionProps
        this._bootstrapSessionId = instance.config.bootstrap?.sessionID

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

        // Clear bootstrapped props when session changes
        if (this._bootstrappedSessionProps) {
            if (this._bootstrapSessionId) {
                // If we have a bootstrap session ID, only clear if it doesn't match
                if (this._bootstrapSessionId !== sessionId) {
                    this._bootstrappedSessionProps = undefined
                }
            } else {
                // No bootstrap session ID - clear on session change (but NOT on first initialization)
                if (stored) {
                    // There was a previous session, so this is a session change - clear the props
                    this._bootstrappedSessionProps = undefined
                }
                // If !stored, this is the first session - keep the bootstrapped props
            }
        }

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
        const stored = this._getStored()

        // If we have bootstrapped session props, use them if:
        // 1. We have a bootstrap session ID and it matches the current session, OR
        // 2. No bootstrap session ID was provided (session props only), use until session changes
        if (this._bootstrappedSessionProps) {
            if (this._bootstrapSessionId) {
                // Bootstrap session ID exists - only use if it matches current session (or no session yet)
                if (!stored || stored.sessionId === this._bootstrapSessionId) {
                    return this._bootstrappedSessionProps
                }
            } else {
                // No bootstrap session ID - use bootstrapped props (they'll be cleared on first session change)
                return this._bootstrappedSessionProps
            }
        }

        // Otherwise, derive from stored props with $session_entry_ prefix
        const p: Record<string, any> = {}
        each(stripEmptyProperties(this.getSetOnceProps()), (v, k) => {
            if (k === '$current_url') {
                // $session_entry_current_url would be a weird name, call it $session_entry_url instead
                k = 'url'
            }
            p[`$session_entry_${stripLeadingDollar(k)}`] = v
        })
        return p
    }
}
