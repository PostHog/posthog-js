// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import type { EventMessage, PostHog } from 'posthog-node'
import { uuidv7 } from '@posthog/core'

import type { BeforeSendFn, Event, McpEvent } from '../types'
import { log, type LoggerFn } from './logger'
import { type PostHogCaptureEvent, buildPostHogCaptureEvents } from './posthog-events'
import { newPrefixedId } from './ids'
import { sanitizeEvent } from './sanitization'
import { truncateEvent } from './truncation'

/** Per-event toggles consulted by the sink when fanning out an event. */
export interface McpCaptureOptions {
  enableExceptionAutocapture: boolean
  /** Inspect/modify/drop hook applied to each fanned-out payload before capture. */
  beforeSend?: BeforeSendFn
}

/**
 * Runs an MCP event through the full transform: sanitize → truncate → fan out
 * into the `$mcp_*` / `$exception` capture payloads → `beforeSend`. Returns
 * `null` (and logs) if a transform stage throws, so the event is dropped rather
 * than partially sent. Individual payloads dropped by `beforeSend` are filtered
 * out of the returned `captures`.
 *
 * This is the single source of truth for the pipeline — both {@link McpEventSink}
 * and the test harness call it, so tests assert on exactly the payloads that
 * reach `posthog.capture()`.
 */
export async function processMcpEvent(
  event: McpEvent,
  options: McpCaptureOptions,
  logger: LoggerFn = log
): Promise<{ event: Event; captures: PostHogCaptureEvent[] } | null> {
  let processed: McpEvent = event

  try {
    processed = sanitizeEvent(processed)
  } catch (err) {
    logger(`Failed to sanitize event: ${err}`)
    return null
  }

  try {
    processed = truncateEvent(processed)
  } catch (err) {
    logger(`Failed to truncate event: ${err}`)
    return null
  }

  processed.id = processed.id || newPrefixedId('evt')
  const fullEvent = processed as Event

  const built = buildPostHogCaptureEvents(fullEvent, {
    enableExceptionAutocapture: options.enableExceptionAutocapture,
  })

  const captures = await applyBeforeSend(built, options.beforeSend, logger)

  return { event: fullEvent, captures }
}

/**
 * Runs each payload through `beforeSend`, keeping those it returns and dropping
 * those it nullifies or throws on. No-op (identity) when no hook is configured.
 */
async function applyBeforeSend(
  captures: PostHogCaptureEvent[],
  beforeSend: BeforeSendFn | undefined,
  logger: LoggerFn
): Promise<PostHogCaptureEvent[]> {
  if (!beforeSend) {
    return captures
  }

  const kept: PostHogCaptureEvent[] = []
  for (const capture of captures) {
    try {
      const result = await beforeSend(capture)
      if (result) {
        kept.push(result)
      }
    } catch (err) {
      logger(`beforeSend threw for event ${capture.event}; dropping it: ${err}`)
    }
  }
  return kept
}

/**
 * Marks a personless payload for the client it goes to. posthog-node 6 needs the per-event
 * `process_person_profile` option, because a registered or context option beats the property;
 * posthog-node 5 reads only the property. `registerOptions` first shipped in posthog-node 6.
 * The payload's property decides, so `beforeSend` can still turn person processing back on.
 */
function personProcessingFields(
  posthog: PostHog,
  properties: Record<string, unknown>
): Pick<EventMessage, 'properties' | 'options'> {
  if (typeof posthog.registerOptions !== 'function' || properties.$process_person_profile !== false) {
    return { properties }
  }
  const { $process_person_profile: _personless, ...rest } = properties
  return { properties: rest, options: { process_person_profile: false } }
}

/**
 * Wraps a user-supplied `posthog-node` client: runs every MCP event through
 * {@link processMcpEvent} and hands each surviving payload to `posthog.capture()`.
 *
 * The SDK does not own the client lifecycle — the host application constructs
 * the `PostHog` instance and is responsible for `shutdown()` (matching
 * `@posthog/ai`).
 */
export class McpEventSink {
  constructor(
    private readonly posthog: PostHog,
    private readonly logger: LoggerFn = log
  ) {}

  /**
   * Errors at any stage are logged and the event is dropped, never re-thrown
   * into tool code.
   */
  async capture(event: McpEvent, options: McpCaptureOptions): Promise<void> {
    const result = await processMcpEvent(event, options, this.logger)
    if (!result) {
      return
    }

    const { event: fullEvent, captures } = result
    try {
      for (const captureEvent of captures) {
        // posthog-node before 5.38.6 replaces `properties.$groups` with the top-level `groups`
        // field, so pass both (https://github.com/PostHog/posthog-js/issues/3888).
        const groups = captureEvent.properties.$groups as Record<string, string> | undefined

        this.posthog.capture({
          distinctId: captureEvent.distinct_id,
          event: captureEvent.event,
          ...personProcessingFields(this.posthog, captureEvent.properties),
          ...(groups ? { groups } : {}),
          timestamp: new Date(captureEvent.timestamp),
          uuid: uuidv7(),
        })
      }
      this.logger(
        `Captured PostHog event ${fullEvent.id} | ${fullEvent.eventType} | ${fullEvent.duration} ms | ${
          fullEvent.identifyActorGivenId ? 'identified' : 'anonymous'
        }`
      )
    } catch (err) {
      this.logger(`Failed to capture PostHog event ${fullEvent.id}: ${err}`)
    }
  }
}
