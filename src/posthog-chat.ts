import { PostHog } from './posthog-core'
import { CHAT_LOGGER as logger } from './utils/chat-utils'
import { assignableWindow } from './utils/globals'

export class PostHogChat {
    constructor(private readonly instance: PostHog) {}

    startIfEnabled() {
        logger.info('PostHogChat startIfEnabled')
        const loadChat = assignableWindow?.__PosthogExtensions__?.loadChat

        if (!loadChat) {
            assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this.instance, 'chat', (err) => {
                if (err) {
                    return logger.error('Could not load script', err)
                }

                assignableWindow.__PosthogExtensions__?.loadChat?.(this.instance)
            })
        }
    }
}
