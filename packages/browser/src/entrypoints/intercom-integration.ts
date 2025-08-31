import { PostHog } from '../posthog-core'
import { assignableWindow, posthogExtensions } from '../utils/globals'
import { createLogger } from '../utils/logger'

const logger = createLogger('[PostHog Intercom integration]')

const reportedSessionIds = new Set<string>()
let sessionIdListenerUnsubscribe: undefined | (() => void) = undefined

posthogExtensions.integrations = posthogExtensions.integrations || {}
posthogExtensions.integrations.intercom = {
    start: (posthog: PostHog) => {
        if (!posthog.config.integrations?.intercom) {
            return
        }

        const intercom = (assignableWindow as any).Intercom
        if (!intercom) {
            logger.warn('Intercom not found while initializing the integration')
            return
        }

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
        sessionIdListenerUnsubscribe = posthog.onSessionId((sessionId) => {
            if (!reportedSessionIds.has(sessionId)) {
                updateIntercom()
                reportedSessionIds.add(sessionId)
            }
        })

        logger.info('integration started')
    },
    stop: () => {
        sessionIdListenerUnsubscribe?.()
        sessionIdListenerUnsubscribe = undefined
    },
}
