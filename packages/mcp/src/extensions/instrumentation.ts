// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import type {
  AnalyticsParameterOwnership,
  CompatibleRequestHandlerExtra,
  CompatibleToolsListLike,
  MCPAnalyticsData,
  MCPRequestLike,
  MCPServerLike,
  McpEvent,
  ServerClientInfoLike,
  SessionInfo,
} from '../types'
import { getAnalyticsParameterOwnership, stripOwnedAnalyticsArguments } from './analytics-parameters'
import { addContextParameterToTools, getContextDescription, isContextEnabled } from './context-parameters'
import {
  addConversationIdToTools,
  type ConversationIdResolution,
  canInjectConversationIdPromptBack,
  injectConversationIdPromptBack,
  resolveConversationId,
} from './conversation-id'
import { stampClientIdentity } from './client-identity'
import { stampTransportIdentity } from './transport-identity'
import { addInstructionsToOutputSchemas, mirrorInstructionsIntoStructuredContent } from './output-instructions'
import { captureEvent } from './capture'
import { MCPAnalyticsEventType } from './event-types'
import { captureException } from './exceptions'
import { resolveToolCallIntent, setEventIntent, setExplicitContextIntent } from './intent'
import { getServerTrackingData, handleIdentify, setServerTrackingData, withIdentity } from './internal'
import type { LoggerFn } from './logger'
import { buildCapturedMcpParameters } from './mcp-payloads'
import { readRequestHandlerMethod } from './mcp-sdk-compat'
import { getRequestHeaders } from './request-headers'
import { getSessionId, getSessionInfo, isModernEraRequest, newSessionId } from './session'
import { encodeSessionId, readMcpSessionHeader, writeSessionIdToTransport } from './session-token'
import { getReportMissingToolDescriptor, resolveMissingCapabilityToolName } from './tools'
import { applyResolvedMetadata, isToolResultError } from './tracing-helpers'

/**
 * Single instrumentation core shared by the low-level (`Server`) and high-level
 * (`McpServer`) wrappers. The two entrypoints differ only in how they reach the
 * underlying tool — they both funnel the tool-call lifecycle through
 * {@link captureToolCall}, so error handling, conversation-id minting, session
 * attribution, and event capture are defined exactly once.
 */

type MCPRequestHandler = (request: MCPRequestLike, extra?: CompatibleRequestHandlerExtra) => Promise<unknown>

/** Runs the underlying tool with SDK-owned analytics arguments removed. */
type ToolExecutor = (downstreamRequest: MCPRequestLike) => Promise<unknown>

interface TraceToolCallParams {
  server: MCPServerLike
  data: MCPAnalyticsData
  request: MCPRequestLike
  extra?: CompatibleRequestHandlerExtra
  execute: ToolExecutor
  /** Optional schema-derived ownership override for adapters with direct registry access. */
  parameterOwnership?: AnalyticsParameterOwnership
  /**
   * Event type to capture. Defaults to a tool call; the `get_more_tools` virtual
   * tool passes `mcpMissingCapability` so it records a capability gap rather than
   * a tool invocation.
   */
  eventType?: MCPAnalyticsEventType
  /**
   * When set, used verbatim as the captured intent (source `context_parameter`)
   * instead of running `resolveToolCallIntent`. Used by the `get_more_tools`
   * virtual tool, which carries its intent in the `context` argument.
   */
  explicitContextIntent?: string
  /**
   * Optional accessor for an error the executor captured out-of-band. The
   * high-level SDK turns thrown tool errors into `isError: true` results before
   * they reach us, so the wrapped callback stashes the original error and we
   * read it here to capture the real stack rather than the result envelope.
   */
  takeCapturedError?: () => unknown
}

/**
 * The shared tool-call lifecycle: resolve conversation id, build + enrich the
 * analytics event, run the tool, then capture success/failure.
 *
 * Analytics is isolated from the tool path on both sides — a failure while
 * preparing or publishing the event can never change what the tool returns or
 * throws, and the tool's own errors are always re-thrown to the caller.
 */
