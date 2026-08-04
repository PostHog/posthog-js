// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CompatibleRequestHandlerExtra, MCPRequestLike, MCPServerLike } from '../types'
import { MCPAnalyticsEventType } from './event-types'
import { getServerTrackingData } from './internal'
import type { LoggerFn } from './logger'
import { handleReportMissing, resolveMissingCapabilityToolName } from './tools'
import {
  handleInitializeRequest,
  handleListToolsRequest,
  patchRequestHandlers,
  captureToolCall,
  isToolAdvertised,
  type HandlerPatch,
} from './instrumentation'
import { getContextArgument } from './tracing-helpers'

type MCPRequestHandler = NonNullable<
  MCPServerLike['_requestHandlers'] extends Map<string, infer THandler> ? THandler : never
>
type MCPRequest = Parameters<MCPRequestHandler>[0]
type MCPRequestExtra = Parameters<MCPRequestHandler>[1]

/**
 * Instruments a low-level `Server`: wraps `initialize`, `tools/list`, and
 * `tools/call`. The tool-call lifecycle is delegated to {@link captureToolCall},
 * shared with the high-level wrapper.
 */
export function instrumentLowLevelServer(server: MCPServerLike, logger: LoggerFn): void {
  try {
    // Patch already existing handlers, and patch setRequestHandler to capture dynamically created handlers.
    const hadCallToolHandler = server._requestHandlers.has('tools/call')
    const handlers: Record<string, HandlerPatch> = {
      initialize: (server, originalHandler, request, extra) =>
        handleInitializeRequest(server, originalHandler, request, extra, logger),
      'tools/list': (server, originalHandler, request, extra) =>
        handleListToolsRequest(server, originalHandler, request, extra, logger),
      'tools/call': (server, originalHandler, request, extra) =>
        handleToolCallRequest(server, originalHandler, request, extra, logger),
    }
    patchRequestHandlers(server, handlers)

    if (!hadCallToolHandler) {
      // Register a raw fallback through the patched setter so reportMissing works
      // even before an application dispatcher is attached. A later registration
      // replaces it and is wrapped by patchRequestHandlers.
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        throw new Error(`Unknown tool: ${request.params?.name || 'unknown'}`)
      })
    }
  } catch (error) {
    logger(`Warning: Failed to setup tool call instrumentation - ${error}`)
    throw error
  }
}

async function handleToolCallRequest(
  server: MCPServerLike,
  originalCallToolHandler: MCPRequestHandler | undefined,
  request: MCPRequest,
  extra: MCPRequestExtra,
  logger: LoggerFn
): Promise<unknown> {
  const data = getServerTrackingData(server)
  if (!data) {
    logger(
      'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called instrument(server, options) before using tool calls.'
    )
    return await originalCallToolHandler?.(request, extra)
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

  return await captureToolCall({
    server,
    data,
    request,
    extra,
    execute: (downstreamRequest: MCPRequestLike) =>
      runOriginalToolHandler(originalCallToolHandler, downstreamRequest, extra),
  })
}

function runOriginalToolHandler(
  handler: MCPRequestHandler | undefined,
  request: MCPRequestLike,
  extra: CompatibleRequestHandlerExtra | undefined
): Promise<unknown> {
  if (!handler) {
    throw new Error(`Unknown tool: ${request.params?.name || 'unknown'}`)
  }
  return handler(request, extra)
}
