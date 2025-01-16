/* Client-side session parameters. These are primarily used by web analytics,
 * which relies on these for session analytics without the plugin server being
 * available for the person level set-once properties. Obviously not consistent
 * between client-side events and server-side events but this is acceptable
 * as web analytics only uses client-side.
 *
 * These have the same lifespan as a session_id
 */
import { location } from './utils/globals'
import { Info } from './utils/event-utils'
import type { SessionIdManager } from './sessionid'
import type { PostHogPersistence } from './posthog-persistence'
import { CLIENT_SESSION_PROPS } from './constants'
import type { PostHog } from './posthog-core'

interface SessionSourceProps {
    initialPathName: string
    referringDomain: string // Is actually host, but named domain for internal consistency. Should contain a port if there is one.
    utm_medium?: string
    utm_source?: string
    utm_campaign?: string
    utm_content?: string
    utm_term?: string
}

interface StoredSessionSourceProps {
    sessionId: string
    props: SessionSourceProps
}

const generateSessionSourceParams = (instance?: PostHog): SessionSourceProps => {
    const config = instance?.config
    return {
        initialPathName: location?.pathname || '',
        referringDomain: Info.referringDomain(),
        ...Info.campaignParams({
            customTrackedParams: config?.custom_campaign_params,
            maskPersonalDataProperties: config?.mask_personal_data_properties,
            customPersonalDataProperties: config?.custom_personal_data_properties,
        }),
    }
}

export class SessionPropsManager {
    private readonly instance: PostHog
    private readonly _sessionIdManager: SessionIdManager
    private readonly _persistence: PostHogPersistence
    private readonly _sessionSourceParamGenerator: (instance?: PostHog) => SessionSourceProps

    constructor(
        instance: PostHog,
        sessionIdManager: SessionIdManager,
        persistence: PostHogPersistence,
        sessionSourceParamGenerator?: (instance?: PostHog) => SessionSourceProps
    ) {
        this.instance = instance
        this._sessionIdManager = sessionIdManager
        this._persistence = persistence
        this._sessionSourceParamGenerator = sessionSourceParamGenerator || generateSessionSourceParams

        this._sessionIdManager.onSessionId(this._onSessionIdCallback)
    }

    _getStoredProps(): StoredSessionSourceProps | undefined {
        return this._persistence.props[CLIENT_SESSION_PROPS]
    }

    _onSessionIdCallback = (sessionId: string) => {
        const stored = this._getStoredProps()
        if (stored && stored.sessionId === sessionId) {
            return
        }

        const newProps: StoredSessionSourceProps = {
            sessionId,
            props: this._sessionSourceParamGenerator(this.instance),
        }
        this._persistence.register({ [CLIENT_SESSION_PROPS]: newProps })
    }

    getSessionProps() {
        const p = this._getStoredProps()?.props
        if (!p) {
            return {}
        }

        return {
            $client_session_initial_referring_host: p.referringDomain,
            $client_session_initial_pathname: p.initialPathName,
            $client_session_initial_utm_source: p.utm_source,
            $client_session_initial_utm_campaign: p.utm_campaign,
            $client_session_initial_utm_medium: p.utm_medium,
            $client_session_initial_utm_content: p.utm_content,
            $client_session_initial_utm_term: p.utm_term,
        }
    }
}
