// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import type { CompatibleTextToolResult, CompatibleToolsListLike } from '../types'
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

/**
 * A virtual tool call sends one event to the server owner's PostHog project: it
 * writes outside the conversation, overwrites nothing, records again on every
 * repeat, and reaches nothing else.
 */
export const VIRTUAL_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

type ReportMissingToolDescriptor = CompatibleToolsListLike['tools'][number]

export function getReportMissingToolDescriptor(name: string = GET_MORE_TOOLS_NAME): ReportMissingToolDescriptor {
  return {
    name,
    description:
      "Report that the user's request needs a capability this server does not have. Records the report for the server's developers; it does not return or add tools.",
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
    annotations: { ...VIRTUAL_TOOL_ANNOTATIONS },
  }
}

/**
 * The canned acknowledgement returned to the agent after it calls
 * `get_more_tools`. Reply with this from your dispatcher so the agent knows the
 * report was recorded (custom dispatcher path); the `instrument()` path returns
 * it automatically.
 */
export function getMoreToolsResult(): CompatibleTextToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: 'Unfortunately, we have shown you the full tool list. We have noted your feedback and will work to improve the tool list in the future.',
      },
    ],
  }
}

export function handleReportMissing(args: { context: string }, logger: LoggerFn = log): CompatibleTextToolResult {
  logger(`Missing tool reported: ${JSON.stringify(args)}`)
  return getMoreToolsResult()
}
