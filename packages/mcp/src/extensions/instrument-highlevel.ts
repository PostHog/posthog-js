// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import type {
  CompatibleRequestHandlerExtra,
  CompatibleToolResultLike,
  HighLevelMCPServerLike,
  MCPServerLike,
  RegisteredTool,
  ToolCallback,
} from '../types'
import {
  analyticsOwnsParameter,
  getAnalyticsParameterOwnership,
  stripOwnedAnalyticsArguments,
} from './analytics-parameters'
import { isContextEnabled } from './context-parameters'
import { MCPAnalyticsEventType } from './event-types'
import { getServerTrackingData } from './internal'
import type { LoggerFn } from './logger'
import { createWrappedTool, getToolFunction, hasToolFunction } from './mcp-sdk-compat'
import { handleReportMissing, resolveMissingCapabilityToolName } from './tools'
import {
  handleInitializeRequest,
  handleListToolsRequest,
  patchRequestHandlers,
  captureToolCall,
  isToolAdvertised,
  readToolMetaCategory,
  type HandlerPatch,
} from './instrumentation'
import { getContextArgument } from './tracing-helpers'

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

function isCallbackUpdate(value: unknown): value is { callback: ToolCallback } {
  return !!value && typeof value === 'object' && 'callback' in value && typeof value.callback === 'function'
}

function addTracingToToolRegistry(
  tools: Record<string, RegisteredTool>,
  server: HighLevelMCPServerLike,
  logger: LoggerFn
): Record<string, RegisteredTool> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      addTracingToToolCallbackInternal(tool, name, server, () => tool.inputSchema, logger),
    ])
  )
}

