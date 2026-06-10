// Portions of this file are derived from MCPCat/mcpcat-typescript-sdk
// Copyright (c) 2025 MCPcat
// Licensed under the MIT License: https://github.com/MCPCat/mcpcat-typescript-sdk/blob/main/LICENSE

import type { PostHog } from 'posthog-node'
import { uuidv7 } from '@posthog/core'

import type { BeforeSendFn, Event, McpEvent } from '../types'
import { log } from './logger'
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
  options: McpCaptureOptions
): Promise<{ event: Event; captures: PostHogCaptureEvent[] } | null> {
  let processed: McpEvent = event

  try {
    processed = sanitizeEvent(processed)
  } catch (err) {
    log(`Failed to sanitize event: ${err}`)
    return null
  }

  try {
    processed = truncateEvent(processed)
  } catch (err) {
    log(`Failed to truncate event: ${err}`)
    return null
  }

  processed.id = processed.id || newPrefixedId('evt')
  const fullEvent = processed as Event

  const built = buildPostHogCaptureEvents(fullEvent, {
    enableExceptionAutocapture: options.enableExceptionAutocapture,
  })

  const captures = await applyBeforeSend(built, options.beforeSend)

  return { event: fullEvent, captures }
}

/**
 * Runs each payload through `beforeSend`, keeping those it returns and dropping
 * those it nullifies or throws on. No-op (identity) when no hook is configured.
 */
async function applyBeforeSend(
  captures: PostHogCaptureEvent[],
  beforeSend: BeforeSendFn | undefined
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
      log(`beforeSend threw for event ${capture.event}; dropping it: ${err}`)
    }
  }
  return kept
}

/**
 * Wraps a user-supplied `posthog-node` client. Runs every MCP event through the
 * sanitize → truncate pipeline, fans it out into the `$mcp_*` / `$exception`
 * events, applies `beforeSend`, and hands each to `posthog.capture()`.
 *
 * The SDK does not own the client lifecycle — the host application constructs
 * the `PostHog` instance and is responsible for `shutdown()` (matching
 * `@posthog/ai`).
 */
export class McpEventSink {
  constructor(private readonly posthog: PostHog) {}

  /**
   * Push an MCP event through the pipeline (sanitize → truncate → fan out →
   * beforeSend → capture). Errors at any stage are logged and the event is
   * dropped, never re-thrown into tool code.
   */
  async capture(event: McpEvent, options: McpCaptureOptions): Promise<void> {
    const result = await processMcpEvent(event, options)
    if (!result) {
      return
    }

    const { event: fullEvent, captures } = result
    try {
      for (const captureEvent of captures) {
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