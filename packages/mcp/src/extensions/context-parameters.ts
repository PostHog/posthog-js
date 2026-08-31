// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import type { MCPAnalyticsOptions } from '../types'
import { addAnalyticsParameterToTool, type AnalyticsInjectableJsonSchema } from './analytics-parameters'
import { DEFAULT_CONTEXT_PARAMETER_DESCRIPTION } from './constants'
import { log, type LoggerFn } from './logger'

export interface ContextInjectableTool {
  inputSchema?: AnalyticsInjectableJsonSchema
  name?: string
  [key: string]: unknown
}

export function isContextEnabled(context: MCPAnalyticsOptions['context']): boolean {
  return context !== false
}

export function getContextDescription(context: MCPAnalyticsOptions['context']): string | undefined {
  return typeof context === 'object' ? context.description : undefined
}

/**
 * Adds a context parameter to a tool's JSON Schema, via the shared injector.
 * This is called AFTER the MCP SDK has converted Zod schemas to JSON Schema,
 * so we only need to handle JSON Schema format.
 *
 * Skips injection (with warning) for:
 * - Tools that already have a 'context' parameter
 * - Complex schemas (oneOf/allOf/anyOf/$ref) that can't safely have properties added
 * - Schemas with additionalProperties: false
 */
export function addContextParameterToTool<TTool extends ContextInjectableTool>(
  tool: TTool,
  contextDescriptionOverride?: string,
  logger: LoggerFn = log
): TTool {
  return addAnalyticsParameterToTool(
    tool,
    'context',
    contextDescriptionOverride || DEFAULT_CONTEXT_PARAMETER_DESCRIPTION,
    'context',
    logger
  )
}

export function addContextParameterToTools<TTool extends ContextInjectableTool>(
  tools: TTool[],
  contextDescriptionOverride?: string,
  logger: LoggerFn = log
): TTool[] {
  return tools.map((tool) => addContextParameterToTool(tool, contextDescriptionOverride, logger))
}
