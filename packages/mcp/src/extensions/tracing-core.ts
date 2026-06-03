import {
  InitializeRequestSchema,
  ListToolsRequestSchema,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'
import type {
  CompatibleRequestHandlerExtra,
  MCPAnalyticsData,
  MCPRequestLike,
  MCPServerLike,
  UnredactedEvent,
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
import { getServerTrackingData, handleIdentify } from './internal'
import { log } from './logger'
import { buildCapturedMcpParameters } from './mcp-payloads'
import { getServerSessionId } from './session'
import { GET_MORE_TOOLS_NAME, getReportMissingToolDescriptor } from './tools'
import { applyResolvedMetadata, isToolResultError } from './tracing-helpers'

/**
 * Single tracing core shared by the low-level (`Server`) and high-level
 * (`McpServer`) wrappers. The two entrypoints differ only in how they reach the
 * underlying tool — they both funnel the tool-call lifecycle through
 * {@link traceToolCall}, so error handling, conversation-id minting, session
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
export async function traceToolCall(params: TraceToolCallParams): Promise<unknown> {
  const { server, data, request, extra, execute, explicitContextIntent, takeCapturedError } = params

  const conversation = resolveConversationId(
    data.options.enableConversationId ?? false,
    request.params?.arguments,
    request.params?.name
  )
  const downstreamRequest = conversation.conversationId ? cloneRequestWithoutConversationId(request) : request

  // Prepare the event in isolation: if identity/metadata/intent resolution
  // throws, we drop tracing for this call but still run the tool.
  const startTime = new Date()
  const event = await prepareToolCallEvent(server, data, request, downstreamRequest, extra, startTime, conversation)
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
  conversation: ConversationIdResolution
): Promise<UnredactedEvent | null> {
  try {
    const sessionId = getServerSessionId(server, extra)
    await handleIdentify(server, data, sessionId, request, extra)

    const toolName = request.params?.name
    const event: UnredactedEvent = {
      sessionId,
      conversationId: conversation.conversationId,
      resourceName: toolName || 'Unknown Tool Name',
      parameters: buildCapturedMcpParameters(downstreamRequest),
      eventType: MCPAnalyticsEventType.mcpToolsCall,
      timestamp: startTime,
      toolDescription: toolName ? data.toolDescriptions.get(toolName) : undefined,
      redactionFn: data.options.redactSensitiveInformation,
    }

    await applyResolvedMetadata(event, data, request, extra)
    setEventIntent(event, await resolveToolCallIntent(data, request, extra))
    return event
  } catch (error) {
    log(
      `Warning: PostHog MCP analytics tracing failed for tool ${request.params?.name}, the tool will still run - ${error}`
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
  event: UnredactedEvent | null,
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
  event: UnredactedEvent | null,
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
  event: UnredactedEvent | null,
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

type MCPServerWithCapabilities = MCPServerLike & {
  _capabilities?: {
    tools?: unknown
  }
}

const listToolsTracingSetup = new WeakMap<MCPServerLike, boolean>()

/**
 * Wraps the server's `tools/list` handler so each listing is captured and the
 * SDK-managed tools (context parameter, conversation id, `get_more_tools`) are
 * injected. Idempotent per server. Works for both low-level and high-level
 * servers — the high-level wrapper passes its underlying `server`.
 */
export function setupListToolsTracing(server: MCPServerLike): void {
  if (!(server as MCPServerWithCapabilities)._capabilities?.tools) {
    return
  }
  if (listToolsTracingSetup.get(server)) {
    return
  }

  const originalListToolsHandler = server._requestHandlers.get('tools/list')
  if (!originalListToolsHandler) {
    return
  }

  try {
    server.setRequestHandler(
      ListToolsRequestSchema,
      async (request, extra) => await handleListToolsRequest(server, originalListToolsHandler, request, extra)
    )
    listToolsTracingSetup.set(server, true)
  } catch (error) {
    log(`Warning: Failed to override list tools handler - ${error}`)
  }
}

async function handleListToolsRequest(
  server: MCPServerLike,
  originalListToolsHandler: MCPRequestHandler,
  request: MCPRequestLike,
  extra?: CompatibleRequestHandlerExtra
): Promise<{ tools: ListToolsResult['tools'] }> {
  const data = getServerTrackingData(server)
  const startTime = new Date()
  const event: UnredactedEvent = {
    sessionId: getServerSessionId(server, extra),
    parameters: buildCapturedMcpParameters(request),
    eventType: MCPAnalyticsEventType.mcpToolsList,
    timestamp: startTime,
    redactionFn: data?.options.redactSensitiveInformation,
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
  event: UnredactedEvent
): Promise<ListToolsResult['tools']> {
  try {
    const data = getServerTrackingData(server)
    const originalResponse = (await originalListToolsHandler(request, extra)) as ListToolsResult
    let tools = originalResponse.tools || []

    if (data && isContextEnabled(data.options.context)) {
      tools = addContextParameterToTools(tools, getContextDescription(data.options.context))
    }

    if (data?.options.enableConversationId) {
      tools = addConversationIdToTools(tools)
    }

    if (data?.options.reportMissing) {
      const alreadyPresent = tools.some((tool) => tool?.name === GET_MORE_TOOLS_NAME)
      if (!alreadyPresent) {
        tools.push(getReportMissingToolDescriptor())
      }
    }

    if (data) {
      cacheToolDescriptions(data.toolDescriptions, tools)
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

// --- initialize -----------------------------------------------------------

/**
 * Wraps the server's `initialize` handler so the connection handshake is
 * captured (and identity resolved) before the original handler runs.
 */
export function setupInitializeTracing(server: MCPServerLike): void {
  const originalInitializeHandler = server._requestHandlers.get('initialize')
  if (!originalInitializeHandler) {
    return
  }

  server.setRequestHandler(InitializeRequestSchema, async (request, extra) => {
    const data = getServerTrackingData(server)
    if (!data) {
      log(
        'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called instrument(server, options) before using tool calls.'
      )
      return await originalInitializeHandler(request, extra)
    }

    const sessionId = getServerSessionId(server, extra)
    await handleIdentify(server, data, sessionId, request, extra)

    const event: UnredactedEvent = {
      sessionId,
      resourceName: request.params?.name || 'Unknown Tool Name',
      eventType: MCPAnalyticsEventType.mcpInitialize,
      parameters: buildCapturedMcpParameters(request),
      timestamp: new Date(),
      redactionFn: data.options.redactSensitiveInformation,
    }

    await applyResolvedMetadata(event, data, request, extra)

    const result = await originalInitializeHandler(request, extra)
    event.response = result
    captureEvent(server, event)
    return result
  })
}