export async function captureToolCall(params: TraceToolCallParams): Promise<unknown> {
  const {
    server,
    data,
    request,
    extra,
    execute,
    parameterOwnership,
    eventType,
    explicitContextIntent,
    takeCapturedError,
  } = params
  const resolvedEventType = eventType ?? MCPAnalyticsEventType.mcpToolsCall
  const ownership = getActiveAnalyticsParameterOwnership(
    data,
    request.params?.name,
    parameterOwnership,
    resolvedEventType === MCPAnalyticsEventType.mcpMissingCapability
  )
  // Reading the argument and removing it are separate questions: deleting one the
  // application declared costs the customer their call, so the strip below still
  // requires positive ownership, while reading it when ownership is unresolved
  // costs at worst a mislabelled property. ADR-0011.
  const canCaptureContextIntent =
    resolvedEventType !== MCPAnalyticsEventType.mcpMissingCapability &&
    isContextEnabled(data.options.context) &&
    (ownership.context || !ownership.contextOwnershipKnown)
  const conversation = resolveConversationId(ownership.conversationId, request.params?.arguments)
  const downstreamRequest = cloneRequestWithoutOwnedAnalyticsArguments(request, ownership)

  // Prepare the event in isolation: if identity/metadata/intent resolution
  // throws, we drop instrumentation for this call but still run the tool.
  const startTime = new Date()
  const preparedEvent = await prepareToolCallEvent(
    server,
    data,
    request,
    downstreamRequest,
    extra,
    startTime,
    conversation,
    ownership,
    resolvedEventType,
    canCaptureContextIntent
  )
  if (preparedEvent && explicitContextIntent) {
    setExplicitContextIntent(preparedEvent.event, explicitContextIntent)
  }

  let result: unknown
  try {
    result = await execute(downstreamRequest)
  } catch (error) {
    publishFailedToolEvent(server, preparedEvent, error, startTime, conversation, data.logger)
    throw error
  }

  const finalResult = applyConversationInstructions(preparedEvent?.event ?? null, result, conversation, ownership)
  // `result`, not `finalResult`: the error is read from what the tool produced,
  // before the conversation handle was written into it. See below.
  publishSuccessfulToolEvent(server, preparedEvent, finalResult, startTime, data.logger, takeCapturedError, result)
  return finalResult
}

interface PreparedToolEvent {
  event: McpEvent
  requestAttribution: SessionInfo
}

/**
 * Ownership for one request, plus whether it could be resolved at all — "no
 * answer" must not read the same as "the application owns it".
 */
interface ActiveAnalyticsParameterOwnership extends AnalyticsParameterOwnership {
  contextOwnershipKnown: boolean
}

function getActiveAnalyticsParameterOwnership(
  data: MCPAnalyticsData,
  toolName: string | undefined,
  override: AnalyticsParameterOwnership | undefined,
  isMissingCapabilityTool: boolean
): ActiveAnalyticsParameterOwnership {
  const listed = toolName ? data.toolAnalyticsParameterOwnership.get(toolName) : undefined
  const ownership = override ?? listed
  return {
    contextOwnershipKnown: ownership !== undefined,
    context: !isMissingCapabilityTool && isContextEnabled(data.options.context) && ownership?.context === true,
    conversationId: data.options.enableConversationId === true && ownership?.conversationId === true,
    // Deliberately read off `listed`, never the override: only the advertised
    // JSON Schema can say whether `tools/list` declared `_mcp_instructions` (an
    // override is built from the live registry, which holds Zod on the
    // high-level path). An instance that never served a listing has no answer
    // and fails closed — writing an undeclared key fails the customer's entire
    // tool result under `additionalProperties: false`. See ADR-0004 for the
    // per-request-instance gap this leaves and the planned fix.
    outputInstructions: data.options.enableConversationId === true && listed?.outputInstructions === true,
  }
}

function cloneRequestWithoutOwnedAnalyticsArguments(
  request: MCPRequestLike,
  ownership: AnalyticsParameterOwnership
): MCPRequestLike {
  const args = request.params?.arguments
  const cleanedArgs = stripOwnedAnalyticsArguments(args, ownership)
  if (cleanedArgs === args || !request.params) {
    return request
  }
  return {
    ...request,
    params: {
      ...request.params,
      arguments: cleanedArgs as typeof request.params.arguments,
    },
  }
}

