import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  CompatibleRequestHandlerExtra,
  HighLevelMCPServerLike,
  MCPServerLike,
  RegisteredTool,
  UnredactedEvent,
} from '../types'
import {
  type ConversationIdResolution,
  canInjectConversationIdPromptBack,
  cloneRequestWithoutConversationId,
  injectConversationIdPromptBack,
  resolveConversationId,
  stripConversationId,
} from './conversation-id'
import { publishEvent } from './publish'
import { MCPAnalyticsEventType } from './event-types'
import { captureException } from './exceptions'
import { resolveToolCallIntent, setEventIntent, setExplicitContextIntent } from './intent'
import { getServerTrackingData, handleIdentify, resolveEventProperties } from './internal'
import { log } from './logger'
import { buildCapturedMcpParameters } from './mcp-payloads'
import { createWrappedTool, getLiteralValue, getObjectShape, getToolFunction, hasToolFunction } from './mcp-sdk-compat'
import { getServerSessionId } from './session'
import { GET_MORE_TOOLS_NAME, handleReportMissing } from './tools'
import { setupInitializeTracing, setupListToolsTracing } from './tracing'

type MCPRequestHandler = NonNullable<
  MCPServerLike['_requestHandlers'] extends Map<string, infer THandler> ? THandler : never
>
type MCPRequest = Parameters<MCPRequestHandler>[0]
type MCPRequestExtra = Parameters<MCPRequestHandler>[1]

const wrappedCallbacks = new WeakMap<object, boolean>()

const MCP_ANALYTICS_PROCESSED = Symbol('__posthog_mcp_analytics_processed__')

type ProcessedRegisteredTool = RegisteredTool & {
  [MCP_ANALYTICS_PROCESSED]?: boolean
}

function isToolResultError(result: unknown): boolean {
  return !!result && typeof result === 'object' && 'isError' in result && result.isError === true
}

function isCallbackUpdate(value: unknown): value is { callback: unknown } {
  return !!value && typeof value === 'object' && 'callback' in value && typeof value.callback === 'function'
}

function addTracingToToolRegistry(
  tools: Record<string, RegisteredTool>,
  server: HighLevelMCPServerLike
): Record<string, RegisteredTool> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [name, addTracingToToolCallbackInternal(tool, name, server)])
  )
}

function setupListenerToRegisteredTools(server: HighLevelMCPServerLike): void {
  try {
    const data = getServerTrackingData(server.server as MCPServerLike)
    if (!data) {
      log('Warning: Cannot setup listener - no tracking data found')
      return
    }

    const handler: ProxyHandler<Record<string, RegisteredTool>> = {
      set(target: Record<string, RegisteredTool>, property: string | symbol, value: RegisteredTool): boolean {
        try {
          if (typeof property === 'string' && value && typeof value === 'object' && hasToolFunction(value)) {
            if (typeof value.description === 'string') {
              data.toolDescriptions.set(property, value.description)
            }
            if ((value as ProcessedRegisteredTool)[MCP_ANALYTICS_PROCESSED]) {
              log(`Tool ${String(property)} already processed, skipping proxy wrapping`)
              return Reflect.set(target, property, value)
            }

            if (wrappedCallbacks.has(getToolFunction(value))) {
              log(`Tool ${String(property)} callback already wrapped, skipping proxy wrapping`)
              return Reflect.set(target, property, value)
            }

            const nextValue = addTracingToToolCallbackInternal(value, property, server)

            setupListToolsTracing(server)

            if (typeof nextValue.update === 'function') {
              const originalUpdate = nextValue.update
              nextValue.update = function (...updateArgs: unknown[]) {
                if (updateArgs[0]) {
                  const updateObj = updateArgs[0]
                  if (isCallbackUpdate(updateObj)) {
                    const wrappedTool = addTracingToToolCallbackInternal(
                      { callback: updateObj.callback } as RegisteredTool,
                      property,
                      server
                    )
                    updateObj.callback = getToolFunction(wrappedTool)
                  }
                }
                return originalUpdate.apply(this, updateArgs)
              }
            }
            return Reflect.set(target, property, nextValue)
          }

          return Reflect.set(target, property, value)
        } catch (error) {
          log(`Warning: Error in proxy set handler for tool ${String(property)} - ${error}`)
          return Reflect.set(target, property, value)
        }
      },

      get(target: Record<string, RegisteredTool>, property: string | symbol): unknown {
        return Reflect.get(target, property)
      },

      deleteProperty(target: Record<string, RegisteredTool>, property: string | symbol): boolean {
        return Reflect.deleteProperty(target, property)
      },

      has(target: Record<string, RegisteredTool>, property: string | symbol): boolean {
        return Reflect.has(target, property)
      },
    }

    const originalTools = server._registeredTools || {}
    server._registeredTools = new Proxy(originalTools, handler)

    log('Successfully set up listener for new tool registrations')
  } catch (error) {
    log(`Warning: Failed to setup listener for registered tools - ${error}`)
  }
}

