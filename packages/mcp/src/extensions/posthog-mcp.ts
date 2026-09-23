import { PostHog, type PostHogOptions } from 'posthog-node'

import type {
  FeedbackCaptureData,
  AnalyticsParameterOwnership,
  CollectFeedbackOptions,
  CollectFeedbackConfig,
  InitializeCaptureData,
  JsonRecord,
  MCPAnalyticsOptions,
  McpCaptureCommon,
  McpEvent,
  MissingCapabilityCaptureData,
  PreparedToolCall,
  PreparedToolResult,
  PrepareToolCallOptions,
  PrepareToolListOptions,
  ToolCallCaptureData,
  ToolsListCaptureData,
} from '../types'
import {
  buildFeedbackEventProperties,
  buildFeedbackIntent,
  getFeedbackToolDescriptor,
  parseFeedbackReport,
  resolveCollectFeedbackOptions,
  SEND_FEEDBACK_TOOL_NAME,
} from './feedback'
import { getAnalyticsParameterOwnership, stripOwnedAnalyticsArguments } from './analytics-parameters'
import {
  addConversationIdToTools,
  canInjectConversationIdPromptBack,
  injectConversationIdPromptBack,
  resolveConversationId,
} from './conversation-id'
import {
  addContextParameterToTools,
  getContextDescription,
  isContextEnabled,
  type ContextInjectableTool,
} from './context-parameters'
import { MCPAnalyticsEventType } from './event-types'
import { captureException } from './exceptions'
import { normalizeHeaderString } from './headers'
import { applyMcpLibIdentity } from './lib-identity'
import { log } from './logger'
import {
  addModelParameterToTool,
  getModelDescription,
  isCaptureModelEnabled,
  resolveModel,
  setEventModel,
} from './model-parameters'
import { McpEventSink } from './sink'
import { addInstructionsToOutputSchemas, mirrorInstructionsIntoStructuredContent } from './output-instructions'
import { deriveSessionIdFromConversation } from './session'
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
  /**
   * Enable + configure the `send_feedback` virtual tool: injected by
   * {@link PostHogMCP.prepareToolList} (when its `collectFeedback` toggle is on)
   * and detected by {@link PostHogMCP.prepareToolCall}. Set once here so
   * injection and detection can't drift — without this option, `prepareToolCall`
   * never flags a call as feedback, so a real tool that uses the name is not
   * shadowed. Pick a `toolName` no real tool uses. `onFeedback` is ignored on
   * this path — the host dispatcher routes reports itself via
   * {@link PreparedToolCall.feedbackReport}.
   */
  collectFeedback?: CollectFeedbackConfig
  /**
   * Capture the calling model from recognized client metadata, with an injected
   * `llm_model` argument as fallback. On by default; `false` disables it.
   */
  captureModel?: MCPAnalyticsOptions['captureModel']
  /**
   * Correlate calls with an agent-carried `conversation_id` and a derived
   * PostHog session id. On by default; `false` leaves schemas, arguments, tool
   * results, and capture data unchanged.
   */
  enableConversationId?: boolean
}

interface PreparedConversationState {
  minted: boolean
  outputInstructions: boolean
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
 * const posthog = new PostHogMCP("phc_your_project_token", {
 *   host: "https://us.i.posthog.com",
 *   captureModel: true,
 * })
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
  readonly #sink = new McpEventSink(this)

  // The virtual-tool config lives here (not on the per-call options) so that
  // prepareToolList (inject) and prepareToolCall (detect) always agree.
  readonly #missingCapabilityToolName: string
  // `undefined` is the enable switch's off state: without it, prepareToolCall
  // must never claim a call named like the virtual tool — the host may have a
  // real tool by that name, and flagging it would shadow the real handler.
  readonly #feedbackOptions: CollectFeedbackOptions | undefined
  readonly #captureModel: MCPAnalyticsOptions['captureModel']
  readonly #enableConversationId: boolean
  readonly #analyticsParameterOwnership = new Map<string, AnalyticsParameterOwnership>()
  readonly #preparedConversationState = new WeakMap<PreparedToolCall, PreparedConversationState>()

