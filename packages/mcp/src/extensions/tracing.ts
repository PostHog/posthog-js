import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  ListToolsRequestSchema,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { HighLevelMCPServerLike, MCPServerLike, UnredactedEvent } from '../types'
import { getMCPCompatibleErrorMessage } from './compatibility'
import { addContextParameterToTools, getContextDescription, isContextEnabled } from './context-parameters'
import {
  addConversationIdToTools,
  canInjectConversationIdPromptBack,
  cloneRequestWithoutConversationId,
  injectConversationIdPromptBack,
  resolveConversationId,
} from './conversation-id'
import { publishEvent } from './publish'
import { MCPAnalyticsEventType } from './event-types'
import { captureException } from './exceptions'
import { resolveToolCallIntent, setEventIntent, setExplicitContextIntent } from './intent'
import { getServerTrackingData, handleIdentify, resolveEventProperties } from './internal'
import { log } from './logger'
import { buildCapturedMcpParameters } from './mcp-payloads'
import { getServerSessionId } from './session'
import { GET_MORE_TOOLS_NAME, getReportMissingToolDescriptor, handleReportMissing } from './tools'

type MCPRequestHandler = NonNullable<
  MCPServerLike['_requestHandlers'] extends Map<string, infer THandler> ? THandler : never
>
type MCPRequest = Parameters<MCPRequestHandler>[0]
type MCPRequestExtra = Parameters<MCPRequestHandler>[1]
type MCPServerWithCapabilities = MCPServerLike & {
  _capabilities?: {
    tools?: unknown
  }
}

function isToolResultError(result: unknown): boolean {
  return !!result && typeof result === 'object' && 'isError' in result && result.isError === true
}

const listToolsTracingSetup = new WeakMap<MCPServerLike, boolean>()

export function setupListToolsTracing(highLevelServer: HighLevelMCPServerLike): void {
  const server = highLevelServer.server

  if (!(server as MCPServerWithCapabilities)._capabilities?.tools) {
    return
  }

  if (listToolsTracingSetup.get(server)) {
    return
  }

  const handlers = server._requestHandlers
  const originalListToolsHandler = handlers.get('tools/list')

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
  request: MCPRequest,
  extra: MCPRequestExtra
): Promise<{ tools: ListToolsResult['tools'] }> {
  const data = getServerTrackingData(server)
  const event: UnredactedEvent = {
    sessionId: getServerSessionId(server, extra),
    parameters: buildCapturedMcpParameters(request),
    eventType: MCPAnalyticsEventType.mcpToolsList,
    timestamp: new Date(),
    redactionFn: data?.options.redactSensitiveInformation,
  }

  if (data) {
    await applyResolvedMetadata(event, data, request, extra)
  }

  const tools = await getTracedToolsList(server, originalListToolsHandler, request, extra, event)

  if (!data) {
    log(
      'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called track(server, options) before using tool calls.'
    )
    return { tools }
  }

  if (tools.length === 0) {
    log(
      'Warning: No tools found in the original list. This is likely due to the tools not being registered before PostHog MCP analytics.track().'
    )
    event.error = { message: 'No tools were sent to MCP client.' }
    event.isError = true
    event.duration = getEventDuration(event)
    publishEvent(server, event)
    return { tools }
  }

  event.response = { tools }
  event.listedToolNames = collectListedToolNames(tools)
  event.isError = false
  event.duration = getEventDuration(event)
  publishEvent(server, event)
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
  request: MCPRequest,
  extra: MCPRequestExtra,
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
    event.error = { message: getMCPCompatibleErrorMessage(error) }
    event.isError = true
    event.duration = getEventDuration(event)
    publishEvent(server, event)
    throw error
  }
}

export function setupInitializeTracing(highLevelServer: HighLevelMCPServerLike): void {
  const server = highLevelServer.server
  const handlers = server._requestHandlers
  const originalInitializeHandler = handlers.get('initialize')

  if (originalInitializeHandler) {
    server.setRequestHandler(InitializeRequestSchema, async (request, extra) => {
      const data = getServerTrackingData(server)
      if (!data) {
        log(
          'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called track(server, options) before using tool calls.'
        )
        return await originalInitializeHandler(request, extra)
      }

      const sessionId = getServerSessionId(server, extra)

      await handleIdentify(server, data, request, extra)

      const event: UnredactedEvent = {
        sessionId,
        resourceName: request.params?.name || 'Unknown Tool Name',
        eventType: MCPAnalyticsEventType.mcpInitialize,
        parameters: buildCapturedMcpParameters(request),
        timestamp: new Date(),
        redactionFn: data.options.redactSensitiveInformation,
      }

      const resolvedProperties = await resolveEventProperties(data, request, extra)
      if (resolvedProperties) {
        event.properties = resolvedProperties
      }

      const result = await originalInitializeHandler(request, extra)
      event.response = result
      publishEvent(server, event)
      return result
    })
  }
}

