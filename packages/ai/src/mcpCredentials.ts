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

// Deeper values are dropped rather than walked, so nested input cannot overflow the stack.
const MAX_REDACT_DEPTH = 64

/**
 * Replaces the value of every key that `isCredentialKey` accepts (normalized) with `[REDACTED]`, through plain
 * objects, arrays and JSON strings. Class instances, such as the MCP client inside an `mcpToTool()` tool, are
 * returned as they are.
 */
export function redactKeys(value: unknown, isCredentialKey: (normalizedKey: string) => boolean, depth = 0): unknown {
  if (depth > MAX_REDACT_DEPTH) {
    return '[Truncated]'
  }
  if (typeof value === 'string') {
    return redactJsonString(value, isCredentialKey, depth)
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactKeys(item, isCredentialKey, depth + 1))
  }
  if (!isPlainObject(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isCredentialKey(normalizeKey(key)) ? '[REDACTED]' : redactKeys(item, isCredentialKey, depth + 1),
    ])
  )
}

const ESCAPED_WHITESPACE = new Set(['n', 't', 'r'])

const MAX_KEY_DECODE_LEVELS = 16

// Tests a key as written in raw text at every unescaping level, since the text can nest it any number of times
// (`refresh_tok\\u0065n`), and a key with a literal backslash (`C:\\temp\\token`) reads right only before the
// extra level. A key still escaped after the last level counts as a credential.
function keyIsCredential(raw: string, isCredentialKey: (normalizedKey: string) => boolean): boolean {
  let end = raw.length
  while (end > 0 && raw[end - 1] === '\\') {
    end--
  }
  let key = raw.slice(0, end)
  for (let level = 0; ; level++) {
    if (isCredentialKey(normalizeKey(key))) {
      return true
    }
    if (!key.includes('\\')) {
      return false
    }
    if (level === MAX_KEY_DECODE_LEVELS) {
      return true
    }
    try {
      key = JSON.parse(`"${key}"`)
    } catch {
      return false
    }
  }
}

// The index just before an escaped separator (`\\n`, `\\u0020`) that ends at `end`, or `end` when there is none.
function beforeEscapedSeparator(text: string, end: number): number {
  let start = -1
  if (ESCAPED_WHITESPACE.has(text[end]) && text[end - 1] === '\\') {
    start = end - 1
  } else if (text[end - 4] === 'u' && text[end - 5] === '\\') {
    const hex = text.slice(end - 3, end + 1)
    if (/^[0-9a-f]{4}$/i.test(hex) && isSeparator(String.fromCharCode(parseInt(hex, 16)))) {
      start = end - 5
    }
  }
  if (start === -1) {
    return end
  }
  while (start >= 0 && text[start] === '\\') {
    start--
  }
  return start
}

// Any whitespace or control character, including ones JSON rejects, so malformed text cannot hide a key.
const isSeparator = (char: string): boolean => char <= ' ' || char.trim() === ''

// Reads the quoted name before each `:`, at any nesting level (`"key":` or `\\"key\\":`), past separators that may
// themselves be escaped (`\\n`). Every walk back stops at the previous quote, so no character is read twice.
function namesCredentialKey(raw: string, isCredentialKey: (normalizedKey: string) => boolean): boolean {
  // Some serializers write the quotes and colon of embedded JSON as `\\u0022` and `\\u003a`.
  const text = raw.replace(/\\u00(22|3a)/gi, (_escape, hex: string) => (hex === '22' ? '"' : ':'))
  for (let colon = text.indexOf(':'); colon !== -1; colon = text.indexOf(':', colon + 1)) {
    let close = colon - 1
    while (close >= 0) {
      const next = isSeparator(text[close]) ? close - 1 : beforeEscapedSeparator(text, close)
      if (next === close) {
        break
      }
      close = next
    }
    // Single quotes cover Python-style output, such as `str(dict)`.
    const quote = text[close]
    if (close <= 0 || (quote !== '"' && quote !== "'")) {
      continue
    }
    const open = text.lastIndexOf(quote, close - 1)
    if (open === -1) {
      continue
    }
    if (keyIsCredential(text.slice(open + 1, close), isCredentialKey)) {
      return true
    }
  }
  return false
}

// A tool can return a response body as JSON text, which would otherwise pass through as one opaque string.
// JSON text is masked field by field and re-serialized even when nothing changed, since `JSON.parse` keeps only the
// last of duplicate keys and an earlier one can hold a credential. Text that names a credential key but does not
// parse, such as JSON lines, truncated JSON, or JSON inside prose, is replaced whole. Other text is returned as written.
function redactJsonString(value: string, isCredentialKey: (normalizedKey: string) => boolean, depth: number): string {
  const trimmed = value.trim()
  if (/^[[{"]/.test(trimmed)) {
    try {
      return JSON.stringify(redactKeys(JSON.parse(trimmed), isCredentialKey, depth + 1))
    } catch {
      // Not JSON, so only the raw scan applies.
    }
  }
  return namesCredentialKey(value, isCredentialKey) ? '[REDACTED]' : value
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
      normalizeKey(key) === GEMINI_SCHEMA_FIELD
        ? value
        : redactKeys(toJsonSafeValue(value), (key) => GEMINI_CREDENTIAL_KEYS.has(key)),
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
