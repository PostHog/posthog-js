import { PostHog } from '../posthog-core'
import { assignableWindow } from '../utils/globals'
import { createLogger } from '../utils/logger'

const logger = createLogger('[PostHog Crisp Chat]')

const reportedSessionIds = new Set<string>()
let sessionIdListenerUnsubscribe: undefined | (() => void) = undefined

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.integrations = assignableWindow.__PosthogExtensions__.integrations || {}
assignableWindow.__PosthogExtensions__.integrations.crispChat = {
    start: (posthog: PostHog) => {
        if (!posthog.config.integrations?.crispChat) {
            return
        }

        const crispChat = (assignableWindow as any).$crisp
        if (!crispChat) {
            logger.warn('Crisp Chat not found while initializing the integration')
            return
        }

        const updateCrispChat = () => {
            const replayUrl = posthog.get_session_replay_url()
            const personUrl = posthog.requestRouter.endpointFor(
                'ui',
                `/project/${posthog.config.token}/person/${posthog.get_distinct_id()}`
            )

            crispChat.push([
                'set',
                'session:data',
                [
                    [
                        ['posthogSessionURL', replayUrl],
                        ['posthogPersonURL', personUrl],
                    ],
                ],
            ])
        }

        // this is called immediately if there's a session id
        // and then again whenever the session id changes
        sessionIdListenerUnsubscribe = posthog.onSessionId((sessionId) => {
            if (!reportedSessionIds.has(sessionId)) {
                updateCrispChat()
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
