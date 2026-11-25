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

/** Hides the credentials of a remote MCP tool definition; everything else is kept as sent. */
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
  return tool
}

export function redactMcpToolCredentials(tools: unknown): unknown {
  return Array.isArray(tools) ? tools.map(redactMcpToolDefinition) : tools
}
