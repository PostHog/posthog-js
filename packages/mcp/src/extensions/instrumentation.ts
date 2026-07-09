// Portions of this file are derived from MCPCat/mcpcat-typescript-sdk
// Copyright (c) 2025 MCPcat
// Licensed under the MIT License: https://github.com/MCPCat/mcpcat-typescript-sdk/blob/main/LICENSE

import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  CompatibleRequestHandlerExtra,
  MCPAnalyticsData,
  MCPRequestLike,
  MCPServerLike,
  McpEvent,
  ServerClientInfoLike,
} from '../types'
import { addContextParameterToTools, getContextDescription, isContextEnabled } from './context-parameters'
import {
  addConversationIdToTools,
  type ConversationIdResolution,
  canInjectConversationIdPromptBack,
  cloneRequestWithoutConversationId,
  injectConversationIdPromptBack,
  resolveConversationId,
} from './conversation-id'
import { captureEvent } from './capture'
import { MCPAnalyticsEventType } from './event-types'
import { captureException } from './exceptions'
import { resolveToolCallIntent, setEventIntent, setExplicitContextIntent } from './intent'
import { getServerTrackingData, handleIdentify, setServerTrackingData } from './internal'
import { log } from './logger'
import { buildCapturedMcpParameters } from './mcp-payloads'
import { getLiteralValue, getObjectShape } from './mcp-sdk-compat'
import { getSessionId, newSessionId } from './session'
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

/**
 * Runs the underlying tool. Receives the request with the SDK-injected
 * `conversation_id` stripped; an adapter is free to ignore it (the high-level
 * path strips arguments inside the wrapped callback instead).
 */
type ToolExecutor = (downstreamRequest: MCPRequestLike) => Promise<unknown>

interface TraceToolCallParams {
  server: MCPServerLike
  data: MCPAnalyticsData
  request: MCPRequestLike
  extra?: CompatibleRequestHandlerExtra
  execute: ToolExecutor
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
  const { server, data, request, extra, execute, eventType, explicitContextIntent, takeCapturedError } = params

  const conversation = resolveConversationId(
    data.options.enableConversationId ?? false,
    request.params?.arguments,
    request.params?.name,
    resolveMissingCapabilityToolName(data.options)
  )
  const downstreamRequest = conversation.conversationId ? cloneRequestWithoutConversationId(request) : request

  // Prepare the event in isolation: if identity/metadata/intent resolution
  // throws, we drop instrumentation for this call but still run the tool.
  const startTime = new Date()
  const event = await prepareToolCallEvent(
    server,
    data,
    request,
    downstreamRequest,
    extra,
    startTime,
    conversation,
    eventType ?? MCPAnalyticsEventType.mcpToolsCall
  )
  if (event && explicitContextIntent) {
    setExplicitContextIntent(event, explicitContextIntent)
  }

  let result: unknown
  try {
    result = await execute(downstreamRequest)
  } catch (error) {
    publishFailedToolEvent(server, event, error, startTime, conversation)
    throw error
  }

  const finalResult = applyConversationPromptBack(event, result, conversation)
  publishSuccessfulToolEvent(server, event, finalResult, startTime, takeCapturedError)
  return finalResult
}

async function prepareToolCallEvent(
  server: MCPServerLike,
  data: MCPAnalyticsData,
  request: MCPRequestLike,
  downstreamRequest: MCPRequestLike,
  extra: CompatibleRequestHandlerExtra | undefined,
  startTime: Date,
  conversation: ConversationIdResolution,
  eventType: MCPAnalyticsEventType
): Promise<McpEvent | null> {
  try {
    const sessionId = getSessionId(server, extra)
    await handleIdentify(server, data, sessionId, request, extra)

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

    await applyResolvedMetadata(event, data, request, extra)
    setEventIntent(event, await resolveToolCallIntent(data, request, extra))
    return event
  } catch (error) {
    log(
      `Warning: PostHog MCP analytics instrumentation failed for tool ${request.params?.name}, the tool will still run - ${error}`
    )
    return null
  }
}

/**
 * When we minted a conversation id, append the prompt-back so the agent echoes
 * it on subsequent calls. If the result can't carry it, clear the id off the
 * event so analytics doesn't show an orphan the agent never received.
 */