  constructor(apiKey: string, options: PostHogMCPOptions = {}) {
    super(apiKey, options)
    this.#missingCapabilityToolName = options.missingCapabilityToolName ?? GET_MORE_TOOLS_NAME
    this.#feedbackOptions = resolveCollectFeedbackOptions(options.collectFeedback)
    // Fail fast on a config error (reserved extra key, undeclared extraRequired)
    // instead of first surfacing it when a tools/list is served.
    getFeedbackToolDescriptor(this.#feedbackOptions)
    if (this.#feedbackOptions?.onFeedback) {
      log(
        'Warning: collectFeedback.onFeedback is ignored on the PostHogMCP path - route reports from your dispatcher via prepareToolCall().feedbackReport instead.'
      )
    }
    this.#captureModel = options.captureModel
    this.#enableConversationId = options.enableConversationId ?? true
    applyMcpLibIdentity(this)
  }

  get #feedbackToolName(): string {
    return this.#feedbackOptions?.toolName ?? SEND_FEEDBACK_TOOL_NAME
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
    setEventModel(event, data.llmModel, data.llmModelSource)
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
   * captured as `$mcp_intent`), injects `llm_model` when the constructor's
   * `captureModel` option is enabled, and injects the optional `conversation_id`
   * handle by default. It appends `get_more_tools` when `reportMissing` is on and
   * `send_feedback` when `collectFeedback` is on. Returns a new array; your tools
   * are untouched.
   *
   * The appended `get_more_tools` descriptor carries only the base MCP tool fields
   * (name, description, input schema) — not any framework-specific fields your
   * `TTool` may add (e.g. a `handler`). It is meant to be detected via
   * {@link prepareToolCall}'s `isMissingCapability`, not dispatched through a handler.
   *
   * Call this when there is no `Server` to wrap — it does for a custom dispatcher
   * what `instrument()` does for a `Server`. Pair it with
   * {@link prepareToolCall} on the inbound side and {@link prepareToolResult} on
   * the outbound side.
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
    const ownershipSources: TTool[] = [...tools]