async function prepareToolCallEvent(
  server: MCPServerLike,
  data: MCPAnalyticsData,
  request: MCPRequestLike,
  downstreamRequest: MCPRequestLike,
  extra: CompatibleRequestHandlerExtra | undefined,
  startTime: Date,
  conversation: ConversationIdResolution,
  ownership: AnalyticsParameterOwnership,
  eventType: MCPAnalyticsEventType,
  canCaptureContextIntent: boolean
): Promise<PreparedToolEvent | null> {
  try {
    const sessionId = getSessionId(server, extra, conversation.conversationId)
    // Snapshot token/client/protocol metadata synchronously, before identify or
    // metadata callbacks can yield and let another request replace shared state.
    const sessionInfo = getSessionInfo(server, data, sessionId)
    const identity = await handleIdentify(
      server,
      data,
      sessionId,
      request,
      sessionInfo,
      extra,
      !!conversation.conversationId
    )
    const requestAttribution = withIdentity(sessionInfo, identity)

    const toolName = request.params?.name
    const event: McpEvent = {
      sessionId,
      conversationId: conversation.conversationId,
      resourceName: toolName || 'Unknown Tool Name',
      parameters: buildCapturedMcpParameters(downstreamRequest),
      eventType,
      timestamp: startTime,
      toolCategory: toolName ? data.toolCategories.get(toolName) : undefined,
      toolDescription: toolName ? data.toolDescriptions.get(toolName) : undefined,
    }
    // Modern (stateless) clients carry client name/version + protocol version in
    // `_meta` on every request rather than at `initialize`; stamp them onto this
    // event now so concurrent requests can't cross-attribute it.
    stampClientIdentity(event, request, extra, server)
    // Which *surface* of the client made this call lives only in the request
    // headers (HTTP transports); `clientInfo` can't tell a vendor's products apart.
    stampTransportIdentity(event, extra)

    await applyResolvedMetadata(event, data, request, extra)
    setEventIntent(event, await resolveToolCallIntent(data, request, canCaptureContextIntent, extra))
    return { event, requestAttribution }
  } catch (error) {
    data.logger(
      `Warning: PostHog MCP analytics instrumentation failed for tool ${request.params?.name}, the tool will still run - ${error}`
    )
    return null
  }
}

/**
 * Delivers the conversation session handle back to the agent over both channels
 * a tool result has: mirrored into `structuredContent` on every response (for
 * tools whose output schema declares the key), and as a `content` text block on
 * the minting response only. Why two channels and why those cadences: ADR-0004.
 *
 * If neither channel could carry a session handle we minted, the agent never
 * received it, so clear it off the event rather than showing analytics an id
 * nobody has.
 */
function applyConversationInstructions(
  event: McpEvent | null,
  result: unknown,
  conversation: ConversationIdResolution,
  ownership: AnalyticsParameterOwnership
): unknown {
  const conversationId = conversation.conversationId
  if (!conversationId) {
    return result
  }

  let updated = result
  let delivered = false

  if (ownership.outputInstructions) {
    const mirrored = mirrorInstructionsIntoStructuredContent(updated, conversationId)
    delivered = mirrored !== updated
    updated = mirrored
  }

  if (conversation.minted && canInjectConversationIdPromptBack(updated)) {
    updated = injectConversationIdPromptBack(updated, conversationId)
    delivered = true
  }

  // Only a minted session handle can be lost this way — one the agent supplied, it has.
  if (!delivered && conversation.minted && event) {
    event.conversationId = undefined
  }

  return updated
}

/**
 * @param result - what the caller receives, conversation handle included.
 * @param resultBeforeInstructions - the same result as the tool produced it.
 *
 * The two differ once `enableConversationId` mints a handle, and the difference
 * matters for errors. A tool that fails returns its message in `content`, and on
 * MCP SDK v2 that flattened `isError` result is the only description of the
 * failure we get — the throw never reaches our callback wrapper. Reading the
 * error off the *delivered* result would therefore append the prompt-back to it,
 * putting a fresh uuid inside `$mcp_error_message` on every failed call and
 * splitting one recurring failure into as many groups as there were calls.
 */
function publishSuccessfulToolEvent(
  server: MCPServerLike,
  preparedEvent: PreparedToolEvent | null,
  result: unknown,
  startTime: Date,
  logger: LoggerFn,
  takeCapturedError?: () => unknown,
  resultBeforeInstructions?: unknown
): void {
  if (!preparedEvent) {
    return
  }
  const { event, requestAttribution } = preparedEvent
  try {
    if (isToolResultError(result)) {
      event.isError = true
      const capturedError = takeCapturedError?.()
      event.error = captureException(capturedError ?? resultBeforeInstructions ?? result)
    } else {
      event.isError = false
    }
    event.response = result
    event.duration = Date.now() - startTime.getTime()
    captureEvent(server, event, logger, requestAttribution)
  } catch (error) {
    logger(`Warning: PostHog MCP analytics failed to publish tool event - ${error}`)
  }
}