function addTracingToToolCallbackInternal(
  tool: RegisteredTool,
  toolName: string,
  _server: HighLevelMCPServerLike
): RegisteredTool {
  const originalCallback = getToolFunction(tool)

  if (wrappedCallbacks.has(originalCallback)) {
    log(`Tool ${toolName} callback already wrapped, skipping re-wrap`)
    return tool
  }

  if ((tool as ProcessedRegisteredTool)[MCP_ANALYTICS_PROCESSED]) {
    log(`Tool ${toolName} already processed, skipping re-wrap`)
    return tool
  }

  const wrappedCallback = async (...params: unknown[]): Promise<CallToolResult> => {
    let args: unknown
    let extra: CompatibleRequestHandlerExtra

    if (params.length === 2) {
      args = params[0]
      extra = params[1] as CompatibleRequestHandlerExtra
    } else {
      args = undefined
      extra = params[0] as CompatibleRequestHandlerExtra
    }

    const removeContextFromArgs = (input: unknown): unknown => {
      if (input && typeof input === 'object' && 'context' in input) {
        const { context: _context, ...rest } = input
        return rest
      }
      return input
    }

    const cleanedArgs = toolName === 'get_more_tools' ? args : stripConversationId(removeContextFromArgs(args))

    try {
      if (cleanedArgs === undefined) {
        const handler = originalCallback as (extra: CompatibleRequestHandlerExtra) => Promise<CallToolResult>
        return await handler(extra)
      }
      const handler = originalCallback as (
        args: unknown,
        extra: CompatibleRequestHandlerExtra
      ) => Promise<CallToolResult>
      return await handler(cleanedArgs, extra)
    } catch (error) {
      if (error instanceof Error) {
        extra.__mcp_analytics_error = error
      }
      throw error
    }
  }

  wrappedCallbacks.set(originalCallback, true)
  wrappedCallbacks.set(wrappedCallback, true)

  const wrappedTool = createWrappedTool(tool, wrappedCallback)

  ;(wrappedTool as ProcessedRegisteredTool)[MCP_ANALYTICS_PROCESSED] = true

  return wrappedTool
}

function setupToolsCallHandlerWrapping(server: HighLevelMCPServerLike): void {
  const lowLevelServer = server.server as MCPServerLike

  const existingHandler = lowLevelServer._requestHandlers.get('tools/call')
  if (existingHandler) {
    const wrappedHandler = createToolsCallWrapper(existingHandler, lowLevelServer)
    lowLevelServer._requestHandlers.set('tools/call', wrappedHandler)
  }

  const originalSetRequestHandler = lowLevelServer.setRequestHandler.bind(lowLevelServer)

  lowLevelServer.setRequestHandler = ((requestSchema: unknown, handler: MCPRequestHandler) => {
    const shape = getObjectShape(requestSchema)
    const method = shape?.method ? getLiteralValue(shape.method) : undefined

    if (method === 'tools/call') {
      const wrappedHandler = createToolsCallWrapper(handler, lowLevelServer)
      return originalSetRequestHandler(requestSchema, wrappedHandler)
    }

    return originalSetRequestHandler(requestSchema, handler)
  }) as MCPServerLike['setRequestHandler']
}

function createToolsCallWrapper(originalHandler: MCPRequestHandler, server: MCPServerLike): MCPRequestHandler {
  return async (request: MCPRequest, extra: MCPRequestExtra) =>
    await handleWrappedToolsCall(originalHandler, server, request, extra)
}

interface ToolCallTracing {
  event: UnredactedEvent | null
  mintedConversationId: string | undefined
  shouldPublishEvent: boolean
}

async function handleWrappedToolsCall(
  originalHandler: MCPRequestHandler,
  server: MCPServerLike,
  request: MCPRequest,
  extra: MCPRequestExtra
): Promise<unknown> {
  const startTime = new Date()
  const conversation = resolveConversationId(
    getServerTrackingData(server)?.options.enableConversationId ?? false,
    request.params?.arguments,
    request.params?.name
  )
  const downstreamRequest = conversation.conversationId ? cloneRequestWithoutConversationId(request) : request
  const tracing = await initializeToolCallEvent(server, request, downstreamRequest, extra, startTime, conversation)

  if (request?.params?.name === GET_MORE_TOOLS_NAME) {
    return executeReportMissingTool(server, request, tracing, startTime)
  }

  return await executeOriginalTool(originalHandler, server, request, extra, tracing, startTime)
}

