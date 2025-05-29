import { PostHog } from '../posthog-core'
import { assignableWindow } from '../utils/globals'
import { createLogger } from '../utils/logger'

const logger = createLogger('[PostHog Intercom]')

const reportedSessionIds = new Set<string>()

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.integrations = assignableWindow.__PosthogExtensions__.integrations || {}
assignableWindow.__PosthogExtensions__.integrations.intercom = {
    start: (posthog: PostHog) => {
        if (!posthog.config.integrations?.intercom) {
            return false
        }

        const intercom = (assignableWindow as any).Intercom
        if (!intercom) {
            logger.warn(' Intercom not found while initializing the integration')
            return false
        }

        posthog.capture('intercom:integration:start', {
            intercomVisitorId: intercom('getVisitorId') || undefined,
        })

        const updateIntercom = () => {
            const replayUrl = posthog.get_session_replay_url()
            const personUrl = posthog.requestRouter.endpointFor(
                'ui',
                `/project/${posthog.config.token}/person/${posthog.get_distinct_id()}`
            )

            intercom('update', {
                latestPosthogReplayURL: replayUrl,
                latestPosthogPersonURL: personUrl,
            })
            intercom('trackEvent', 'posthog:sessionInfo', { replayUrl, personUrl })
        }

        // this is called immediately if there's a session id
        // and then again whenever the session id changes
        posthog.onSessionId((sessionId) => {
            if (!reportedSessionIds.has(sessionId)) {
                updateIntercom()
                reportedSessionIds.add(sessionId)
            }
        })

        return true
    },
}
