import type { AttributeValue } from '@opentelemetry/api'

import { redactMcpToolCredentials, redactMcpToolDefinition } from '../mcpCredentials'

// Instrumentations serialize tool definitions, remote MCP tools and their credentials included,
// as a JSON array, an array of JSON tools, or one JSON tool per attribute.
const TOOL_DEFINITION_ATTRIBUTES = new Set(['gen_ai.tool.definitions', 'ai.prompt.tools'])
const TOOL_DEFINITION_PATTERN = /^llm\.tools\.\d+\.tool\.json_schema$/

export const isToolDefinitionAttribute = (key: string): boolean =>
  TOOL_DEFINITION_ATTRIBUTES.has(key) || TOOL_DEFINITION_PATTERN.test(key)

const parseToolDefinitionJson = (value: string): object | undefined => {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

const redactJson = (value: string): string => {
  const parsed = parseToolDefinitionJson(value)
  if (parsed === undefined) {
    return value
  }
  const redacted = JSON.stringify(
    Array.isArray(parsed) ? redactMcpToolCredentials(parsed) : redactMcpToolDefinition(parsed)
  )
  return redacted === JSON.stringify(parsed) ? value : redacted
}

/** Replaces MCP credentials in a tool definition attribute; values that are not JSON are kept as is. */
export function redactToolDefinitionCredentials(value: AttributeValue): AttributeValue {
  if (typeof value === 'string') {
    return redactJson(value)
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string' || item == null)) {
    const redacted = value.map((item) => (typeof item === 'string' ? redactJson(item) : item))
    return redacted.some((item, index) => item !== value[index]) ? redacted : value
  }
  return value
}

/** Drops the parts of a tool definition attribute that are not JSON, since their credentials cannot be found. */
export function withoutUnparseableToolDefinitions(value: AttributeValue): AttributeValue | undefined {
  if (typeof value === 'string') {
    return parseToolDefinitionJson(value) === undefined ? undefined : value
  }
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && parseToolDefinitionJson(item) !== undefined)
  }
  return undefined
}