function publishFailedToolEvent(
  server: MCPServerLike,
  preparedEvent: PreparedToolEvent | null,
  error: unknown,
  startTime: Date,
  conversation: ConversationIdResolution,
  logger: LoggerFn
): void {
  if (!preparedEvent) {
    return
  }
  const { event, requestAttribution } = preparedEvent
  try {
    if (conversation.minted) {
      event.conversationId = undefined
    }
    event.isError = true
    event.error = captureException(error)
    event.duration = Date.now() - startTime.getTime()
    captureEvent(server, event, logger, requestAttribution)
  } catch (publishError) {
    logger(`Warning: PostHog MCP analytics failed to publish failed tool event - ${publishError}`)
  }
}

// --- tools/list -----------------------------------------------------------

/**
 * A method's patch: runs the original handler and captures analytics. `server`
 * and `originalHandler` are bound by {@link patchRequestHandlers}; the SDK
 * supplies `request` and `extra` per call.
 */
export type HandlerPatch = (
  server: MCPServerLike,
  originalHandler: MCPRequestHandler,
  request: MCPRequestLike,
  extra: CompatibleRequestHandlerExtra | undefined
) => Promise<unknown>

/** Pre-patch handlers, kept so `isToolAdvertised` can query the raw listing. */
const originalRequestHandlers = new WeakMap<MCPServerLike, Map<string, MCPRequestHandler>>()

function rememberOriginalRequestHandler(
  server: MCPServerLike,
  handlerName: string,
  originalHandler: MCPRequestHandler
): void {
  let handlers = originalRequestHandlers.get(server)
  if (!handlers) {
    handlers = new Map()
    originalRequestHandlers.set(server, handlers)
  }
  handlers.set(handlerName, originalHandler)
}

/**
 * Registers a synthetic fallback handler for `handlerName`, already wrapped in
 * `patch`, by writing straight into `_requestHandlers` instead of going through
 * `setRequestHandler`.
 *
 * Bypassing the SDK setter is deliberate, on three counts:
 *
 * - **Capability assertion.** `setRequestHandler` refuses a method the server
 *   never declared a capability for, so instrumenting a low-level server built
 *   without `capabilities.tools` used to throw `Server does not support tools`
 *   and leave instrumentation half-applied. Our fallback is not a capability the
 *   server offers — it exists only so a call for a tool nobody claims is still
 *   captured — so the assertion has nothing to protect here.
 * - **Schema validation.** The setter also wraps the handler in request/result
 *   parsing, which a handler that can only ever throw `Unknown tool` never needs.
 * - **Portability.** The setter's first argument is a Zod schema on SDK v1 and a
 *   method string on v2; the map key is the same string on both, so this is the
 *   one registration form that does not need to know which major it is talking
 *   to — and it drops the last runtime `@modelcontextprotocol/sdk` import from
 *   the shipped bundle.
 */
export function registerFallbackRequestHandler(
  server: MCPServerLike,
  handlerName: string,
  fallbackHandler: MCPRequestHandler,
  patch: HandlerPatch
): void {
  rememberOriginalRequestHandler(server, handlerName, fallbackHandler)
  server._requestHandlers.set(handlerName, (request, extra) => patch(server, fallbackHandler, request, extra))
}

/**
 * Applies the `patches` (keyed by method, e.g. `initialize`, `tools/list`) to the
 * handlers already registered, and patches `setRequestHandler` so matching
 * handlers registered later are patched too. The latter is what makes adapters
 * that register handlers post-construction work — e.g. `@rekog/mcp-nest` hands a
 * bare server to instrument() and only then registers its handlers.
 */
