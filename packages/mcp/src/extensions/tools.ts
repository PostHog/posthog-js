// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import { type CallToolResult, type ListToolsResult } from '@modelcontextprotocol/sdk/types.js'
import { log, type LoggerFn } from './logger'

export const GET_MORE_TOOLS_NAME = 'get_more_tools' as const

/**
 * The configured name of the `get_more_tools` virtual tool, falling back to the
 * default. Resolve through here everywhere (inject + detect) so a custom name
 * can't drift between call sites.
 */
export function resolveMissingCapabilityToolName(options?: { missingCapabilityToolName?: string }): string {
  return options?.missingCapabilityToolName ?? GET_MORE_TOOLS_NAME
}

type ReportMissingToolDescriptor = ListToolsResult['tools'][number]

export function getReportMissingToolDescriptor(name: string = GET_MORE_TOOLS_NAME): ReportMissingToolDescriptor {
  return {
    name,
    description:
      'Check for additional tools whenever your task might benefit from specialized capabilities - even if existing tools could work as a fallback.',
    inputSchema: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: 'A description of your goal and what kind of tool would help accomplish it.',
        },
      },
      required: ['context'],
    },
    annotations: {
      title: 'Get More Tools',
      readOnlyHint: true,
      // Interacts with an external entity: the report lands in analytics.
      openWorldHint: true,
      // Only records the gap, so repeat calls are harmless — and advertising it
      // as idempotent makes agents more willing to call it proactively.
      idempotentHint: true,
      destructiveHint: false,
    },
  }
}

/**
 * The canned acknowledgement returned to the agent after it calls
 * `get_more_tools`. Reply with this from your dispatcher so the agent knows the
 * report was recorded (custom dispatcher path); the `instrument()` path returns
 * it automatically.
 */
export function getMoreToolsResult(): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: 'Unfortunately, we have shown you the full tool list. We have noted your feedback and will work to improve the tool list in the future.',
      },
    ],
  }
}

export function handleReportMissing(args: { context: string }, logger: LoggerFn = log): CallToolResult {
  logger(`Missing tool reported: ${JSON.stringify(args)}`)
  return getMoreToolsResult()
}
