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
import { log } from './logger'
import { GET_MORE_TOOLS_NAME } from './tools'

export const CONVERSATION_ID_PARAM_NAME = 'conversation_id'

export interface ConversationIdInjectableTool {
  inputSchema?: AnalyticsInjectableJsonSchema
  name?: string
  [key: string]: unknown
}

export function addConversationIdToTool<TTool extends ConversationIdInjectableTool>(tool: TTool): TTool {
  const modifiedTool = { ...tool }
  const toolName = tool.name || 'unknown'
  const schema = modifiedTool.inputSchema as AnalyticsInjectableJsonSchema | undefined

  if (!canInjectAnalyticsParameter(schema, CONVERSATION_ID_PARAM_NAME)) {
    if (hasAnalyticsParameter(schema, CONVERSATION_ID_PARAM_NAME)) {
      log(
        `WARN: Tool "${toolName}" already has '${CONVERSATION_ID_PARAM_NAME}' parameter. Skipping conversation_id injection.`
      )
    } else {
      log(`WARN: Tool "${toolName}" has complex schema (oneOf/allOf/anyOf/$ref). Skipping conversation_id injection.`)
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

export function addConversationIdToTools<TTool extends ConversationIdInjectableTool>(
  tools: TTool[],
  missingCapabilityToolName: string = GET_MORE_TOOLS_NAME,
  skipMissingCapabilityTool = true
): TTool[] {
  return tools.map((tool) => {
    if (skipMissingCapabilityTool && tool.name === missingCapabilityToolName) {
      return tool
    }
    return addConversationIdToTool(tool)
  })
}

export type ConversationIdResolution =
  | { minted: false; conversationId: string | undefined }
  | { minted: true; conversationId: string }

/**
 * Decides which conversation_id to use for a tool call:
 *   - disabled or get_more_tools → none
 *   - agent supplied a value → use it
 *   - agent omitted → mint a UUID
 */
export function resolveConversationId(
  enabled: boolean,
  args: unknown,
  toolName: string | undefined,
  missingCapabilityToolName: string = GET_MORE_TOOLS_NAME
): ConversationIdResolution {
  if (!enabled || toolName === missingCapabilityToolName) {
    return { minted: false, conversationId: undefined }
  }
  const supplied = extractConversationId(args)
  if (supplied) {
    return { minted: false, conversationId: supplied }
  }
  return { minted: true, conversationId: uuidv7() }
}

/**
 * Predicate matching the same eligibility checks injectConversationIdPromptBack uses,
 * exposed so callers can pre-decide whether the prompt-back will actually land
 * (and clear event.conversationId if not, to avoid orphan ids in analytics).
 */
export function canInjectConversationIdPromptBack(result: unknown): boolean {
  if (!(result && typeof result === 'object')) {
    return false
  }
  const resultObj = result as { content?: unknown; isError?: unknown }
  if (resultObj.isError === true) {
    return false
  }
  return Array.isArray(resultObj.content)
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