    if (options.reportMissing && !prepared.some((tool) => tool?.name === this.#missingCapabilityToolName)) {
      const virtualTool = getReportMissingToolDescriptor(this.#missingCapabilityToolName) as TTool
      prepared = [...prepared, virtualTool]
      ownershipSources.push(virtualTool)
    }

    if (
      options.collectFeedback &&
      this.#feedbackOptions !== undefined &&
      !prepared.some((tool) => tool?.name === this.#feedbackToolName)
    ) {
      const virtualTool = getFeedbackToolDescriptor(this.#feedbackOptions) as TTool
      prepared = [...prepared, virtualTool]
      ownershipSources.push(virtualTool)
    }

    this.#analyticsParameterOwnership.clear()
    const ownershipByName = collectAnalyticsParameterOwnership(ownershipSources)
    for (const [toolName, ownership] of ownershipByName) {
      this.#analyticsParameterOwnership.set(toolName, ownership)
    }

    if (isCaptureModelEnabled(this.#captureModel)) {
      const modelDescription = getModelDescription(this.#captureModel)
      prepared = prepared.map((tool) =>
        typeof tool.name === 'string' && ownershipByName.get(tool.name)?.llmModel === false
          ? tool
          : addModelParameterToTool(tool, modelDescription)
      )
    }

    if (this.#enableConversationId) {
      prepared = prepared.map((tool) =>
        typeof tool.name === 'string' && ownershipByName.get(tool.name)?.conversationId === false
          ? tool
          : addConversationIdToTools([tool])[0]
      )
      prepared = prepared.map((tool) =>
        typeof tool.name === 'string' && ownershipByName.get(tool.name)?.outputInstructions === false
          ? tool
          : addInstructionsToOutputSchemas([tool])[0]
      )
    }
    return prepared
  }

  /**
   * Read an incoming `tools/call` before you dispatch it: pulls analytics values
   * from SDK-owned arguments, strips those arguments before validation, and flags
   * whether the call targeted the `get_more_tools` virtual tool.
   *
   * Dispatch the returned `args` to your tool. Then pass the tool result and
   * this prepared call to {@link prepareToolResult}. Use its result as the MCP
   * response and its session and conversation values with
   * {@link captureToolCall}.
   *
   * On stateless or multi-replica servers, pass the original tool descriptor
   * so ownership does not depend on which process served `tools/list`.
   *
   * This only extracts the explicit `context` argument (`intentSource:
   * 'context_parameter'`); it does not infer intent. If you run your own
   * inference, pass that string with `intentSource: 'inferred'` straight to
   * {@link captureToolCall} (the `instrument()` path's `intentFallback`
   * equivalent).
   *
   * @example
   * ```ts
   * const originalTool = myTools.find((tool) => tool.name === name)
   * const preparedCall = posthog.prepareToolCall(name, rawArgs, {
   *     originalTool,
   *     requestMeta: request.params?._meta,
   *   })
   * if (preparedCall.isMissingCapability) {
   *   const preparedResult = posthog.prepareToolResult(getMoreToolsResult(), preparedCall)
   *   posthog.captureMissingCapability({
   *     context: preparedCall.intent,
   *     sessionId: preparedResult.sessionId,
   *     conversationId: preparedResult.conversationId,
   *     ...identity,
   *   })
   *   return preparedResult.result
   * }
   * const toolResult = await runTool(name, preparedCall.args)
   * const preparedResult = posthog.prepareToolResult(toolResult, preparedCall)
   * posthog.captureToolCall({
   *   toolName: name,
   *   intent: preparedCall.intent,
   *   sessionId: preparedResult.sessionId,
   *   conversationId: preparedResult.conversationId,
   *   ...identity,
   * })
   * return preparedResult.result
   * ```
   */
  prepareToolCall(
    name: string,
    args?: Record<string, unknown>,
    options: PrepareToolCallOptions = {}
  ): PreparedToolCall {
    const rawContext = args?.context
    const intent = typeof rawContext === 'string' && rawContext.trim() ? rawContext.trim() : undefined
    const ownership = options.originalTool
      ? getAnalyticsParameterOwnership(options.originalTool.inputSchema, options.originalTool.outputSchema)
      : this.#analyticsParameterOwnership.get(name)
    const ownsModel = isCaptureModelEnabled(this.#captureModel) && ownership?.llmModel === true
    const resolvedModel = isCaptureModelEnabled(this.#captureModel)
      ? resolveModel({ params: { arguments: args, _meta: options.requestMeta } }, ownsModel)
      : undefined
    const strippedArgs = stripContext(args)
    const canReadConversationId = this.#enableConversationId && (ownership?.conversationId ?? true)
    const resolvedConversation = resolveConversationId(canReadConversationId, args)
    const conversation =
      resolvedConversation.minted && options.sessionId
        ? ({ minted: false, conversationId: undefined } as const)
        : resolvedConversation
    const conversationId = conversation.conversationId
    const sessionId = conversationId ? deriveSessionIdFromConversation(conversationId) : options.sessionId
    // A supplied `originalTool` is a real application tool by this name (it
    // comes from the host's own list, which never holds the virtual tool), so
    // the real tool wins — the stateless twin of instrument()'s listing-derived
    // collision handling. Without it the name match stands, and the documented
    // remedy for a collision is configuring a non-colliding `toolName`.
    const isFeedback =
      this.#feedbackOptions !== undefined && name === this.#feedbackToolName && options.originalTool == null
    const preparedCall: PreparedToolCall = {
      intent,
      intentSource: intent ? 'context_parameter' : undefined,
      llmModel: resolvedModel?.model,
      llmModelSource: resolvedModel?.source,
      args: stripOwnedAnalyticsArguments(strippedArgs, {
        context: false,
        conversationId: this.#enableConversationId && ownership?.conversationId === true,
        llmModel: ownsModel,
      }) as Record<string, unknown> | undefined,
      sessionId,
      conversationId,
      isMissingCapability: name === this.#missingCapabilityToolName,
      isFeedback,
      feedbackReport: isFeedback ? parseFeedbackReport(args, this.#feedbackOptions) : undefined,
    }
    this.#preparedConversationState.set(preparedCall, {
      minted: conversation.minted,
      outputInstructions: this.#enableConversationId && ownership?.outputInstructions === true,
    })
    return preparedCall
  }

  /**
   * Add the conversation handle to a tool result without changing the original
   * value. A new handle is appended to text content once. When the advertised
   * output schema supports it, the handle is also mirrored into
   * `structuredContent`.
   *
   * Use the returned session and conversation values for capture. If a new
   * handle could not reach the client, the conversation value is omitted while
   * the derived session value is kept.
   */
  prepareToolResult<TResult>(result: TResult, preparedCall: PreparedToolCall): PreparedToolResult<TResult> {
    const state = this.#preparedConversationState.get(preparedCall)
    const conversationId = preparedCall.conversationId
    if (!conversationId || !state) {
      return { result, sessionId: preparedCall.sessionId, conversationId }
    }

    let preparedResult: unknown = result
    let delivered = false
    if (state.outputInstructions) {
      const mirrored = mirrorInstructionsIntoStructuredContent(preparedResult, conversationId)
      delivered = mirrored !== preparedResult
      preparedResult = mirrored
    }
    if (state.minted && canInjectConversationIdPromptBack(preparedResult)) {
      preparedResult = injectConversationIdPromptBack(preparedResult, conversationId)
      delivered = true
    }

    return {
      result: preparedResult as TResult,
      sessionId: preparedCall.sessionId,
      conversationId: state.minted && !delivered ? undefined : conversationId,
    }
  }

  /**
   * Capture a `get_more_tools` call as a missing-capability report. Emits
   * `$mcp_missing_capability` with the agent's description as `$mcp_intent`. Reply
   * to the agent with `getMoreToolsResult()` after passing it through
   * {@link prepareToolResult}.
   */
  captureMissingCapability(data: MissingCapabilityCaptureData): void {
    const event = baseEvent(MCPAnalyticsEventType.mcpMissingCapability, data)
    event.resourceName = this.#missingCapabilityToolName
    event.parameters = data.parameters
    applyIntent(event, data.context, 'context_parameter')
    setEventModel(event, data.llmModel, data.llmModelSource)
    this.#emit(event)
  }

  /**
   * Capture a `send_feedback` call as an agent-feedback report. Emits
   * `$mcp_feedback` with the report's `$mcp_feedback_*` properties and its
   * summary/details as `$mcp_intent`. Reply to the agent with
   * `sendFeedbackResult()` (or a custom text) after routing the report to your
   * own feedback backend and passing the reply through {@link prepareToolResult}.
   */
  captureFeedback(data: FeedbackCaptureData): void {
    const event = baseEvent(MCPAnalyticsEventType.mcpFeedback, data)
    event.resourceName = this.#feedbackToolName
    // Deliberately no `$mcp_parameters`: the arguments are agent-narrated free
    // text, and the PII-redacted `$mcp_feedback_*` properties are the captured
    // surface. Raw arguments would bypass that redaction. Feedback properties
    // win over the caller's, matching the instrument() path's spread order.
    event.properties = { ...event.properties, ...buildFeedbackEventProperties(data.report) }
    applyIntent(event, buildFeedbackIntent(data.report), 'context_parameter')
    setEventModel(event, data.llmModel, data.llmModelSource)
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
    conversationId: common.conversationId,
    protocolVersion: common.protocolVersion,
    // There is no `extra` on this path, so the host reads the request headers and
    // passes them per capture — the SDK has no transport to read them from. Normalized
    // with the same rules `instrument()` applies, so one request yields one set of
    // properties whichever path captured it.
    clientUserAgent: normalizeHeaderString(common.clientUserAgent),
    vendorClient: normalizeHeaderString(common.vendorClient),
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

function collectAnalyticsParameterOwnership<TTool extends ContextInjectableTool>(
  tools: TTool[]
): Map<string, AnalyticsParameterOwnership> {
  const ownershipByName = new Map<string, AnalyticsParameterOwnership>()
  for (const tool of tools) {
    if (typeof tool.name !== 'string') {
      continue
    }
    const next = getAnalyticsParameterOwnership(tool.inputSchema, tool.outputSchema)
    const current = ownershipByName.get(tool.name)
    ownershipByName.set(
      tool.name,
      current
        ? {
            context: current.context && next.context,
            conversationId: current.conversationId && next.conversationId,
            llmModel: current.llmModel && next.llmModel,
            outputInstructions: current.outputInstructions && next.outputInstructions,
          }
        : next
    )
  }
  return ownershipByName
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
