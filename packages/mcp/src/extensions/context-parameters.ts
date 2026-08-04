// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import type { MCPAnalyticsOptions } from '../types'
import {
  canInjectAnalyticsParameter,
  hasAnalyticsParameter,
  type AnalyticsInjectableJsonSchema,
} from './analytics-parameters'
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
 * Adds a context parameter to a tool's JSON Schema.
 * This function is called AFTER the MCP SDK has converted Zod schemas to JSON Schema,
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
  // Create a shallow copy of the tool to avoid modifying the original
  const modifiedTool = { ...tool }
  const toolName = tool.name || 'unknown'
  const schema = modifiedTool.inputSchema as AnalyticsInjectableJsonSchema | undefined

  if (!canInjectAnalyticsParameter(schema, 'context')) {
    if (hasAnalyticsParameter(schema, 'context')) {
      logger(`WARN: Tool "${toolName}" already has 'context' parameter. Skipping context injection.`)
    } else {
      logger(`WARN: Tool "${toolName}" has complex schema (oneOf/allOf/anyOf/$ref). Skipping context injection.`)
    }
    return modifiedTool
  }

  // Note: If additionalProperties is false, we'll need to remove that constraint
  // when adding context, otherwise the schema would be invalid. We handle this
  // after the deep copy below.

  if (!modifiedTool.inputSchema) {
    modifiedTool.inputSchema = {
      type: 'object',
      properties: {},
      required: [],
    }
  }

  const contextDescription = contextDescriptionOverride || DEFAULT_CONTEXT_PARAMETER_DESCRIPTION

  // Deep copy the inputSchema to avoid mutations
  modifiedTool.inputSchema = JSON.parse(JSON.stringify(modifiedTool.inputSchema)) as AnalyticsInjectableJsonSchema

  const inputSchema = modifiedTool.inputSchema as AnalyticsInjectableJsonSchema

  // Ensure properties object exists
  if (!inputSchema.properties) {
    inputSchema.properties = {}
  }

  // Handle additionalProperties: false - must remove this constraint since we're adding context
  // The MCP SDK adds this constraint when converting Zod schemas to JSON Schema
  if (inputSchema.additionalProperties === false) {
    inputSchema.additionalProperties = undefined
  }

  // Add context property
  inputSchema.properties.context = {
    type: 'string',
    description: contextDescription,
  }

  // Add context to required array
  if (Array.isArray(inputSchema.required)) {
    if (!inputSchema.required.includes('context')) {
      inputSchema.required.push('context')
    }
  } else {
    inputSchema.required = ['context']
  }

  return modifiedTool
}

export function addContextParameterToTools<TTool extends ContextInjectableTool>(
  tools: TTool[],
  contextDescriptionOverride?: string,
  logger: LoggerFn = log
): TTool[] {
  return tools.map((tool) => addContextParameterToTool(tool, contextDescriptionOverride, logger))
}
