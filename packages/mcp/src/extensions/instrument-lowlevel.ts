// Portions of this file are derived from MCPCat/mcpcat-typescript-sdk
// Copyright (c) 2025 MCPcat
// Licensed under the MIT License: https://github.com/MCPCat/mcpcat-typescript-sdk/blob/main/LICENSE

import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CompatibleRequestHandlerExtra, MCPRequestLike, MCPServerLike } from '../types'
import { MCPAnalyticsEventType } from './event-types'
import { getServerTrackingData } from './internal'
import { log } from './logger'
import { handleReportMissing, resolveMissingCapabilityToolName } from './tools'
import { buildFeedbackEventProperties, handleSubmitFeedback, resolveFeedbackToolName } from './feedback'
import {
  handleInitializeRequest,
  handleListToolsRequest,
  patchRequestHandlers,
  captureToolCall,
} from './instrumentation'
import { getContextArgument, getToolArguments } from './tracing-helpers'

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
export function instrumentLowLevelServer(server: MCPServerLike): void {
  try {
    // Patch already existing handlers, and patch setRequestHandler to capture dynamically created handlers.
    const handlers = {
      initialize: handleInitializeRequest,
      'tools/list': handleListToolsRequest,
    }
    patchRequestHandlers(server, handlers)

    const originalCallToolHandler = server._requestHandlers.get('tools/call')
    server.setRequestHandler(
      CallToolRequestSchema,
      async (request, extra) => await handleToolCallRequest(server, originalCallToolHandler, request, extra)
    )
  } catch (error) {
    log(`Warning: Failed to setup tool call instrumentation - ${error}`)
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
      'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called instrument(server, options) before using tool calls.'
    )
    return await originalCallToolHandler?.(request, extra)
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

  if (request.params?.name === resolveFeedbackToolName(data.options)) {
    const feedback = getToolArguments(request)
    return await captureToolCall({
      server,
      data,
      request,
      extra,
      eventType: MCPAnalyticsEventType.mcpFeedback,
      eventProperties: buildFeedbackEventProperties(feedback),
      execute: async () => handleSubmitFeedback(feedback),
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
