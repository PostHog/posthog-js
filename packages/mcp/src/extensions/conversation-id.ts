// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import { uuidv7 } from '@posthog/core'
import {
  canInjectAnalyticsParameter,
  hasAnalyticsParameter,
  type AnalyticsInjectableJsonSchema,
} from './analytics-parameters'
import { DEFAULT_CONVERSATION_ID_DESCRIPTION } from './constants'
import { log, type LoggerFn } from './logger'

export const CONVERSATION_ID_PARAM_NAME = 'conversation_id'

export interface ConversationIdInjectableTool {
  inputSchema?: AnalyticsInjectableJsonSchema
  name?: string
  [key: string]: unknown
}

export function addConversationIdToTool<TTool extends ConversationIdInjectableTool>(
  tool: TTool,
  logger: LoggerFn = log
): TTool {
  const modifiedTool = { ...tool }
  const toolName = tool.name || 'unknown'
  const schema = modifiedTool.inputSchema as AnalyticsInjectableJsonSchema | undefined

  if (!canInjectAnalyticsParameter(schema, CONVERSATION_ID_PARAM_NAME)) {
    if (hasAnalyticsParameter(schema, CONVERSATION_ID_PARAM_NAME)) {
      logger(
        `WARN: Tool "${toolName}" already has '${CONVERSATION_ID_PARAM_NAME}' parameter. Skipping conversation_id injection.`
      )
    } else {
      logger(
        `WARN: Tool "${toolName}" has complex schema (oneOf/allOf/anyOf/$ref). Skipping conversation_id injection.`
      )
    }
    return modifiedTool
  }

  if (!modifiedTool.inputSchema) {
    modifiedTool.inputSchema = {
      type: 'object',
      properties: {},
      required: [],
    }
  }

  modifiedTool.inputSchema = JSON.parse(JSON.stringify(modifiedTool.inputSchema)) as AnalyticsInjectableJsonSchema

  const inputSchema = modifiedTool.inputSchema as AnalyticsInjectableJsonSchema

  if (!inputSchema.properties) {
    inputSchema.properties = {}
  }

  if (inputSchema.additionalProperties === false) {
    inputSchema.additionalProperties = undefined
  }

  inputSchema.properties[CONVERSATION_ID_PARAM_NAME] = {
    type: 'string',
    description: DEFAULT_CONVERSATION_ID_DESCRIPTION,
  }

  return modifiedTool
}

/**
 * Injects `conversation_id` across a tool listing, including the virtual
 * `get_more_tools` tool. Its calls publish `$mcp_missing_capability`, and a
 * capability gap is only meaningful next to the work that hit it — so it belongs
 * in the same session as the surrounding tool calls.
 */
export function addConversationIdToTools<TTool extends ConversationIdInjectableTool>(
  tools: TTool[],
  logger: LoggerFn = log
): TTool[] {
  return tools.map((tool) => addConversationIdToTool(tool, logger))
}

export type ConversationIdResolution =
  | { minted: false; conversationId: string | undefined }
  | { minted: true; conversationId: string }

/**
 * Decides which conversation_id to use for a tool call:
 *   - disabled → none
 *   - agent supplied a value → use it
 *   - agent omitted → mint a UUID
 */
export function resolveConversationId(enabled: boolean, args: unknown): ConversationIdResolution {
  if (!enabled) {
    return { minted: false, conversationId: undefined }
  }
  const supplied = extractConversationId(args)
  if (supplied) {
    return { minted: false, conversationId: supplied }
  }
  return { minted: true, conversationId: uuidv7() }
}

/**
 * Whether the prompt-back can ride this result's `content`. The only requirement
 * is an array to append to.
 *
 * Errored results included on purpose. A tool that fails on the first call of a
 * conversation is exactly when the agent needs the session handle: without it the
 * retry starts a fresh conversation, so the failure and its fix land in different
 * sessions.
 */
export function canInjectConversationIdPromptBack(result: unknown): boolean {
  if (!(result && typeof result === 'object')) {
    return false
  }
  return Array.isArray((result as { content?: unknown }).content)
}

export function extractConversationId(args: unknown): string | undefined {
  if (!(args && typeof args === 'object')) {
    return
  }
  const value = (args as Record<string, unknown>)[CONVERSATION_ID_PARAM_NAME]
  if (typeof value !== 'string') {
    return
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function stripConversationId(args: unknown): unknown {
  if (!args || typeof args !== 'object' || !(CONVERSATION_ID_PARAM_NAME in (args as Record<string, unknown>))) {
    return args
  }
  const { [CONVERSATION_ID_PARAM_NAME]: _omit, ...rest } = args as Record<string, unknown>
  return rest
}

export function buildConversationIdPromptBack(conversationId: string): {
  type: 'text'
  text: string
} {
  return {
    type: 'text',
    text: `[SERVER]: Reuse conversation_id=${conversationId} on every subsequent tool call in this conversation. Required for the server to correlate calls and provide context-aware results.`,
  }
}

export function injectConversationIdPromptBack(result: unknown, conversationId: string): unknown {
  if (!canInjectConversationIdPromptBack(result)) {
    return result
  }
  const resultObj = result as { content: unknown[] }
  return {
    ...resultObj,
    content: [...resultObj.content, buildConversationIdPromptBack(conversationId)],
  }
}
