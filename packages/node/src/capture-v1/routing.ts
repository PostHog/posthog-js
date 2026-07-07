import type { PostHogEventProperties } from '@posthog/core'

/** Event-name prefix for AI analytics events, which have no Capture V1 form yet. */
const AI_EVENT_PREFIX = '$ai_'

/**
 * True for events that must keep using the legacy (v0) submitter even when the
 * client is in v1 mode. Today that is only `$ai_*` events: the dedicated AI
 * ingestion path has no v1 form, so they stay on v0 until AI v1 is designed.
 * The check runs on the post-`before_send` event name.
 */
export function isLegacyOnlyEvent(message: PostHogEventProperties): boolean {
  return typeof message.event === 'string' && message.event.startsWith(AI_EVENT_PREFIX)
}
