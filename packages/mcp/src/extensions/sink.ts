import type { PostHog } from 'posthog-node'
import { uuidv7 } from '@posthog/core'

import type { Event, UnredactedEvent } from '../types'
import { log } from './logger'
import { buildPostHogCaptureEvents } from './posthog-events'
import { newPrefixedId } from './ids'
import { redactEvent } from './redaction'
import { sanitizeEvent } from './sanitization'
import { truncateEvent } from './truncation'

/** Per-event toggles consulted by the sink when fanning out an event. */
export interface McpCaptureOptions {
  enableAITracing: boolean
  enableExceptionAutocapture: boolean
}

/**
 * Wraps a user-supplied `posthog-node` client. Runs every MCP event through the
 * redact → sanitize → truncate pipeline, fans it out into the `$mcp_*` /
 * `$ai_span` / `$exception` events, and hands each to `posthog.capture()`.
 *
 * The SDK does not own the client lifecycle — the host application constructs
 * the `PostHog` instance and is responsible for `shutdown()` (matching
 * `@posthog/ai`).
 */
export class McpEventSink {
  constructor(private readonly posthog: PostHog) {}

  /**
   * Push an MCP event through the pipeline (redact → sanitize → truncate → fan out → capture).
   * Errors at any stage are logged and the event is dropped, never re-thrown into tool code.
   */
  async capture(event: UnredactedEvent, options: McpCaptureOptions): Promise<void> {
    const { enableAITracing, enableExceptionAutocapture } = options

    let processed: UnredactedEvent = event

    if (event.redactionFn) {
      try {
        processed = (await redactEvent(event, event.redactionFn)) as UnredactedEvent
        processed.redactionFn = undefined
      } catch (err) {
        log(`Failed to redact event: ${err}`)
        return
      }
    }

    try {
      processed = sanitizeEvent(processed)
    } catch (err) {
      log(`Failed to sanitize event: ${err}`)
      return
    }

    try {
      processed = truncateEvent(processed)
    } catch (err) {
      log(`Failed to truncate event: ${err}`)
      return
    }

    processed.id = processed.id || newPrefixedId('evt')
    const fullEvent = processed as Event

    try {
      for (const captureEvent of buildPostHogCaptureEvents(fullEvent, {
        enableAITracing,
        enableExceptionAutocapture,
      })) {
        this.posthog.capture({
          distinctId: captureEvent.distinct_id,
          event: captureEvent.event,
          properties: captureEvent.properties,
          timestamp: new Date(captureEvent.timestamp),
          uuid: uuidv7(),
        })
      }
      log(
        `Captured PostHog event ${fullEvent.id} | ${fullEvent.eventType} | ${fullEvent.duration} ms | ${
          fullEvent.identifyActorGivenId || 'anonymous'
        }`
      )
    } catch (err) {
      log(`Failed to capture PostHog event ${fullEvent.id}: ${err}`)
    }
  }
}
