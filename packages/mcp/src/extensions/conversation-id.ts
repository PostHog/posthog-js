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

/**
 * The shape of every id we mint: a uuidv7. Used to tell an echo of our own handle
 * from a value the agent made up.
 */
const MINTED_CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ConversationIdResolution =
  | { minted: false; conversationId: string | undefined }
  | { minted: true; conversationId: string }

/**
 * Decides which conversation_id to use for a tool call:
 *   - disabled → none
 *   - agent echoed a handle we could have minted → use it
 *   - anything else → mint a fresh one
 *
 * The shape check matters because this value becomes `$session_id`, and the
 * derivation is deterministic so that two pods agree — which also means two
 * *callers* sending the same string land in the same session. The strings agents
 * invent are not random (`conv-1`, `1`, `session`), so trusting them verbatim
 * would silently merge unrelated conversations, potentially across users. Shape
 * rather than a registry of issued ids, because a per-request server has no
 * memory of what it minted. Residual risk and why it's accepted: ADR-0004.
 */
export function resolveConversationId(enabled: boolean, args: unknown): ConversationIdResolution {
  if (!enabled) {
    return { minted: false, conversationId: undefined }
  }
  const supplied = extractConversationId(args)
  if (supplied && MINTED_CONVERSATION_ID.test(supplied)) {
    // Lowercased: the shape test is case-insensitive but the hash behind
    // `$session_id` is not, so an uppercased echo (some hosts normalise uuids)
    // would land in a different session than the call that minted it.
    return { minted: false, conversationId: supplied.toLowerCase() }
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
    // Tool results are untrusted content. Keep this as data rather than an
    // instruction so clients do not classify it as prompt injection when they
    // are still using a cached tool schema without `conversation_id`.
    text: JSON.stringify({ conversation_id: conversationId }),
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