export function patchRequestHandlers(server: MCPServerLike, patches: Record<string, HandlerPatch>): void {
  for (const [handlerName, patch] of Object.entries(patches)) {
    const originalHandler = server._requestHandlers.get(handlerName)
    if (originalHandler) {
      rememberOriginalRequestHandler(server, handlerName, originalHandler)
      server._requestHandlers.set(handlerName, (request, extra) => patch(server, originalHandler, request, extra))
    }
  }

  // Monkey patch dynamically added handlers (registered after instrument()).
  //
  // Variadic, and every argument is forwarded verbatim. The registration form is
  // the SDK's business, not ours — only *that* a registration happened is ours.
  // SDK v2 has a three-argument form for custom methods,
  // `setRequestHandler(method, { params, result }, handler)`, and a two-parameter
  // wrapper drops the handler: the SDK then sees the schemas object where the
  // handler should be and throws `setRequestHandler: handler is required`, which
  // takes down the host server rather than just our instrumentation.
  const originalSetRequestHandler = server.setRequestHandler.bind(server) as (...args: unknown[]) => unknown
  server.setRequestHandler = ((...args: unknown[]) => {
    const handlerName = readRequestHandlerMethod(args[0])
    // `hasOwnProperty`, not a bare index: `handlerName` is now an arbitrary
    // caller-supplied string, and a custom method named `toString` would
    // otherwise resolve to an inherited function and be treated as a patch.
    const patch =
      handlerName !== undefined && Object.prototype.hasOwnProperty.call(patches, handlerName)
        ? patches[handlerName]
        : undefined
    if (handlerName === undefined || !patch) {
      return originalSetRequestHandler(...args)
    }

    // Register first so the MCP SDK's request/result validation stays inside
    // our analytics wrapper, matching handlers that existed before instrument().
    const result = originalSetRequestHandler(...args)
    const registeredHandler = server._requestHandlers.get(handlerName)
    if (registeredHandler) {
      rememberOriginalRequestHandler(server, handlerName, registeredHandler)
      server._requestHandlers.set(handlerName, (request, extra) => patch(server, registeredHandler, request, extra))
    }
    return result
  }) as MCPServerLike['setRequestHandler']
}

/**
 * Checks the server's raw listing for a real owner of a candidate virtual tool.
 * This does not depend on a previous client request and does not call the
 * instrumented list wrapper, so it neither injects PostHog tools nor captures a
 * synthetic tools/list event. `undefined` fails open to the real dispatcher.
 */
export async function isToolAdvertised(
  server: MCPServerLike,
  toolName: string,
  extra: CompatibleRequestHandlerExtra | undefined,
  logger: LoggerFn
): Promise<boolean | undefined> {
  const listHandler = originalRequestHandlers.get(server)?.get('tools/list')
  if (!listHandler || !server._requestHandlers.has('tools/list')) {
    return undefined
  }

  try {
    const response = (await listHandler({ method: 'tools/list', params: {} }, extra)) as CompatibleToolsListLike
    if (!response || !Array.isArray(response.tools)) {
      return undefined
    }
    // Match the page the current list instrumentation can expose. Pagination
    // passthrough is handled separately from missing-capability ownership.
    return response.tools.some((tool) => tool?.name === toolName)
  } catch (error) {
    logger(
      `Warning: PostHog MCP analytics could not determine whether "${toolName}" is advertised; delegating to the server - ${error}`
    )
    return undefined
  }
}

/**
 * Captures each `tools/list` and injects the SDK-managed tools (context
 * parameter, conversation id, `get_more_tools`) into the returned list.
 */
export async function handleListToolsRequest(
  server: MCPServerLike,
  originalListToolsHandler: MCPRequestHandler,
  request: MCPRequestLike,
  extra: CompatibleRequestHandlerExtra | undefined,
  logger: LoggerFn
): Promise<{ tools: CompatibleToolsListLike['tools'] }> {
  const data = getServerTrackingData(server)
  const startTime = new Date()
  const sessionId = getSessionId(server, extra)
  // Snapshot before metadata resolution or the list handler can yield to a
  // concurrent request using the same instrumented server.
  const requestAttribution = getSessionInfo(server, data, sessionId)
  const event: McpEvent = {
    sessionId,
    parameters: buildCapturedMcpParameters(request),
    eventType: MCPAnalyticsEventType.mcpToolsList,
    timestamp: startTime,
  }
  stampClientIdentity(event, request, extra, server)
  stampTransportIdentity(event, extra)

  if (data) {
    await applyResolvedMetadata(event, data, request, extra)
  }

  const tools = await getTracedToolsList(
    server,
    originalListToolsHandler,
    request,
    extra,
    event,
    logger,
    requestAttribution
  )

  if (!data) {
    logger(
      'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called instrument(server, options) before using tool calls.'
    )
    return { tools }
  }

  if (tools.length === 0) {
    data.logger(
      'Warning: No tools found in the original list. This is likely due to the tools not being registered before PostHog MCP analytics.instrument().'
    )
    event.error = captureException('No tools were sent to MCP client.')
    event.isError = true
    event.duration = Date.now() - startTime.getTime()
    captureEvent(server, event, data.logger, requestAttribution)
    return { tools }
  }

  event.response = { tools }
  event.listedToolNames = collectListedToolNames(tools)
  event.isError = false
  event.duration = Date.now() - startTime.getTime()
  captureEvent(server, event, data.logger, requestAttribution)
  return { tools }
}

