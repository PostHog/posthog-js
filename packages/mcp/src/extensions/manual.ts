import type { PostHog } from 'posthog-node'

import type {
  CreateMcpAnalyticsOptions,
  InitializeCaptureData,
  JsonRecord,
  ManualCaptureCommon,
  ManualCustomCaptureData,
  McpAnalyticsManual,
  McpEvent,
  ToolCallCaptureData,
} from '../types'
import { MCPAnalyticsEventType } from './event-types'
import { captureException } from './exceptions'
import { log, setLogger } from './logger'
import { McpEventSink, type McpCaptureOptions } from './sink'

/**
 * Creates a server-agnostic MCP analytics handle. Use this when there is no
 * `Server`/`McpServer` instance to wrap (e.g. a custom HTTP or hono dispatcher):
 * the host resolves identity + context per request and calls the capture methods
 * directly. Each call builds an `McpEvent` and runs it through the exact same
 * pipeline as `instrument()` — sanitize → truncate → `$exception` fan-out →
 * `beforeSend` → `posthog.capture()`.
 *
 * The SDK does not own the client lifecycle: the host constructs the `PostHog`
 * instance and is responsible for `shutdown()` (matching `@posthog/ai`).
 *
 * @param posthog - A `posthog-node` client you construct and own.
 * @param options - See {@link CreateMcpAnalyticsOptions}.
 *
 * @example
 * ```ts
 * const analytics = createMcpAnalytics(posthog, { beforeSend })
 * await analytics.captureToolCall({
 *   toolName: "execute-sql",
 *   durationMs: 42,
 *   isError: false,
 *   distinctId: "user-123",
 *   groups: { organization: "org-1", project: "proj-1" },
 *   properties: { $mcp_client_name: "claude-code" },
 * })
 * ```
 */
export function createMcpAnalytics(posthog: PostHog, options: CreateMcpAnalyticsOptions = {}): McpAnalyticsManual {
  if (options.logger) {
    setLogger(options.logger)
  }
  if (!posthog) {
    log('Warning: No PostHog client passed to createMcpAnalytics(). Events will not be sent anywhere.')
  }

  const sink = posthog ? new McpEventSink(posthog) : undefined
  const captureOptions: McpCaptureOptions = {
    enableExceptionAutocapture: options.enableExceptionAutocapture ?? true,
    beforeSend: options.beforeSend,
  }

  /**
   * Pushes a built event through the sink. Resolves once processed (so callers
   * may await), and never throws — a failure to capture analytics must not break
   * the host request.
   */
  async function emit(event: McpEvent): Promise<void> {
    if (!sink) {
      return
    }
    try {
      await sink.capture(event, captureOptions)
    } catch (error) {
      log(`Warning: createMcpAnalytics failed to capture event - ${error}`)
    }
  }

  return {
    captureToolCall(data: ToolCallCaptureData): Promise<void> {
      const event = baseEvent(MCPAnalyticsEventType.mcpToolsCall, data)
      event.resourceName = data.toolName
      event.toolDescription = data.toolDescription
      event.parameters = data.parameters
      event.response = data.response
      event.duration = data.durationMs
      event.isError = data.isError
      if (data.isError) {
        event.error = captureException(data.error ?? `Tool ${data.toolName} returned an error`)
      }
      return emit(event)
    },

    captureInitialize(data: InitializeCaptureData): Promise<void> {
      const event = baseEvent(MCPAnalyticsEventType.mcpInitialize, data)
      event.clientName = data.clientName
      event.clientVersion = data.clientVersion
      event.parameters = data.parameters
      event.response = data.response
      event.duration = data.durationMs
      return emit(event)
    },

    capture(data: ManualCustomCaptureData): Promise<void> {
      // Never throw: this API guarantees that a capture call can't break the
      // host request, so a misuse (missing/empty event name) is logged and
      // skipped rather than rejected.
      if (!data || typeof data.event !== 'string' || data.event.length === 0) {
        log('Warning: capture() requires an `event` name, e.g. capture({ event: "feedback_submitted" }); skipping.')
        return Promise.resolve()
      }
      const event = baseEvent(MCPAnalyticsEventType.custom, data)
      event.eventName = data.event
      return emit(event)
    },
  }
}

/**
 * Builds the shared scaffold for a manual event: event type, identity/session
 * routing, groups, person `$set`, and custom properties. Method callers layer
 * the event-specific fields on top.
 */
function baseEvent(eventType: MCPAnalyticsEventType, common: ManualCaptureCommon): McpEvent {
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
