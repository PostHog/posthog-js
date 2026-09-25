import type { JsonRecord } from '../types'
import { PostHogMCPAnalyticsProperty } from './constants'
import { getObjectShape, isZodRawShapeCompat, unwrapInputSchema } from './mcp-sdk-compat'

const MAX_INPUT_KEYS = 20
const MAX_KEY_LENGTH = 64
const ANALYTICS_KEYS = new Set(['context', 'llm_model', 'conversation_id'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function declaredProperties(schema: unknown): Record<string, unknown> | undefined {
  if (!isRecord(schema)) return undefined
  const properties = schema.properties
  if (isZodRawShapeCompat(schema)) return schema
  return getObjectShape(unwrapInputSchema(schema)) ?? (isRecord(properties) ? properties : undefined)
}

/**
 * Describe the original arguments without reading their values.
 * Pass a server-owned JSON Schema or Zod object schema, never a schema from the caller.
 * Unknown names become `[redacted]` because an argument name can contain private data.
 */
export function getToolInputProperties(input: unknown, inputSchema?: unknown): JsonRecord {
  try {
    if (!isRecord(input)) return {}
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== null && prototype !== Object.prototype) return {}
    const properties = declaredProperties(inputSchema)
    const known = new Set(Object.keys(properties ?? {}))
    const keys = Object.keys(input).filter((key) => known.has(key) || !ANALYTICS_KEYS.has(key))
    const declared = keys.filter((key) => known.has(key) && key.length <= MAX_KEY_LENGTH).sort()
    const hasRedacted = keys.some((key) => !known.has(key) || key.length > MAX_KEY_LENGTH)
    const visibleKeys = declared.slice(0, MAX_INPUT_KEYS)
    if (hasRedacted && visibleKeys.length < MAX_INPUT_KEYS) {
      visibleKeys.push('[redacted]')
    }
    return { [PostHogMCPAnalyticsProperty.InputKeys]: visibleKeys }
  } catch {
    return {}
  }
}