function cacheToolAnalyticsParameterOwnership(
  cache: Map<string, AnalyticsParameterOwnership>,
  tools: CompatibleToolsListLike['tools']
): void {
  // Merge pages and concurrent enumerations; repeated tool names overwrite stale schemas.
  for (const tool of tools) {
    if (tool?.name) {
      cache.set(tool.name, getAnalyticsParameterOwnership(tool.inputSchema, tool.outputSchema))
    }
  }
}

function collectListedToolNames(tools: CompatibleToolsListLike['tools'] | undefined): string[] | undefined {
  if (!tools || tools.length === 0) {
    return
  }
  const names = tools.map((tool) => tool?.name).filter((name): name is string => typeof name === 'string')
  return names.length > 0 ? names : undefined
}

async function getTracedToolsList(
  server: MCPServerLike,
  originalListToolsHandler: MCPRequestHandler,
  request: MCPRequestLike,
  extra: CompatibleRequestHandlerExtra | undefined,
  event: McpEvent,
  logger: LoggerFn,
  requestAttribution: SessionInfo
): Promise<CompatibleToolsListLike['tools']> {
  try {
    const data = getServerTrackingData(server)
    const originalResponse = (await originalListToolsHandler(request, extra)) as CompatibleToolsListLike
    // Injection must not mutate arrays reused or frozen by the server.
    let tools = [...(originalResponse.tools || [])]

    if (data) {
      cacheToolAnalyticsParameterOwnership(data.toolAnalyticsParameterOwnership, tools)
    }
    if (data && isContextEnabled(data.options.context)) {
      tools = addContextParameterToTools(tools, getContextDescription(data.options.context), data.logger)
    }

    if (data) {
      const missingToolName = resolveMissingCapabilityToolName(data.options)
      if (data.options.reportMissing) {
        const alreadyPresent = tools.some((tool) => tool?.name === missingToolName)
        if (alreadyPresent) {
          data.logger(
            `Warning: Cannot inject missing-capability tool "${missingToolName}" because a real tool already uses that name. The real tool will not be intercepted.`
          )
        } else {
          const virtualTool = getReportMissingToolDescriptor(missingToolName)
          tools.push(virtualTool)
          // Cached separately because the virtual tool is added after the listing
          // was cached, and its calls need ownership like any other tool's.
          cacheToolAnalyticsParameterOwnership(data.toolAnalyticsParameterOwnership, [virtualTool])
        }
      }

      if (data.options.enableConversationId) {
        tools = addConversationIdToTools(tools, data.logger)
        tools = addInstructionsToOutputSchemas(tools, data.logger)
      }
    }

    if (data) {
      cacheToolDescriptions(data.toolDescriptions, tools)
      cacheToolCategories(data.toolCategories, tools)
    }

    return tools
  } catch (error) {
    logger(
      `Warning: Original list tools handler failed, this suggests an error PostHog MCP analytics did not cause - ${error}`
    )
    event.error = captureException(error)
    event.isError = true
    event.duration = event.timestamp ? Date.now() - event.timestamp.getTime() : 0
    captureEvent(server, event, logger, requestAttribution)
    throw error
  }
}

export function cacheToolDescriptions(
  cache: Map<string, string>,
  tools: CompatibleToolsListLike['tools'] | undefined
): void {
  if (!tools) {
    return
  }
  for (const tool of tools) {
    if (tool?.name && typeof tool.description === 'string') {
      cache.set(tool.name, tool.description)
    }
  }
}

/**
 * Category declared on a tool's `_meta` block (the MCP spec allows arbitrary
 * `_meta` keys). Declaring `_meta: { category: "Logs" }` on a tool definition
 * is all a server needs for every call to carry `$mcp_tool_category`.
 */