async function initializeToolCallEvent(
  server: MCPServerLike,
  request: MCPRequest,
  downstreamRequest: MCPRequest,
  extra: MCPRequestExtra,
  startTime: Date,
  conversation: ConversationIdResolution
): Promise<ToolCallTracing> {
  try {
    const data = getServerTrackingData(server)
    if (!data) {
      log(
        'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called track(server, options) before using tool calls.'
      )
      return {
        event: null,
        mintedConversationId: undefined,
        shouldPublishEvent: false,
      }
    }

    const toolName = request.params?.name
    const event: UnredactedEvent = {
      sessionId: getServerSessionId(server, extra),
      conversationId: conversation.conversationId,
      resourceName: toolName || 'Unknown Tool',
      parameters: buildCapturedMcpParameters(downstreamRequest),
      eventType: MCPAnalyticsEventType.mcpToolsCall,
      timestamp: startTime,
      toolDescription: toolName ? data.toolDescriptions.get(toolName) : undefined,
      redactionFn: data.options.redactSensitiveInformation,
    }

    await handleIdentify(server, data, request, extra)
    event.sessionId = data.sessionId
    await applyResolvedMetadata(event, data, request, extra)

    setEventIntent(event, await resolveToolCallIntent(data, request, extra))

    return {
      event,
      mintedConversationId: conversation.minted ? conversation.conversationId : undefined,
      shouldPublishEvent: true,
    }
  } catch (error) {
    log(
      `Warning: PostHog MCP analytics tracing failed for tool ${request.params?.name}, falling back to original handler - ${error}`
    )
    return {
      event: null,
      mintedConversationId: undefined,
      shouldPublishEvent: false,
    }
  }
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

function executeReportMissingTool(
  server: MCPServerLike,
  request: MCPRequest,
  tracing: ToolCallTracing,
  startTime: Date
): CallToolResult {
  try {
    const context = getContextArgument(request) || ''
    const result = handleReportMissing({ context })

    publishSuccessfulToolEvent(server, tracing, result, startTime, {
      userIntent: context,
      userIntentSource: 'context_parameter',
    })

    return result
  } catch (error) {
    publishFailedToolEvent(server, tracing, error, startTime)
    throw error
  }
}

async function executeOriginalTool(
  originalHandler: MCPRequestHandler,
  server: MCPServerLike,
  request: MCPRequest,
  extra: MCPRequestExtra,
  tracing: ToolCallTracing,
  startTime: Date
): Promise<unknown> {
  try {
    const result = await originalHandler(request, extra)
    let finalResult = result
    if (tracing.mintedConversationId) {
      if (canInjectConversationIdPromptBack(result)) {
        finalResult = injectConversationIdPromptBack(result, tracing.mintedConversationId)
      } else if (tracing.event) {
        // Minted but undeliverable — agent will never see the id; drop it
        // from the captured event so it doesn't appear as an orphan.
        tracing.event.conversationId = undefined
      }
    }
    publishSuccessfulToolEvent(server, tracing, finalResult, startTime, {
      capturedError: extra?.__mcp_analytics_error,
      clearCapturedError: () => {
        if (extra) {
          extra.__mcp_analytics_error = undefined
        }
      },
    })
    return finalResult
  } catch (error) {
    if (tracing.mintedConversationId && tracing.event) {
      tracing.event.conversationId = undefined
    }
    publishFailedToolEvent(server, tracing, error, startTime)
    throw error
  }
}

function getContextArgument(request: MCPRequest): string | undefined {
  const context = request.params?.arguments?.context
  return typeof context === 'string' ? context : undefined
}

function publishSuccessfulToolEvent(
  server: MCPServerLike,
  tracing: ToolCallTracing,
  result: unknown,
  startTime: Date,
  options: {
    capturedError?: unknown
    clearCapturedError?: () => void
    userIntent?: string
    userIntentSource?: UnredactedEvent['userIntentSource']
  } = {}
): void {
  if (!(tracing.event && tracing.shouldPublishEvent)) {
    return
  }

  if (options.userIntent) {
    setExplicitContextIntent(tracing.event, options.userIntent)
    if (options.userIntentSource) {
      tracing.event.userIntentSource = options.userIntentSource
    }
  }
  if (isToolResultError(result)) {
    tracing.event.isError = true
    tracing.event.error = captureException(options.capturedError || result)
    options.clearCapturedError?.()
  } else {
    tracing.event.isError = false
  }

  tracing.event.response = result
  tracing.event.duration = Date.now() - startTime.getTime()
  publishEvent(server, tracing.event)
}

function publishFailedToolEvent(
  server: MCPServerLike,
  tracing: ToolCallTracing,
  error: unknown,
  startTime: Date
): void {
  if (!(tracing.event && tracing.shouldPublishEvent)) {
    return
  }

  tracing.event.isError = true
  tracing.event.error = captureException(error)
  tracing.event.duration = Date.now() - startTime.getTime()
  publishEvent(server, tracing.event)
}

export function setupTracking(server: HighLevelMCPServerLike): void {
  try {
    const mcpAnalyticsData = getServerTrackingData(server.server)

    setupToolsCallHandlerWrapping(server)

    setupInitializeTracing(server)

    server._registeredTools = addTracingToToolRegistry(server._registeredTools, server)

    if (mcpAnalyticsData) {
      seedToolDescriptionsFromRegistry(mcpAnalyticsData.toolDescriptions, server._registeredTools)
    }

    setupListToolsTracing(server)

    setupListenerToRegisteredTools(server)
  } catch (error) {
    log(`Warning: Failed to setup tool call tracing - ${error}`)
  }
}

function seedToolDescriptionsFromRegistry(cache: Map<string, string>, tools: Record<string, RegisteredTool>): void {
  for (const [name, tool] of Object.entries(tools)) {
    if (typeof tool?.description === 'string') {
      cache.set(name, tool.description)
    }
  }
}