export function setupToolCallTracing(server: MCPServerLike): void {
  try {
    const handlers = server._requestHandlers

    const originalCallToolHandler = handlers.get('tools/call')
    const originalInitializeHandler = handlers.get('initialize')

    if (originalInitializeHandler) {
      server.setRequestHandler(InitializeRequestSchema, async (request, extra) => {
        const data = getServerTrackingData(server)
        if (!data) {
          log(
            'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called track(server, options) before using tool calls.'
          )
          return await originalInitializeHandler(request, extra)
        }

        const sessionId = getServerSessionId(server, extra)

        await handleIdentify(server, data, request, extra)

        const event: UnredactedEvent = {
          sessionId,
          resourceName: request.params?.name || 'Unknown Tool Name',
          eventType: MCPAnalyticsEventType.mcpInitialize,
          parameters: buildCapturedMcpParameters(request),
          timestamp: new Date(),
          redactionFn: data.options.redactSensitiveInformation,
        }

        const resolvedProperties = await resolveEventProperties(data, request, extra)
        if (resolvedProperties) {
          event.properties = resolvedProperties
        }

        const result = await originalInitializeHandler(request, extra)
        event.response = result
        publishEvent(server, event)
        return result
      })
    }

    server.setRequestHandler(
      CallToolRequestSchema,
      async (request, extra) => await handleToolCallRequest(server, originalCallToolHandler, request, extra)
    )
  } catch (error) {
    log(`Warning: Failed to setup tool call tracing - ${error}`)
    throw error
  }
}

async function handleToolCallRequest(
  server: MCPServerLike,
  originalCallToolHandler: MCPRequestHandler | undefined,
  request: MCPRequest,
  extra: MCPRequestExtra
): Promise<unknown> {
  const data = getServerTrackingData(server)
  if (!data) {
    log(
      'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called track(server, options) before using tool calls.'
    )
    return await originalCallToolHandler?.(request, extra)
  }

  const conversation = resolveConversationId(
    data.options.enableConversationId ?? false,
    request.params?.arguments,
    request.params?.name
  )
  const downstreamRequest = conversation.conversationId ? cloneRequestWithoutConversationId(request) : request

  const toolName = request.params?.name
  const event: UnredactedEvent = {
    sessionId: getServerSessionId(server, extra),
    conversationId: conversation.conversationId,
    resourceName: toolName || 'Unknown Tool Name',
    parameters: buildCapturedMcpParameters(downstreamRequest),
    eventType: MCPAnalyticsEventType.mcpToolsCall,
    timestamp: new Date(),
    toolDescription: toolName ? data.toolDescriptions.get(toolName) : undefined,
    redactionFn: data.options.redactSensitiveInformation,
  }

  try {
    await handleIdentify(server, data, request, extra)
    await applyResolvedMetadata(event, data, request, extra)
    setEventIntent(event, await resolveToolCallIntent(data, request, extra))

    const result = await executeToolCall(server, originalCallToolHandler, downstreamRequest, extra, event)
    if (isToolResultError(result)) {
      event.isError = true
      event.error = captureException(result)
    } else {
      event.isError = false
    }

    let finalResult = result
    if (conversation.minted) {
      if (canInjectConversationIdPromptBack(result)) {
        finalResult = injectConversationIdPromptBack(result, conversation.conversationId)
      } else {
        // Agent never received the minted id → clear so the event is not
        // an orphan in analytics.
        event.conversationId = undefined
      }
    }

    event.response = finalResult
    event.duration = getEventDuration(event)
    publishEvent(server, event)
    return finalResult
  } catch (error) {
    event.isError = true
    event.error = captureException(error)
    if (conversation.minted) {
      event.conversationId = undefined
    }
    event.duration = getEventDuration(event)
    publishEvent(server, event)
    throw error
  }
}

async function executeToolCall(
  server: MCPServerLike,
  originalCallToolHandler: MCPRequestHandler | undefined,
  request: MCPRequest,
  extra: MCPRequestExtra,
  event: UnredactedEvent
): Promise<unknown> {
  if (request.params?.name === GET_MORE_TOOLS_NAME) {
    const context = getContextArgument(request) || ''
    setExplicitContextIntent(event, context)
    return handleReportMissing({ context })
  }

  if (originalCallToolHandler) {
    return await originalCallToolHandler(request, extra)
  }

  event.isError = true
  event.error = {
    message: `Tool call handler not found for ${request.params?.name || 'unknown'}`,
  }
  event.duration = getEventDuration(event) || undefined
  publishEvent(server, event)
  throw new Error(`Unknown tool: ${request.params?.name || 'unknown'}`)
}

async function applyResolvedMetadata(
  event: UnredactedEvent,
  data: NonNullable<ReturnType<typeof getServerTrackingData>>,
  request: MCPRequest,
  extra: MCPRequestExtra
): Promise<void> {
  const resolvedProperties = await resolveEventProperties(data, request, extra)
  if (resolvedProperties) {
    event.properties = resolvedProperties
  }
}

function getContextArgument(request: MCPRequest): string | undefined {
  const context = request.params?.arguments?.context
  return typeof context === 'string' ? context : undefined
}

function getEventDuration(event: UnredactedEvent): number {
  return event.timestamp ? Date.now() - event.timestamp.getTime() : 0
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