export function readToolMetaCategory(meta: unknown): string | undefined {
  const category = (meta as Record<string, unknown> | null | undefined)?.category
  return typeof category === 'string' && category.length > 0 ? category : undefined
}

export function cacheToolCategories(
  cache: Map<string, string>,
  tools: CompatibleToolsListLike['tools'] | undefined
): void {
  if (!tools) {
    return
  }
  for (const tool of tools) {
    const category = tool?.name ? readToolMetaCategory(tool._meta) : undefined
    if (category) {
      cache.set(tool.name, category)
    }
  }
}

// --- initialize -----------------------------------------------------------

/**
 * Stateless servers never issue a session id, so sessions fragment and the
 * client name/version is lost after `initialize`. Fix: mint the
 * `Mcp-Session-Id` response header as a token carrying both. Clients replay
 * the header on every request, so any pod recovers them with no server-side
 * store (decoded in `getSessionId`). See ADR-0003.
 *
 * The header only reaches the wire when response headers are built after the
 * handler runs — StreamableHTTP with `enableJsonResponse: true`. SSE flushes
 * headers first; those servers set the header themselves with the exported
 * `encodeSessionId`, and this mint is a harmless no-op.
 */
function mintStatelessSessionOnInitialize(
  server: MCPServerLike,
  data: MCPAnalyticsData,
  request: MCPRequestLike,
  extra: CompatibleRequestHandlerExtra | undefined
): string | undefined {
  try {
    const headers = getRequestHeaders(extra)
    if (!headers) {
      return undefined // not an HTTP transport (stdio/in-memory) — nothing to mint into
    }
    // 2026-07-28 removed sessions from the protocol: a server MUST NOT mint or
    // echo `Mcp-Session-Id` under it. Today that era never reaches here anyway,
    // because it has no `initialize` — but relying on that is relying on an SDK
    // routing detail to keep us spec-compliant, so the era is asked directly.
    // Per request, never per server: the same v2 server serves both.
    if (isModernEraRequest(request, extra, server)) {
      return undefined
    }
    if (readMcpSessionHeader(headers)) {
      return undefined // client already replays a session id (ours or the transport's)
    }
    const transport = server.transport
    if (!transport || extra?.sessionId || transport.sessionId) {
      return undefined // stateful transports manage their own session id — leave it alone
    }

    const sessionId = newSessionId()
    const clientInfo = readInitializeClientInfo(request)
    // Minted before the handler negotiates, so only the client's *requested*
    // version is available here; `handleInitializeRequest` re-mints the token
    // with the negotiated version once the handler has run.
    const requestedProtocolVersion = readProtocolVersion(undefined, request)
    const token = encodeSessionId({
      sessionId,
      clientName: clientInfo?.name,
      clientVersion: clientInfo?.version,
      protocolVersion: requestedProtocolVersion,
    })
    if (!writeSessionIdToTransport(transport, token)) {
      return undefined // transport can't carry a response session id — keep generated behavior
    }

    data.sessionId = sessionId
    data.sessionSource = 'token'
    data.sessionInfo.clientName = clientInfo?.name
    data.sessionInfo.clientVersion = clientInfo?.version
    data.sessionInfo.protocolVersion = requestedProtocolVersion
    data.lastActivity = new Date()
    setServerTrackingData(server, data)
    return sessionId
  } catch (error) {
    data.logger(`Warning: PostHog MCP analytics failed to mint a stateless session id - ${error}`)
    return undefined
  }
}

/**
 * Rewrite the minted token to carry the *negotiated* protocol version now that
 * the handler has run. Without this, a server that downgrades the client's
 * requested version would replay the requested one on later requests (and to
 * other pods), reporting a version the session is not actually using.
 */
function upgradeMintedTokenToNegotiated(
  server: MCPServerLike,
  mintedSessionId: string,
  sessionInfo: SessionInfo,
  negotiatedProtocolVersion: string | undefined,
  logger: LoggerFn
): void {
  try {
    const transport = server.transport
    if (!transport) {
      return
    }
    const token = encodeSessionId({
      sessionId: mintedSessionId,
      clientName: sessionInfo.clientName,
      clientVersion: sessionInfo.clientVersion,
      protocolVersion: negotiatedProtocolVersion,
    })
    writeSessionIdToTransport(transport, token)
  } catch (error) {
    logger(`Warning: PostHog MCP analytics failed to upgrade the stateless session token - ${error}`)
  }
}