function setupListenerToRegisteredTools(server: HighLevelMCPServerLike, logger: LoggerFn): void {
  try {
    const data = getServerTrackingData(server.server as MCPServerLike)
    if (!data) {
      logger('Warning: Cannot setup listener - no tracking data found')
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
              logger(`Tool ${String(property)} already processed, skipping proxy wrapping`)
              return Reflect.set(target, property, value)
            }

            if (wrappedCallbacks.has(getToolFunction(value))) {
              logger(`Tool ${String(property)} callback already wrapped, skipping proxy wrapping`)
              return Reflect.set(target, property, value)
            }

            // The MCP SDK's registry copy is currently stale after update(), but keep this lookup lazy so
            // ownership follows the current schema once the registry reflects live tool state.
            const getCurrentInputSchema = () => value.inputSchema
            const nextValue = addTracingToToolCallbackInternal(value, property, server, getCurrentInputSchema, logger)

            if (typeof nextValue.update === 'function') {
              const originalUpdate = nextValue.update
              nextValue.update = function (...updateArgs: unknown[]) {
                if (updateArgs[0]) {
                  const updateObj = updateArgs[0]
                  if (isCallbackUpdate(updateObj)) {
                    const wrappedTool = addTracingToToolCallbackInternal(
                      { callback: updateObj.callback },
                      property,
                      server,
                      getCurrentInputSchema,
                      logger
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
          logger(`Warning: Error in proxy set handler for tool ${String(property)} - ${error}`)
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

    logger('Successfully set up listener for new tool registrations')
  } catch (error) {
    logger(`Warning: Failed to setup listener for registered tools - ${error}`)
  }
}

/**
 * Wraps a registered tool's callback so the SDK-injected `context` and
 * `conversation_id` arguments are stripped before the tool sees them, and any
 * thrown error is stashed on `extra` for the request-handler wrapper to capture
 * (the high-level SDK turns thrown errors into `isError` results otherwise).
 *
 * This is purely the tool-facing concern; event capture lives in
 * {@link captureToolCall} via {@link handleToolCallRequest}.
 */
function addTracingToToolCallbackInternal(
  tool: RegisteredTool,
  toolName: string,
  server: HighLevelMCPServerLike,
  getCurrentInputSchema: () => unknown,
  logger: LoggerFn
): RegisteredTool {
  const originalCallback = getToolFunction(tool)
  const options = getServerTrackingData(server.server as MCPServerLike)?.options
  if (wrappedCallbacks.has(originalCallback)) {
    logger(`Tool ${toolName} callback already wrapped, skipping re-wrap`)
    return tool
  }

  if ((tool as ProcessedRegisteredTool)[MCP_ANALYTICS_PROCESSED]) {
    logger(`Tool ${toolName} already processed, skipping re-wrap`)
    return tool
  }

  const wrappedCallback = async (...params: unknown[]): Promise<CompatibleToolResultLike> => {
    let args: unknown
    let extra: CompatibleRequestHandlerExtra

    if (params.length === 2) {
      args = params[0]
      extra = params[1] as CompatibleRequestHandlerExtra
    } else {
      args = undefined
      extra = params[0] as CompatibleRequestHandlerExtra
    }

    const inputSchema = getCurrentInputSchema()
    const cleanedArgs = stripOwnedAnalyticsArguments(args, {
      context: isContextEnabled(options?.context) && analyticsOwnsParameter(inputSchema, 'context'),
      conversationId: options?.enableConversationId === true && analyticsOwnsParameter(inputSchema, 'conversation_id'),
    })
    try {
      if (cleanedArgs === undefined) {
        const handler = originalCallback as (extra: CompatibleRequestHandlerExtra) => Promise<CompatibleToolResultLike>
        return await handler(extra)
      }
      const handler = originalCallback as (
        args: unknown,
        extra: CompatibleRequestHandlerExtra
      ) => Promise<CompatibleToolResultLike>
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

async function handleToolCallRequest(
  highLevelServer: HighLevelMCPServerLike,
  server: MCPServerLike,
  originalCallToolHandler: MCPRequestHandler,
  request: MCPRequest,
  extra: MCPRequestExtra,
  logger: LoggerFn
): Promise<unknown> {
  const data = getServerTrackingData(server)
  if (!data) {
    logger(
      'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called instrument(server, options) before using tool calls.'
    )
    return await originalCallToolHandler(request, extra)
  }

  const toolName = request.params?.name
  const isMissingCapabilityCandidate =
    data.options.reportMissing && toolName === resolveMissingCapabilityToolName(data.options)

  if (isMissingCapabilityCandidate && (await isToolAdvertised(server, toolName, extra, data.logger)) === false) {
    const context = getContextArgument(request) || ''
    return await captureToolCall({
      server,
      data,
      request,
      extra,
      eventType: MCPAnalyticsEventType.mcpMissingCapability,
      explicitContextIntent: context,
      execute: async () => handleReportMissing({ context }, data.logger),
    })
  }

  const registeredTool = toolName ? highLevelServer._registeredTools[toolName] : undefined

  // Strip SDK-owned arguments before the MCP SDK validates the registered Zod
  // schema. The callback wrapper repeats the ownership-aware cleanup as a
  // defensive fallback for direct callback invocation.
  return await captureToolCall({
    server,
    data,
    request,
    extra,
    execute: (downstreamRequest) => originalCallToolHandler(downstreamRequest as MCPRequest, extra),
    parameterOwnership: registeredTool
      ? getAnalyticsParameterOwnership(registeredTool.inputSchema, registeredTool.outputSchema)
      : undefined,
    takeCapturedError: () => {
      const captured = extra?.__mcp_analytics_error
      if (extra) {
        extra.__mcp_analytics_error = undefined
      }
      return captured
    },
  })
}

export function instrumentHighLevelServer(server: HighLevelMCPServerLike, logger: LoggerFn): void {
  try {
    const lowLevelServer = server.server
    const mcpAnalyticsData = getServerTrackingData(lowLevelServer)

    const handlers: Record<string, HandlerPatch> = {
      initialize: (trackedServer, originalHandler, request, extra) =>
        handleInitializeRequest(trackedServer, originalHandler, request, extra, logger),
      'tools/list': (trackedServer, originalHandler, request, extra) =>
        handleListToolsRequest(trackedServer, originalHandler, request, extra, logger),
      'tools/call': (trackedServer, originalHandler, request, extra) =>
        handleToolCallRequest(server, trackedServer, originalHandler, request, extra, logger),
    }
    patchRequestHandlers(lowLevelServer, handlers)

    server._registeredTools = addTracingToToolRegistry(server._registeredTools, server, logger)

    if (mcpAnalyticsData) {
      seedToolDescriptionsFromRegistry(mcpAnalyticsData.toolDescriptions, server._registeredTools)
      seedToolCategoriesFromRegistry(mcpAnalyticsData.toolCategories, server._registeredTools)
    }

    setupListenerToRegisteredTools(server, logger)
  } catch (error) {
    logger(`Warning: Failed to setup tool call instrumentation - ${error}`)
  }
}

function seedToolDescriptionsFromRegistry(cache: Map<string, string>, tools: Record<string, RegisteredTool>): void {
  for (const [name, tool] of Object.entries(tools)) {
    if (typeof tool?.description === 'string') {
      cache.set(name, tool.description)
    }
  }
}

function seedToolCategoriesFromRegistry(cache: Map<string, string>, tools: Record<string, RegisteredTool>): void {
  for (const [name, tool] of Object.entries(tools)) {
    const category = readToolMetaCategory(tool?._meta)
    if (category) {
      cache.set(name, category)
    }
  }
}
