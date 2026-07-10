// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { CompatibleRequestHandlerExtra, HighLevelMCPServerLike, MCPServerLike, RegisteredTool } from '../types'
import { stripConversationId } from './conversation-id'
import { MCPAnalyticsEventType } from './event-types'
import { getServerTrackingData } from './internal'
import { log } from './logger'
import { createWrappedTool, getToolFunction, hasToolFunction } from './mcp-sdk-compat'
import { handleReportMissing, resolveMissingCapabilityToolName } from './tools'
import {
  handleInitializeRequest,
  handleListToolsRequest,
  patchRequestHandlers,
  captureToolCall,
  readToolMetaCategory,
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
  server: HighLevelMCPServerLike
): RegisteredTool {
  const originalCallback = getToolFunction(tool)
  const missingToolName = resolveMissingCapabilityToolName(
    getServerTrackingData(server.server as MCPServerLike)?.options
  )

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

    const cleanedArgs = toolName === missingToolName ? args : stripConversationId(removeContextFromArgs(args))

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

async function handleToolCallRequest(
  server: MCPServerLike,
  originalCallToolHandler: MCPRequestHandler,
  request: MCPRequest,
  extra: MCPRequestExtra
): Promise<unknown> {
  const data = getServerTrackingData(server)
  if (!data) {
    log(
      'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called instrument(server, options) before using tool calls.'
    )
    return await originalCallToolHandler(request, extra)
  }

  if (request.params?.name === resolveMissingCapabilityToolName(data.options)) {
    const context = getContextArgument(request) || ''
    return await captureToolCall({
      server,
      data,
      request,
      extra,
      eventType: MCPAnalyticsEventType.mcpMissingCapability,
      explicitContextIntent: context,
      execute: async () => handleReportMissing({ context }),
    })
  }

  // The high-level handler re-derives arguments from the original request and
  // strips the injected params inside the wrapped callback, so we hand it the
  // original request rather than the conversation-stripped one. Errors thrown
  // by the tool are stashed on `extra` by the callback wrapper; surface them.
  return await captureToolCall({
    server,
    data,
    request,
    extra,
    execute: () => originalCallToolHandler(request, extra),
    takeCapturedError: () => {
      const captured = extra?.__mcp_analytics_error
      if (extra) {
        extra.__mcp_analytics_error = undefined
      }
      return captured
    },
  })
}

export function instrumentHighLevelServer(server: HighLevelMCPServerLike): void {
  try {
    const lowLevelServer = server.server
    const mcpAnalyticsData = getServerTrackingData(lowLevelServer)

    // Patch already existing handlers, and patch setRequestHandler to capture dynamically created handlers.
    const handlers = {
      initialize: handleInitializeRequest,
      'tools/list': handleListToolsRequest,
      'tools/call': handleToolCallRequest,
    }
    patchRequestHandlers(lowLevelServer, handlers)

    server._registeredTools = addTracingToToolRegistry(server._registeredTools, server)

    if (mcpAnalyticsData) {
      seedToolDescriptionsFromRegistry(mcpAnalyticsData.toolDescriptions, server._registeredTools)
      seedToolCategoriesFromRegistry(mcpAnalyticsData.toolCategories, server._registeredTools)
    }

    setupListenerToRegisteredTools(server)
  } catch (error) {
    log(`Warning: Failed to setup tool call instrumentation - ${error}`)
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