/**
 * Read the client name/version off the `initialize` request body — the SDK
 * hasn't stored it yet (`getClientVersion()`) when our patch runs.
 */
function readInitializeClientInfo(request: MCPRequestLike): ServerClientInfoLike | undefined {
  const clientInfo = request.params?.clientInfo
  if (!clientInfo || typeof clientInfo !== 'object') {
    return undefined
  }
  const { name, version } = clientInfo as Record<string, unknown>
  return {
    name: typeof name === 'string' ? name : undefined,
    version: typeof version === 'string' ? version : undefined,
  }
}

/**
 * Captures the connection handshake (and resolves identity) on `initialize`
 * before the original handler runs.
 */
export async function handleInitializeRequest(
  server: MCPServerLike,
  originalInitializeHandler: MCPRequestHandler,
  request: MCPRequestLike,
  extra: CompatibleRequestHandlerExtra | undefined,
  logger: LoggerFn
): Promise<unknown> {
  const data = getServerTrackingData(server)
  if (!data) {
    logger(
      'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called instrument(server, options) before using tool calls.'
    )
    return await originalInitializeHandler(request, extra)
  }

  // Mint first so the `$mcp_initialize` event below already carries the minted id.
  const mintedSessionId = mintStatelessSessionOnInitialize(server, data, request, extra)
  const sessionId = getSessionId(server, extra)
  // Snapshot before identify, metadata, or the initialize handler can yield to
  // another request using the same instrumented server.
  const sessionInfo = getSessionInfo(server, data, sessionId)
  const initializeClientInfo = readInitializeClientInfo(request)
  const requestSessionInfo: SessionInfo = {
    ...sessionInfo,
    clientName: initializeClientInfo?.name ?? sessionInfo.clientName,
    clientVersion: initializeClientInfo?.version ?? sessionInfo.clientVersion,
  }
  const identity = await handleIdentify(server, data, sessionId, request, requestSessionInfo, extra)
  const requestAttribution = withIdentity(requestSessionInfo, identity)

  const event: McpEvent = {
    sessionId,
    resourceName: request.params?.name || 'Unknown Tool Name',
    eventType: MCPAnalyticsEventType.mcpInitialize,
    parameters: buildCapturedMcpParameters(request),
    timestamp: new Date(),
  }
  // Harmless for a legacy `initialize` (client info rides the body there, and the
  // negotiated protocol version below overrides any `_meta` one); picks up client
  // info if a client also sends it in `_meta`.
  stampClientIdentity(event, request, extra, server)
  stampTransportIdentity(event, extra)

  await applyResolvedMetadata(event, data, request, extra)

  const result = await originalInitializeHandler(request, extra)
  event.response = result
  // The negotiated version (off the response) supersedes the requested one the
  // mint stored — persist it so every later event on this pod carries it, and
  // re-mint the token so pods replaying it report the negotiated version too.
  const negotiatedProtocolVersion = readProtocolVersion(result, request)
  event.protocolVersion = negotiatedProtocolVersion
  // Do not let a delayed initialize overwrite whichever session became current
  // while its callbacks or the original handler were awaiting.
  if (data.sessionId === sessionId) {
    data.sessionInfo = { ...data.sessionInfo, protocolVersion: negotiatedProtocolVersion }
    setServerTrackingData(server, data)
  }
  if (mintedSessionId) {
    upgradeMintedTokenToNegotiated(server, mintedSessionId, requestSessionInfo, negotiatedProtocolVersion, data.logger)
  }
  captureEvent(server, event, data.logger, {
    ...requestAttribution,
    protocolVersion: negotiatedProtocolVersion,
  })
  return result
}

/**
 * The MCP spec (protocol) version this session speaks. Prefer the negotiated
 * version off the initialize response — the version the server committed to and
 * the session actually runs on — falling back to the client's requested version
 * if the response omits it. Used to track spec-revision adoption.
 */
function readProtocolVersion(result: unknown, request: MCPRequestLike): string | undefined {
  const negotiated = (result as Record<string, unknown> | null | undefined)?.protocolVersion
  if (typeof negotiated === 'string' && negotiated.length > 0) {
    return negotiated
  }
  const requested = request.params?.protocolVersion
  return typeof requested === 'string' && requested.length > 0 ? requested : undefined
}
