import type { InputAliasMap, JsonRecord, ShouldRecordInputKeyFn, ToolInputOptions } from '../types'
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

function aliasNames(aliases: InputAliasMap | undefined): string[] {
  if (!isRecord(aliases)) return []
  return Object.values(aliases).flatMap((names) =>
    Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : []
  )
}

/**
 * Each alias the server needed: the canonical name is absent and this is the first of its
 * aliases present, the same order a normalizer that fills the canonical from its aliases uses.
 */
function describeAliasesUsed(aliases: InputAliasMap | undefined, input: Record<string, unknown>): string[] {
  if (!isRecord(aliases)) return []
  const used: string[] = []
  for (const [canonical, names] of Object.entries(aliases)) {
    if (!Array.isArray(names) || Object.prototype.hasOwnProperty.call(input, canonical)) continue
    const alias = names.find((name) => typeof name === 'string' && Object.prototype.hasOwnProperty.call(input, name))
    if (alias && alias.length <= MAX_KEY_LENGTH && canonical.length <= MAX_KEY_LENGTH) {
      used.push(`${alias}:${canonical}`)
    }
  }
  return used.sort().slice(0, MAX_INPUT_KEYS)
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
    const known = new Set([...Object.keys(properties ?? {}), ...aliasNames(options?.inputAliases)])
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
    const aliasesUsed = describeAliasesUsed(options?.inputAliases, input)
    return {
      [PostHogMCPAnalyticsProperty.InputKeys]: visibleKeys,
      ...(aliasesUsed.length > 0 ? { [PostHogMCPAnalyticsProperty.InputAliasesUsed]: aliasesUsed } : {}),
    }
  } catch {
    return {}
  }
}
