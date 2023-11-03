/* Client-side session parameters. These are primarily used by web analytics,
 * which relies on these for session analytics without the plugin server being
 * available for the person level set-once properties. Obviously not consistent
 * between client-side events and server-side events but this is acceptable
 * as web analytics only uses client-side.
 *
 * These have the same lifespan as a session_id
 */
import { window } from './utils/globals'
import { _info } from './utils/event-utils'
import { SessionIdManager } from './sessionid'
import { PostHogPersistence } from './posthog-persistence'
import { CLIENT_SESSION_PROPS } from './constants'

// this might be stored in a cookie with a hard 4096 byte limit, so save characters on key names
interface SessionSourceProps {
    p: string // initial pathname
    r: string // referring domain
    m?: string // utm medium
    s?: string // utm source
    c?: string // utm campaign
    n?: string // utm content
    t?: string // utm term
}

export interface StoredSessionSourceProps {
    s: string // session id
    p: SessionSourceProps
}

export const generateSessionSourceParams = (): SessionSourceProps => {
    const campaignParams = _info.campaignParams()
    return {
        p: window?.location.pathname || '',
        r: _info.referringDomain(),
        m: campaignParams.utm_medium,
        s: campaignParams.utm_source,
        c: campaignParams.utm_campaign,
        n: campaignParams.utm_content,
        t: campaignParams.utm_term,
    }
}

export class SessionPropsManager {
    private readonly _sessionIdManager: SessionIdManager
    private readonly _persistence: PostHogPersistence
    private readonly _sessionSourceParamGenerator: () => SessionSourceProps

    constructor(
        sessionIdManager: SessionIdManager,
        persistence: PostHogPersistence,
        sessionSourceParamGenerator?: () => SessionSourceProps
    ) {
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
        if (stored && stored.s === sessionId) {
            return
        }

        const newProps: StoredSessionSourceProps = {
            s: sessionId,
            p: this._sessionSourceParamGenerator(),
        }
        this._persistence.register({ [CLIENT_SESSION_PROPS]: newProps })
    }

    getSessionProps() {
        const p = this._getStoredProps()?.p
        if (!p) {
            return {}
        }

        return {
            $client_session_initial_referring_host: p.r,
            $client_session_initial_pathname: p.p,
            $client_session_initial_utm_source: p.s,
            $client_session_initial_utm_campaign: p.c,
            $client_session_initial_utm_medium: p.m,
            $client_session_initial_utm_content: p.n,
            $client_session_initial_utm_term: p.t,
        }
    }
}
