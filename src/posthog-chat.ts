import { log } from 'console'
import { PostHog } from './posthog-core'
import { CHAT_LOGGER as logger } from './utils/chat-utils'

export class PostHogChat {
    constructor(private readonly instance: PostHog) {}

    startIfEnabled() {
        logger.info('PostHogChat startIfEnabled')
    }
}
