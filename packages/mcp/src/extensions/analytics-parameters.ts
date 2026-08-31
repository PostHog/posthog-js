import type { AnalyticsParameterOwnership } from '../types'
import { log, type LoggerFn } from './logger'
import { getObjectShape, isZodRawShapeCompat } from './mcp-sdk-compat'
import { canDeclareOutputInstructions } from './output-instructions'

const JSON_SCHEMA_KEYWORDS = [
  '$defs',
  '$ref',
  'additionalProperties',
  'allOf',
  'anyOf',
  'definitions',
  'oneOf',
  'properties',
  'required',
  'type',
]

export interface AnalyticsInjectableJsonSchema {
  $ref?: unknown
  additionalProperties?: boolean
  allOf?: unknown
  anyOf?: unknown
  oneOf?: unknown
  properties?: Record<string, unknown>
  required?: string[]
  type?: string
}

export function hasAnalyticsParameter(
  schema: AnalyticsInjectableJsonSchema | undefined,
  parameterName: string
): boolean {
  return !!schema?.properties && Object.prototype.hasOwnProperty.call(schema.properties, parameterName)
}

export function canInjectAnalyticsParameter(
  schema: AnalyticsInjectableJsonSchema | undefined,
  parameterName: string
): boolean {
  return (
    !hasAnalyticsParameter(schema, parameterName) && !schema?.$ref && !schema?.oneOf && !schema?.allOf && !schema?.anyOf
  )
}

export interface AnalyticsInjectableTool {
  inputSchema?: AnalyticsInjectableJsonSchema
  name?: string
  [key: string]: unknown
}

/**
 * Adds a required string parameter to a tool's JSON Schema. Called AFTER the MCP
 * SDK has converted Zod schemas to JSON Schema, so only JSON Schema needs
 * handling.
 *
 * Shared by every analytics parameter we inject (`context`, `llm_model`) so
 * schema ownership, cloning, and required-field behavior cannot drift between
 * them. `injectionLabel` only names the feature in the skip warnings.
 *
 * Skips injection (with a warning) for:
 * - Tools that already declare the parameter — it is theirs, not ours
 * - Complex schemas (oneOf/allOf/anyOf/$ref) that can't safely gain properties
 */
export function addAnalyticsParameterToTool<TTool extends AnalyticsInjectableTool>(
  tool: TTool,
  parameterName: string,
  description: string,
  injectionLabel: string,
  logger: LoggerFn = log
): TTool {
  const modifiedTool = { ...tool }
  const toolName = tool.name || 'unknown'
  const schema = modifiedTool.inputSchema as AnalyticsInjectableJsonSchema | undefined

  if (!canInjectAnalyticsParameter(schema, parameterName)) {
    if (hasAnalyticsParameter(schema, parameterName)) {
      logger(`WARN: Tool "${toolName}" already has '${parameterName}' parameter. Skipping ${injectionLabel} injection.`)
    } else {
      logger(
        `WARN: Tool "${toolName}" has complex schema (oneOf/allOf/anyOf/$ref). Skipping ${injectionLabel} injection.`
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

  // Deep copy: the server may reuse or freeze the schema object it handed us.
  modifiedTool.inputSchema = JSON.parse(JSON.stringify(modifiedTool.inputSchema)) as AnalyticsInjectableJsonSchema

  const inputSchema = modifiedTool.inputSchema as AnalyticsInjectableJsonSchema

  if (!inputSchema.properties) {
    inputSchema.properties = {}
  }

  // The MCP SDK emits `additionalProperties: false` when converting Zod schemas;
  // left in place it would make the injected key invalid.
  if (inputSchema.additionalProperties === false) {
    inputSchema.additionalProperties = undefined
  }

  inputSchema.properties[parameterName] = {
    type: 'string',
    description,
  }

  if (Array.isArray(inputSchema.required)) {
    if (!inputSchema.required.includes(parameterName)) {
      inputSchema.required.push(parameterName)
    }
  } else {
    inputSchema.required = [parameterName]
  }

  return modifiedTool
}

export function analyticsOwnsParameter(inputSchema: unknown, parameterName: string): boolean {
  if (!inputSchema || typeof inputSchema !== 'object') {
    return canInjectAnalyticsParameter(undefined, parameterName)
  }

  if (isZodRawShapeCompat(inputSchema)) {
    return canInjectAnalyticsParameter({ properties: inputSchema }, parameterName)
  }

  const shape = getObjectShape(inputSchema)
  if (shape) {
    return canInjectAnalyticsParameter({ properties: shape }, parameterName)
  }

  const schema = inputSchema as Record<string, unknown>
  if (JSON_SCHEMA_KEYWORDS.some((keyword) => Object.prototype.hasOwnProperty.call(schema, keyword))) {
    return canInjectAnalyticsParameter(schema, parameterName)
  }

  if ('_def' in schema || '_zod' in schema || '~standard' in schema) {
    // The MCP SDK advertises non-object schemas as an empty object schema.
    return canInjectAnalyticsParameter(undefined, parameterName)
  }

  return canInjectAnalyticsParameter(schema, parameterName)
}

export function getAnalyticsParameterOwnership(
  inputSchema: unknown,
  outputSchema?: unknown
): AnalyticsParameterOwnership {
  return {
    context: analyticsOwnsParameter(inputSchema, 'context'),
    conversationId: analyticsOwnsParameter(inputSchema, 'conversation_id'),
    llmModel: analyticsOwnsParameter(inputSchema, 'llm_model'),
    outputInstructions: canDeclareOutputInstructions(outputSchema),
  }
}

/**
 * Removes the arguments we injected, leaving the host's own. Input-side only, so
 * it takes just those flags rather than the whole ownership record — callers
 * that have no output-schema context should not have to invent a value for it.
 */
export function stripOwnedAnalyticsArguments(
  args: unknown,
  ownership: Pick<AnalyticsParameterOwnership, 'context' | 'conversationId' | 'llmModel'>
): unknown {
  let cleanedArgs = args
  if (ownership.context && cleanedArgs && typeof cleanedArgs === 'object' && 'context' in cleanedArgs) {
    const { context: _context, ...rest } = cleanedArgs
    cleanedArgs = rest
  }
  if (ownership.conversationId && cleanedArgs && typeof cleanedArgs === 'object' && 'conversation_id' in cleanedArgs) {
    const { conversation_id: _conversationId, ...rest } = cleanedArgs
    cleanedArgs = rest
  }
  if (ownership.llmModel && cleanedArgs && typeof cleanedArgs === 'object' && 'llm_model' in cleanedArgs) {
    const { llm_model: _llmModel, ...rest } = cleanedArgs
    cleanedArgs = rest
  }
  return cleanedArgs
}
