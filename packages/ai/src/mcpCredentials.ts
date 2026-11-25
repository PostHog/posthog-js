import { isObject } from './typeGuards'

const MCP_CREDENTIAL_FIELDS = ['headers', 'authorization']

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
const normalizeKey = (key: string): string => key.toLowerCase().replace(/[-_]/g, '')

// The fields of a `@google/genai` `Tool`. A Gemini tool has no `type`, so an object whose keys all
// come from this set is treated as one. Add new fields here when the SDK adds a tool.
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

const isGeminiTool = (tool: Record<string, unknown>): boolean => {
  const keys = Object.keys(tool).map(normalizeKey)
  return keys.every((key) => GEMINI_TOOL_FIELDS.has(key)) && keys.some((key) => key !== GEMINI_SCHEMA_FIELD)
}

const withoutGeminiCredentials = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(withoutGeminiCredentials)
  }
  if (!isObject(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      GEMINI_CREDENTIAL_KEYS.has(normalizeKey(key)) && item != null ? '[REDACTED]' : withoutGeminiCredentials(item),
    ])
  )
}

/** Hides the credentials of a remote MCP or Gemini tool definition; everything else is kept as sent. */
export function redactMcpToolDefinition(tool: unknown): unknown {
  if (!isObject(tool)) {
    return tool
  }
  if (tool.type === 'mcp') {
    return withoutMcpCredentials(tool)
  }
  if (isMcpProviderTool(tool) && isObject(tool.args)) {
    return { ...tool, args: withoutMcpCredentials(tool.args) }
  }
  if (isGeminiTool(tool)) {
    return Object.fromEntries(
      Object.entries(tool).map(([key, value]) => [
        key,
        normalizeKey(key) === GEMINI_SCHEMA_FIELD ? value : withoutGeminiCredentials(value),
      ])
    )
  }
  return tool
}

export function redactMcpToolCredentials(tools: unknown): unknown {
  return Array.isArray(tools) ? tools.map(redactMcpToolDefinition) : tools
}
