import { toJsonSafeValue } from '@posthog/core'
import { isObject } from './typeGuards'

const MCP_CREDENTIAL_FIELDS = ['headers', 'authorization']

// Remote MCP tool types across providers (`mcp` for OpenAI/xAI, `mcp_server` for Google Interactions).
const MCP_TOOL_TYPES = new Set(['mcp', 'mcp_server'])

// Vercel AI SDK provider tools that configure a remote MCP server, keyed by their `id`.
const MCP_PROVIDER_TOOL_IDS = new Set(['openai.mcp', 'xai.mcp', 'google.mcp_server'])

const isMcpProviderTool = (tool: Record<string, unknown>): boolean =>
  (tool.type === 'provider' || tool.type === 'provider-defined') &&
  typeof tool.id === 'string' &&
  MCP_PROVIDER_TOOL_IDS.has(tool.id)

const withoutMcpCredentials = (config: Record<string, unknown>): Record<string, unknown> => {
  const redacted: Record<string, unknown> = { ...config }
  for (const field of MCP_CREDENTIAL_FIELDS) {
    if (field in redacted) {
      redacted[field] = '[REDACTED]'
    }
  }
  return redacted
}

// Keys are compared in lower case without `-` and `_`, so camelCase and snake_case configs both match.
export const normalizeKey = (key: string): string => key.toLowerCase().replace(/[-_]/g, '')

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!isObject(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Replaces the value of every key in `keys` (normalized) with `[REDACTED]`, through plain objects and arrays.
 * Class instances, such as the MCP client inside an `mcpToTool()` tool, are returned as they are.
 */
export function redactKeys(value: unknown, keys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactKeys(item, keys))
  }
  if (!isPlainObject(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      keys.has(normalizeKey(key)) ? '[REDACTED]' : redactKeys(item, keys),
    ])
  )
}

// The fields of a `@google/genai` `Tool`. A Gemini tool has no `type`, so an object with any of these
// fields is treated as one. The Gemini wrapper masks every tool without this check, so a field the SDK
// adds later is only missed on the LangChain and OTel paths.
const GEMINI_TOOL_FIELDS = new Set(
  [
    'codeExecution',
    'computerUse',
    'enterpriseWebSearch',
    'exaAiSearch',
    'fileSearch',
    'functionDeclarations',
    'googleMaps',
    'googleSearch',
    'googleSearchRetrieval',
    'mcpServers',
    'parallelAiSearch',
    'retrieval',
    'urlContext',
  ].map(normalizeKey)
)
// Function declarations hold the caller's own parameter schemas, which can name a parameter `apiKey`.
const GEMINI_SCHEMA_FIELD = normalizeKey('functionDeclarations')
const GEMINI_CREDENTIAL_KEYS = new Set(['apiAuth', 'authConfig', 'apiKey', 'headers'].map(normalizeKey))

const isGeminiTool = (tool: Record<string, unknown>): boolean =>
  Object.keys(tool)
    .map(normalizeKey)
    .some((key) => key !== GEMINI_SCHEMA_FIELD && GEMINI_TOOL_FIELDS.has(key))

/**
 * Masks the credential keys under every field of a `@google/genai` tool except its function declarations.
 * A class-based tool, such as `mcpToTool(client)`, holds a live client with its auth headers, so only a stub is kept.
 */
export function redactGeminiToolDefinition(tool: unknown): unknown {
  if (!isPlainObject(tool)) {
    return isObject(tool) ? { type: 'callable_tool' } : tool
  }
  return Object.fromEntries(
    Object.entries(tool).map(([key, value]) => [
      key,
      // Converted to plain JSON first, so class instances, `toJSON()` results and cycles are masked too.
      normalizeKey(key) === GEMINI_SCHEMA_FIELD ? value : redactKeys(toJsonSafeValue(value), GEMINI_CREDENTIAL_KEYS),
    ])
  )
}

/** Hides the credentials of a remote MCP or Gemini tool definition; everything else is kept as sent. */
export function redactMcpToolDefinition(tool: unknown): unknown {
  if (!isObject(tool)) {
    return tool
  }
  if (typeof tool.type === 'string' && MCP_TOOL_TYPES.has(tool.type)) {
    return withoutMcpCredentials(tool)
  }
  if (isMcpProviderTool(tool) && isObject(tool.args)) {
    return { ...tool, args: withoutMcpCredentials(tool.args) }
  }
  if (isPlainObject(tool) && isGeminiTool(tool)) {
    return redactGeminiToolDefinition(tool)
  }
  return tool
}

export function redactMcpToolCredentials(tools: unknown): unknown {
  return Array.isArray(tools) ? tools.map(redactMcpToolDefinition) : tools
}
