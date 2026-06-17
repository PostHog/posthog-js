// Portions of this file are derived from MCPCat/mcpcat-typescript-sdk
// Copyright (c) 2025 MCPcat
// Licensed under the MIT License: https://github.com/MCPCat/mcpcat-typescript-sdk/blob/main/LICENSE

import { type CallToolResult, type ListToolsResult } from '@modelcontextprotocol/sdk/types.js'
import { log } from './logger'

export const GET_MORE_TOOLS_NAME = 'get_more_tools' as const

type ReportMissingToolDescriptor = ListToolsResult['tools'][number]

export function getReportMissingToolDescriptor(): ReportMissingToolDescriptor {
  return {
    name: GET_MORE_TOOLS_NAME,
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
      // Doesn't mutate state on the MCP server
      readOnlyHint: true,
      // Interacts with external entities because we store this in analytics
      openWorldHint: true,
      // A tool like `get_more_tools` would usually NOT be idempontent, but since we are
      // only using this to keep track of missing tools/feedback/analytics, it is actually idempontent.
      // It's also preferable to track it as idempontent to make agents more prone to call it proactively.
      idempotentHint: true,
      // Never deletes any data from the MCP server
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

export function handleReportMissing(args: { context: string }): CallToolResult {
  log(`Missing tool reported: ${JSON.stringify(args)}`)
  return getMoreToolsResult()
}
