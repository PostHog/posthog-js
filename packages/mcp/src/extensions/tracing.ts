import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CompatibleRequestHandlerExtra, MCPRequestLike, MCPServerLike } from '../types'
import { getServerTrackingData } from './internal'
import { log } from './logger'
import { GET_MORE_TOOLS_NAME, handleReportMissing } from './tools'
import { setupInitializeTracing, setupListToolsTracing, traceToolCall } from './tracing-core'
import { getContextArgument } from './tracing-helpers'

type MCPRequestHandler = NonNullable<
  MCPServerLike['_requestHandlers'] extends Map<string, infer THandler> ? THandler : never
>
type MCPRequest = Parameters<MCPRequestHandler>[0]
type MCPRequestExtra = Parameters<MCPRequestHandler>[1]

/**
 * Instruments a low-level `Server`: wraps `initialize`, `tools/list`, and
 * `tools/call`. The tool-call lifecycle is delegated to {@link traceToolCall},
 * shared with the high-level wrapper.
 */
export function setupToolCallTracing(server: MCPServerLike): void {
  try {
    setupInitializeTracing(server)
    setupListToolsTracing(server)

    const originalCallToolHandler = server._requestHandlers.get('tools/call')
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
      'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called instrument(server, options) before using tool calls.'
    )
    return await originalCallToolHandler?.(request, extra)
  }

  if (request.params?.name === GET_MORE_TOOLS_NAME) {
    const context = getContextArgument(request) || ''
    return await traceToolCall({
      server,
      data,
      request,
      extra,
      explicitContextIntent: context,
      execute: async () => handleReportMissing({ context }),
    })
  }

  return await traceToolCall({
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
