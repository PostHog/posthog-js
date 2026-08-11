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

  if (!modifiedTool.inputSchema) {
    modifiedTool.inputSchema = {
      type: 'object',
      properties: {},
      required: [],
    }
  }

  const contextDescription = contextDescriptionOverride || DEFAULT_CONTEXT_PARAMETER_DESCRIPTION

  // Deep copy: the server may reuse or freeze the schema object it handed us.
  modifiedTool.inputSchema = JSON.parse(JSON.stringify(modifiedTool.inputSchema)) as AnalyticsInjectableJsonSchema

  const inputSchema = modifiedTool.inputSchema as AnalyticsInjectableJsonSchema

  if (!inputSchema.properties) {
    inputSchema.properties = {}
  }

  // The MCP SDK emits `additionalProperties: false` when converting Zod schemas;
  // left in place it would make the injected `context` key invalid.
  if (inputSchema.additionalProperties === false) {
    inputSchema.additionalProperties = undefined
  }

  inputSchema.properties.context = {
    type: 'string',
    description: contextDescription,
  }

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
