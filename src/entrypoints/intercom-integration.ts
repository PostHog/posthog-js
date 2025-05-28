import { PostHog } from '../posthog-core'
import { assignableWindow } from '../utils/globals'
import { createLogger } from '../utils/logger'

const logger = createLogger('[PostHog Intercom integration]')

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.integrations = assignableWindow.__PosthogExtensions__.integrations || {}
assignableWindow.__PosthogExtensions__.integrations.intercom = {
    start: (posthog: PostHog) => {
        if (!posthog.config.integrations?.intercom) {
            return
        }

        const intercom = (assignableWindow as any).Intercom
        if (!intercom) {
            logger.warn(' Intercom not found while initializing the integration')
            return
        }

        intercom.on('show', () => {
            posthog.capture('intercom:show', {
                intercomVisitorId: intercom('getVisitorId') || undefined,
            })

            const replayUrl = posthog.get_session_replay_url()
            const personUrl = posthog.requestRouter.endpointFor(
                'ui',
                `/project/${posthog.config.token}/person/${posthog.get_distinct_id()}`
            )

            intercom('update', {
                posthogRecordingURL: replayUrl,
                posthogPersonURL: personUrl,
            })
            intercom('trackEvent', 'posthog:onShow', { sessionURL: replayUrl, personURL: personUrl })
        })
    },
}
