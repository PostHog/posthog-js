// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import type { PostHog } from 'posthog-node'
import { uuidv7 } from '@posthog/core'

import type { BeforeSendFn, Event, McpEvent, MCPAnalyticsOptions } from '../types'
import { clientOptionFields, hasPersonlessDefault, settlePersonProcessing } from './event-options'
import { log, type LoggerFn } from './logger'
import { type PostHogCaptureEvent, buildPostHogCaptureEvents } from './posthog-events'
import { newPrefixedId } from './ids'
import { sanitizeEvent } from './sanitization'
import { truncateEvent } from './truncation'

/** Per-event toggles consulted by the sink when fanning out an event. */
export interface McpCaptureOptions extends Pick<
  MCPAnalyticsOptions,
  'captureParameters' | 'captureResponse' | 'captureErrorMessages'
> {
  enableExceptionAutocapture: boolean
  /** Inspect/modify/drop hook applied to each fanned-out payload before capture. */
  beforeSend?: BeforeSendFn
}

// A shape-only check is insufficient: an arbitrary customer identifier can
// have the syntax of an Error name. Keep only recognised classes/categories
// when the caller has explicitly disabled raw exception data.
const SAFE_ERROR_TYPES = new Set([
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'AggregateError',
  'AbortError',
  'TimeoutError',
  'NetworkError',
  'ValidationError',
  'McpError',
  'MCPError',
  'HTTPError',
  'HttpError',
  'validation',
  'rate_limited',
])

function safeErrorType(event: McpEvent): string | undefined {
  const type = event.errorType ?? event.error?.$exception_list?.[0]?.type
  if (type === undefined || type === null) {
    return undefined
  }
  // Unknown names (including private data disguised as identifiers) are not
  // trustworthy metadata. Map them to a generic, non-sensitive category.
  return typeof type === 'string' && SAFE_ERROR_TYPES.has(type) ? type : 'Error'
}

/**
 * Enforce content exclusions at the single outbound MCP analytics boundary.
 * Both instrument() and the custom PostHogMCP dispatcher use this sink.
 * Suppress failed tool results alongside exception details: a failed result
 * commonly repeats the same sensitive message in its content text.
 *
 * Custom event properties (including explicit host-defined properties) remain
 * host-owned, not part of these three built-in content channels.
 */
function omitCapturedContent(event: McpEvent, options: McpCaptureOptions): McpEvent {
  const omitParameters = options.captureParameters === false
  const omitErrors = options.captureErrorMessages === false
  const omitResponse = options.captureResponse === false || (omitErrors && event.isError === true)
  if (!omitParameters && !omitResponse && !omitErrors) {
    return event
  }

  return {
    ...event,
    ...(omitParameters ? { parameters: undefined } : {}),
    ...(omitResponse ? { response: undefined } : {}),
    ...(omitErrors
      ? {
          error: undefined,
          errorType: safeErrorType(event),
        }
      : {}),
  }
}

/**
 * Runs an MCP event through the full transform: content opt-outs → sanitize → truncate → fan out
 * into the `$mcp_*` / `$exception` capture payloads → `beforeSend` → settle
 * person processing into the `process_person_profile` option. Returns
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
  // Drop opted-out values before either a sanitizer, callback, or fanned-out
  // payload can observe them. Do not mutate the event held by the host.
  // Treat a getter that throws on a malformed event like a sanitisation error.
  let processed: McpEvent = event

  try {
    processed = sanitizeEvent(omitCapturedContent(event, options))
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

  const personlessDefault = hasPersonlessDefault(fullEvent)
  const kept = await applyBeforeSend(built, options.beforeSend, logger)
  const captures = kept.map((capture) => settlePersonProcessing(capture, personlessDefault))

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
          ...clientOptionFields(this.posthog, captureEvent.properties, captureEvent.options),
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
