import type { AnalyticsParameterOwnership, ServerClientInfoLike } from '../types'
import { getObjectShape, isZodRawShapeCompat } from './mcp-sdk-compat'
import { canDeclareOutputInstructions } from './output-instructions'

const sharedOwnershipCaches = new Map<string, Map<string, AnalyticsParameterOwnership>>()

/**
 * The tool-ownership cache for a server identity, shared by every instance of
 * that server in this process.
 *
 * Which arguments we own is a property of the advertised schemas, so every
 * instance a factory produces answers it identically. Sharing is what makes the
 * answer available at all under the per-request server pattern, where
 * `tools/list` lands on one instance and `tools/call` on a cold one that will
 * never serve a listing of its own. Without it, a stateless server silently
 * treats the `context` argument we injected as the tool's own — no `$mcp_intent`
 * recorded, and the argument passed on to a tool that never declared it.
 *
 * Deliberately *not* solved by having the cold instance call its own
 * `tools/list`: re-entering the application's list handler from inside a
 * `tools/call` deadlocks whenever the two share a lock.
 *
 * Keyed by name and version so two servers sharing a process keep their own.
 */
export function getSharedToolOwnershipCache(
  serverInfo: ServerClientInfoLike | undefined
): Map<string, AnalyticsParameterOwnership> {
  const key = `${serverInfo?.name ?? ''}@${serverInfo?.version ?? ''}`
  let cache = sharedOwnershipCaches.get(key)
  if (!cache) {
    cache = new Map()
    sharedOwnershipCaches.set(key, cache)
  }
  return cache
}

/** Test seam: these caches are process-scoped, so they outlive any one server. */
export function resetSharedToolOwnershipCaches(): void {
  sharedOwnershipCaches.clear()
}

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
    outputInstructions: canDeclareOutputInstructions(outputSchema),
  }
}

/**
 * Removes the arguments we injected, leaving the host's own. Input-side only, so
 * it takes just those two flags rather than the whole ownership record — callers
 * that have no output-schema context should not have to invent a value for it.
 */
export function stripOwnedAnalyticsArguments(
  args: unknown,
  ownership: Pick<AnalyticsParameterOwnership, 'context' | 'conversationId'>
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
  return cleanedArgs
}
