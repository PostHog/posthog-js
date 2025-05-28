import { PostHog } from '../posthog-core'
import { assignableWindow } from '../utils/globals'
import { createLogger } from '../utils/logger'

const logger = createLogger('[PostHog Intercom integration]')

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.integrations = assignableWindow.__PosthogExtensions__.integrations || {}
assignableWindow.__PosthogExtensions__.integrations.crispChat = {
    start: (posthog: PostHog) => {
        if (!posthog.config.integrations?.crispChat) {
            return
        }

        const crispChat = (assignableWindow as any).$crisp
        if (!crispChat) {
            logger.warn(' Crisp Chat not found while initializing the integration')
            return
        }

        crispChat.push([
            'on',
            'session:loaded',
            (crispSessionId: string) => {
                const replayUrl = posthog.get_session_replay_url()
                const personUrl = posthog.requestRouter.endpointFor(
                    'ui',
                    `/project/${posthog.config.token}/person/${posthog.get_distinct_id()}`
                )

                posthog.capture('crispChat:session:loaded', { crispSessionId })
                crispChat.push([
                    'set',
                    'session:event',
                    [[['posthog:onSessionLoaded', { sessionURL: replayUrl, personURL: personUrl }, 'red']]],
                ])
            },
        ])
    },
}
