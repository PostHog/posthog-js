import type { AnalyticsParameterOwnership } from '../types'
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