function applyConversationPromptBack(
  event: McpEvent | null,
  result: unknown,
  conversation: ConversationIdResolution
): unknown {
  if (!conversation.minted) {
    return result
  }
  if (canInjectConversationIdPromptBack(result)) {
    return injectConversationIdPromptBack(result, conversation.conversationId)
  }
  if (event) {
    event.conversationId = undefined
  }
  return result
}

function publishSuccessfulToolEvent(
  server: MCPServerLike,
  event: McpEvent | null,
  result: unknown,
  startTime: Date,
  takeCapturedError?: () => unknown
): void {
  if (!event) {
    return
  }
  try {
    if (isToolResultError(result)) {
      event.isError = true
      const capturedError = takeCapturedError?.()
      event.error = captureException(capturedError ?? result)
    } else {
      event.isError = false
    }
    event.response = result
    event.duration = Date.now() - startTime.getTime()
    captureEvent(server, event)
  } catch (error) {
    log(`Warning: PostHog MCP analytics failed to publish tool event - ${error}`)
  }
}

function publishFailedToolEvent(
  server: MCPServerLike,
  event: McpEvent | null,
  error: unknown,
  startTime: Date,
  conversation: ConversationIdResolution
): void {
  if (!event) {
    return
  }
  try {
    if (conversation.minted) {
      event.conversationId = undefined
    }
    event.isError = true
    event.error = captureException(error)
    event.duration = Date.now() - startTime.getTime()
    captureEvent(server, event)
  } catch (publishError) {
    log(`Warning: PostHog MCP analytics failed to publish failed tool event - ${publishError}`)
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

/**
 * Applies the `patches` (keyed by method, e.g. `initialize`, `tools/list`) to the
 * handlers already registered, and patches `setRequestHandler` so matching
 * handlers registered later are patched too. The latter is what makes adapters
 * that register handlers post-construction work — e.g. `@rekog/mcp-nest` hands a
 * bare server to instrument() and only then registers its handlers.
 */
export function patchRequestHandlers(server: MCPServerLike, patches: Record<string, HandlerPatch>): void {
  // Monkey patch existing handlers.
  for (const [handlerName, patch] of Object.entries(patches)) {
    const originalHandler = server._requestHandlers.get(handlerName)
    if (originalHandler) {
      server._requestHandlers.set(handlerName, (request, extra) => patch(server, originalHandler, request, extra))
    }
  }

  // Monkey patch dynamically added handlers (registered after instrument()).
  const originalSetRequestHandler = server.setRequestHandler.bind(server)
  server.setRequestHandler = ((requestSchema: unknown, originalHandler: MCPRequestHandler) => {
    const shape = getObjectShape(requestSchema)
    const handlerName = shape?.method ? getLiteralValue(shape.method) : undefined
    const patch = typeof handlerName === 'string' ? patches[handlerName] : undefined
    if (!patch) {
      return originalSetRequestHandler(requestSchema, originalHandler)
    }

    return originalSetRequestHandler(requestSchema, (request, extra) => patch(server, originalHandler, request, extra))
  }) as MCPServerLike['setRequestHandler']
}

/**
 * Captures each `tools/list` and injects the SDK-managed tools (context
 * parameter, conversation id, `get_more_tools`) into the returned list.
 */
export async function handleListToolsRequest(
  server: MCPServerLike,
  originalListToolsHandler: MCPRequestHandler,
  request: MCPRequestLike,
  extra?: CompatibleRequestHandlerExtra
): Promise<{ tools: ListToolsResult['tools'] }> {
  const data = getServerTrackingData(server)
  const startTime = new Date()
  const event: McpEvent = {
    sessionId: getSessionId(server, extra),
    parameters: buildCapturedMcpParameters(request),
    eventType: MCPAnalyticsEventType.mcpToolsList,
    timestamp: startTime,
  }

  if (data) {
    await applyResolvedMetadata(event, data, request, extra)
  }

  const tools = await getTracedToolsList(server, originalListToolsHandler, request, extra, event)

  if (!data) {
    log(
      'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called instrument(server, options) before using tool calls.'
    )
    return { tools }
  }

  if (tools.length === 0) {
    log(
      'Warning: No tools found in the original list. This is likely due to the tools not being registered before PostHog MCP analytics.instrument().'
    )
    event.error = captureException('No tools were sent to MCP client.')
    event.isError = true
    event.duration = Date.now() - startTime.getTime()
    captureEvent(server, event)
    return { tools }
  }

  event.response = { tools }
  event.listedToolNames = collectListedToolNames(tools)
  event.isError = false
  event.duration = Date.now() - startTime.getTime()
  captureEvent(server, event)
  return { tools }
}

function collectListedToolNames(tools: ListToolsResult['tools'] | undefined): string[] | undefined {
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
  event: McpEvent
): Promise<ListToolsResult['tools']> {
  try {
    const data = getServerTrackingData(server)
    const originalResponse = (await originalListToolsHandler(request, extra)) as ListToolsResult
    let tools = originalResponse.tools || []

    if (data && isContextEnabled(data.options.context)) {
      tools = addContextParameterToTools(tools, getContextDescription(data.options.context))
    }

    if (data?.options.enableConversationId) {
      tools = addConversationIdToTools(tools, resolveMissingCapabilityToolName(data.options))
    }

    if (data?.options.reportMissing) {
      const missingToolName = resolveMissingCapabilityToolName(data.options)
      const alreadyPresent = tools.some((tool) => tool?.name === missingToolName)
      if (!alreadyPresent) {
        tools.push(getReportMissingToolDescriptor(missingToolName))
      }
    }

    if (data) {
      cacheToolDescriptions(data.toolDescriptions, tools)
      cacheToolCategories(data.toolCategories, tools)
    }

    return tools
  } catch (error) {
    log(
      `Warning: Original list tools handler failed, this suggests an error PostHog MCP analytics did not cause - ${error}`
    )
    event.error = captureException(error)
    event.isError = true
    event.duration = event.timestamp ? Date.now() - event.timestamp.getTime() : 0
    captureEvent(server, event)
    throw error
  }
}

export function cacheToolDescriptions(cache: Map<string, string>, tools: ListToolsResult['tools'] | undefined): void {
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

export function cacheToolCategories(cache: Map<string, string>, tools: ListToolsResult['tools'] | undefined): void {
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
 * store (decoded in `getSessionId`).
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
): void {
  try {
    const headers = extra?.requestInfo?.headers
    if (!headers || typeof headers !== 'object') {
      return // not an HTTP transport (stdio/in-memory) — nothing to mint into
    }
    if (readMcpSessionHeader(headers)) {
      return // client already replays a session id (ours or the transport's)
    }
    const transport = server.transport
    if (!transport || extra?.sessionId || transport.sessionId) {
      return // stateful transports manage their own session id — leave it alone
    }

    const sessionId = newSessionId()
    const clientInfo = readInitializeClientInfo(request)
    const token = encodeSessionId({ sessionId, clientName: clientInfo?.name, clientVersion: clientInfo?.version })
    if (!writeSessionIdToTransport(transport, token)) {
      return // transport can't carry a response session id — keep generated behavior
    }

    data.sessionId = sessionId
    data.sessionSource = 'token'
    data.sessionInfo.clientName = clientInfo?.name
    data.sessionInfo.clientVersion = clientInfo?.version
    data.lastActivity = new Date()
    setServerTrackingData(server, data)
  } catch (error) {
    log(`Warning: PostHog MCP analytics failed to mint a stateless session id - ${error}`)
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
  extra?: CompatibleRequestHandlerExtra
): Promise<unknown> {
  const data = getServerTrackingData(server)
  if (!data) {
    log(
      'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called instrument(server, options) before using tool calls.'
    )
    return await originalInitializeHandler(request, extra)
  }

  // Mint first so the `$mcp_initialize` event below already carries the minted id.
  mintStatelessSessionOnInitialize(server, data, request, extra)
  const sessionId = getSessionId(server, extra)
  await handleIdentify(server, data, sessionId, request, extra)

  const event: McpEvent = {
    sessionId,
    resourceName: request.params?.name || 'Unknown Tool Name',
    eventType: MCPAnalyticsEventType.mcpInitialize,
    parameters: buildCapturedMcpParameters(request),
    timestamp: new Date(),
  }

  await applyResolvedMetadata(event, data, request, extra)

  const result = await originalInitializeHandler(request, extra)
  event.response = result
  captureEvent(server, event)
  return result
}
