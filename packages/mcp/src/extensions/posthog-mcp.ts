import { PostHog, type PostHogOptions } from 'posthog-node'

import type {
  InitializeCaptureData,
  JsonRecord,
  McpCaptureCommon,
  McpEvent,
  MissingCapabilityCaptureData,
  PreparedToolCall,
  PrepareToolListOptions,
  ToolCallCaptureData,
  ToolsListCaptureData,
} from '../types'
import {
  addContextParameterToTools,
  getContextDescription,
  isContextEnabled,
  type ContextInjectableTool,
} from './context-parameters'
import { MCPAnalyticsEventType } from './event-types'
import { captureException } from './exceptions'
import { log } from './logger'
import { McpEventSink } from './sink'
import { GET_MORE_TOOLS_NAME, getReportMissingToolDescriptor } from './tools'

/**
 * Options for {@link PostHogMCP}. A superset of `posthog-node`'s options, plus
 * MCP-specific knobs.
 */
export interface PostHogMCPOptions extends PostHogOptions {
  /**
   * Name of the virtual "report a missing capability" tool injected by
   * {@link PostHogMCP.prepareToolList} and detected by
   * {@link PostHogMCP.prepareToolCall}. Set once here so injection and detection
   * can't drift. Defaults to `get_more_tools`.
   */
  missingCapabilityToolName?: string
}

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

  // The get_more_tools name lives here (not on the per-call options) so that
  // prepareToolList (inject) and prepareToolCall (detect) always agree.
  readonly #missingCapabilityToolName: string

  constructor(apiKey: string, options: PostHogMCPOptions = {}) {
    super(apiKey, options)
    this.#missingCapabilityToolName = options.missingCapabilityToolName ?? GET_MORE_TOOLS_NAME
  }

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
    event.errorType = data.errorType
    applyIntent(event, data.intent, data.intentSource)
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
   * Capture a `tools/list` response. Emits `$mcp_tools_list` carrying the
   * advertised tool names (`$mcp_listed_tool_names`), which powers
   * "advertised but never called" analysis. Pass the names you're about to
   * return — typically the result of {@link prepareToolList}.
   */
  captureToolsList(data: ToolsListCaptureData): void {
    const event = baseEvent(MCPAnalyticsEventType.mcpToolsList, data)
    event.listedToolNames = data.toolNames
    event.parameters = data.parameters
    event.response = data.response
    event.duration = data.durationMs
    event.isError = data.isError
    event.errorType = data.errorType
    if (data.isError) {
      event.error = captureException(data.error ?? 'tools/list failed')
    }
    this.#emit(event)
  }

  /**
   * Decorate your `tools/list` response with PostHog's analytics affordances:
   * injects the `context` argument into every tool (so agents state their intent,
   * captured as `$mcp_intent`) and, when `reportMissing` is on, appends the
   * `get_more_tools` virtual tool (rename it via the `missingCapabilityToolName`
   * constructor option). Returns a new array; your tools are untouched.
   *
   * The appended `get_more_tools` descriptor carries only the base MCP tool fields
   * (name, description, input schema) — not any framework-specific fields your
   * `TTool` may add (e.g. a `handler`). It is meant to be detected via
   * {@link prepareToolCall}'s `isMissingCapability`, not dispatched through a handler.
   *
   * Call this when there is no `Server` to wrap — it does for a custom dispatcher
   * what `instrument()` does for a `Server`. Pair it with {@link prepareToolCall}
   * on the inbound side.
   *
   * @example
   * ```ts
   * // building your tools/list response
   * return { tools: posthog.prepareToolList(myTools, { reportMissing: true }) }
   * ```
   */
  prepareToolList<TTool extends ContextInjectableTool>(tools: TTool[], options: PrepareToolListOptions = {}): TTool[] {
    const contextOption = options.context ?? true
    let prepared = isContextEnabled(contextOption)
      ? addContextParameterToTools(tools, getContextDescription(contextOption))
      : [...tools]

    if (options.reportMissing && !prepared.some((tool) => tool?.name === this.#missingCapabilityToolName)) {
      prepared = [...prepared, getReportMissingToolDescriptor(this.#missingCapabilityToolName) as TTool]
    }
    return prepared
  }

  /**
   * Read an incoming `tools/call` before you dispatch it: pulls the agent's
   * intent off the injected `context` argument, strips `context` from the
   * arguments (so your handler and its schema validation never see it), and flags
   * whether the call targeted the `get_more_tools` virtual tool.
   *
   * Pass the returned `intent` / `intentSource` to {@link captureToolCall}, and
   * dispatch the returned `args` to your tool.
   *
   * This only extracts the explicit `context` argument (`intentSource:
   * 'context_parameter'`); it does not infer intent. If you run your own
   * inference, pass that string with `intentSource: 'inferred'` straight to
   * {@link captureToolCall} (the `instrument()` path's `intentFallback`
   * equivalent).
   *
   * @example
   * ```ts
   * const { intent, intentSource, args, isMissingCapability } = posthog.prepareToolCall(name, rawArgs)
   * if (isMissingCapability) {
   *   posthog.captureMissingCapability({ context: intent, ...identity })
   *   return getMoreToolsResult()
   * }
   * const result = await runTool(name, args)
   * posthog.captureToolCall({ toolName: name, intent, intentSource, ...identity })
   * ```
   */
  prepareToolCall(name: string, args?: Record<string, unknown>): PreparedToolCall {
    const rawContext = args?.context
    const intent = typeof rawContext === 'string' && rawContext.trim() ? rawContext.trim() : undefined
    return {
      intent,
      intentSource: intent ? 'context_parameter' : undefined,
      args: stripContext(args),
      isMissingCapability: name === this.#missingCapabilityToolName,
    }
  }

  /**
   * Capture a `get_more_tools` call as a missing-capability report. Emits
   * `$mcp_missing_capability` with the agent's description as `$mcp_intent`. Reply
   * to the agent with `getMoreToolsResult()`.
   */
  captureMissingCapability(data: MissingCapabilityCaptureData): void {
    const event = baseEvent(MCPAnalyticsEventType.mcpMissingCapability, data)
    event.resourceName = this.#missingCapabilityToolName
    event.parameters = data.parameters
    applyIntent(event, data.context, 'context_parameter')
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

/**
 * Set the agent intent on an event → `$mcp_intent` / `$mcp_intent_source`. No-op
 * for blank intents, so a missing `context` argument simply leaves them off.
 */
function applyIntent(event: McpEvent, intent: string | undefined, source: McpEvent['userIntentSource']): void {
  const trimmed = typeof intent === 'string' ? intent.trim() : ''
  if (!trimmed) {
    return
  }
  event.userIntent = trimmed
  event.userIntentSource = source ?? 'context_parameter'
}

/** Return a shallow copy of the arguments with the injected `context` key removed. */
function stripContext(args: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!args || !('context' in args)) {
    return args
  }
  const { context: _context, ...rest } = args
  return rest
}
