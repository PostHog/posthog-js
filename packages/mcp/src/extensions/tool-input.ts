import type { JsonRecord, ShouldRecordInputKeyFn, ToolInputOptions } from '../types'
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

const recordDeclaredOnly: ShouldRecordInputKeyFn = (_key, { declared }) => declared

function shouldRecord(fn: ShouldRecordInputKeyFn, key: string, declared: boolean): boolean {
  try {
    return fn(key, { declared }) === true
  } catch {
    return false
  }
}

/**
 * Describe the original arguments without reading their values.
 * Pass a server-owned JSON Schema or Zod object schema, never a schema from the caller.
 * By default unknown names become `[redacted]` because an argument name can contain private data;
 * `shouldRecordInputKey` replaces that rule.
 */
export function getToolInputProperties(input: unknown, inputSchema?: unknown, options?: ToolInputOptions): JsonRecord {
  try {
    if (!isRecord(input)) return {}
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== null && prototype !== Object.prototype) return {}
    const properties = declaredProperties(inputSchema)
    const known = new Set(Object.keys(properties ?? {}))
    const keys = Object.keys(input).filter((key) => known.has(key) || !ANALYTICS_KEYS.has(key))
    const record = options?.shouldRecordInputKey ?? recordDeclaredOnly
    const declared: string[] = []
    const undeclared: string[] = []
    let hasRedacted = false
    for (const key of keys) {
      const isDeclared = known.has(key)
      if (key.length <= MAX_KEY_LENGTH && shouldRecord(record, key, isDeclared)) {
        ;(isDeclared ? declared : undeclared).push(key)
      } else {
        hasRedacted = true
      }
    }
    const visibleKeys = [...declared.sort(), ...undeclared.sort()].slice(0, MAX_INPUT_KEYS)
    if (hasRedacted && visibleKeys.length < MAX_INPUT_KEYS) {
      visibleKeys.push('[redacted]')
    }
    return { [PostHogMCPAnalyticsProperty.InputKeys]: visibleKeys }
  } catch {
    return {}
  }
}
