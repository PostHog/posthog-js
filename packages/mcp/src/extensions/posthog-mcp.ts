import { PostHog } from 'posthog-node'

import type { InitializeCaptureData, JsonRecord, McpCaptureCommon, McpEvent, ToolCallCaptureData } from '../types'
import { MCPAnalyticsEventType } from './event-types'
import { captureException } from './exceptions'
import { log } from './logger'
import { McpEventSink } from './sink'

/**
 * A `posthog-node` client with first-class MCP analytics. Use this when there is
 * no `Server`/`McpServer` to wrap (e.g. a custom HTTP or hono dispatcher): the
 * host resolves identity + context per request and calls the capture methods
 * directly.
 *
 * It **extends `PostHog`**, so it's a drop-in replacement for your existing
 * `posthog-node` client — `capture`, `identify`, `flush`, `shutdown`, feature
 * flags, etc. all work unchanged — with `captureToolCall` / `captureInitialize`
 * added on top. The MCP methods build canonical `$mcp_*` events and run them
 * through the same sanitize → truncate → `$exception` fan-out pipeline as
 * `instrument()`, then hand them to the inherited `capture()` (so the client's
 * own `beforeSend` applies).
 *
 * @example
 * ```ts
 * import { PostHogMCP } from "@posthog/mcp"
 *
 * const posthog = new PostHogMCP("phc_your_project_token", { host: "https://us.i.posthog.com" })
 *
 * posthog.captureToolCall({
 *   toolName: "search_docs",
 *   durationMs: 42,
 *   isError: false,
 *   distinctId: "user_123",
 *   groups: { organization: "org_1" },
 * })
 *
 * // inherited from posthog-node
 * posthog.capture({ distinctId: "user_123", event: "feedback_submitted", properties: { rating: 5 } })
 * await posthog.shutdown()
 * ```
 */
export class PostHogMCP extends PostHog {
  // Reuses the shared sink so MCP events flow through the identical
  // sanitize/truncate/fan-out pipeline as the `instrument()` path; the sink
  // publishes via `this` (the inherited `capture()`), so the client's own
  // `beforeSend` and batching apply.
  readonly #sink = new McpEventSink(this)

  /** Capture a tool invocation. Emits `$mcp_tool_call` (+ an `$exception` sibling on error). */
  captureToolCall(data: ToolCallCaptureData): void {
    const event = baseEvent(MCPAnalyticsEventType.mcpToolsCall, data)
    event.resourceName = data.toolName
    event.toolDescription = data.toolDescription
    event.toolCategory = data.category
    event.parameters = data.parameters
    event.response = data.response
    event.duration = data.durationMs
    event.isError = data.isError
    if (data.isError) {
      event.error = captureException(data.error ?? `Tool ${data.toolName} returned an error`)
    }
    this.#emit(event)
  }

  /** Capture the connection handshake. Emits `$mcp_initialize`. */
  captureInitialize(data: InitializeCaptureData): void {
    const event = baseEvent(MCPAnalyticsEventType.mcpInitialize, data)
    event.clientName = data.clientName
    event.clientVersion = data.clientVersion
    event.parameters = data.parameters
    event.response = data.response
    event.duration = data.durationMs
    this.#emit(event)
  }

  /**
   * Fire-and-forget, mirroring posthog-node's `capture()`: the event is enqueued
   * on the client, not awaited. Never throws — a failure to record analytics
   * must not break the host request.
   */
  #emit(event: McpEvent): void {
    void this.#sink
      .capture(event, { enableExceptionAutocapture: this.options.enableExceptionAutocapture ?? true })
      .catch((error) => log(`Warning: PostHogMCP failed to capture event - ${error}`))
  }
}

/**
 * Builds the shared scaffold for an MCP event: event type, identity/session
 * routing, groups, person `$set`, and custom properties. Method callers layer
 * the event-specific fields on top.
 */
function baseEvent(eventType: MCPAnalyticsEventType, common: McpCaptureCommon): McpEvent {
  const event: McpEvent = {
    eventType,
    sessionId: common.sessionId,
    timestamp: common.timestamp ?? new Date(),
    properties: common.properties,
    groups: common.groups,
  }
  if (common.distinctId) {
    event.identifyActorGivenId = common.distinctId
  }
  if (common.setProperties && Object.keys(common.setProperties as JsonRecord).length > 0) {
    event.identifyActorData = common.setProperties
  }
  return event
}
