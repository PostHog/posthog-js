/* Client-side session parameters. These are primarily used by web analytics,
 * which relies on these for session analytics without the plugin server being
 * available for the person level set-once properties. Obviously not consistent
 * between client-side events and server-side events but this is acceptable
 * as web analytics only uses client-side.
 *
 * These have the same lifespan as a session_id
 */
import { Info } from './utils/event-utils'
import type { SessionIdManager } from './sessionid'
import type { PostHogPersistence } from './posthog-persistence'
import { CLIENT_SESSION_PROPS } from './constants'
import type { PostHog } from './posthog-core'

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
    return Info.personInfo({
        maskPersonalDataProperties: posthog?.config.mask_personal_data_properties,
        customPersonalDataProperties: posthog?.config.custom_personal_data_properties,
    })
}

export class SessionPropsManager {
    private readonly instance: PostHog
    private readonly _sessionIdManager: SessionIdManager
    private readonly _persistence: PostHogPersistence
    private readonly _sessionSourceParamGenerator: (
        instance?: PostHog
    ) => LegacySessionSourceProps | CurrentSessionSourceProps

    constructor(
        instance: PostHog,
        sessionIdManager: SessionIdManager,
        persistence: PostHogPersistence,
        sessionSourceParamGenerator?: (instance?: PostHog) => LegacySessionSourceProps | CurrentSessionSourceProps
    ) {
        this.instance = instance
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

        const newProps: StoredSessionSourceProps = {
            sessionId,
            props: this._sessionSourceParamGenerator(this.instance),
        }
        this._persistence.register({ [CLIENT_SESSION_PROPS]: newProps })
    }

    getSetOnceInitialSessionPropsProps() {
        const p = this._getStored()?.props
        if (!p) {
            return {}
        }
        if ('r' in p) {
            return Info.personPropsFromInfo(p)
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
}
