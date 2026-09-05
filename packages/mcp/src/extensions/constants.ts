// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

export const INACTIVITY_TIMEOUT_IN_MINUTES = 30

export const DEFAULT_CONTEXT_PARAMETER_DESCRIPTION = `Explain in 15-25 words, in third person, why this tool is called and how it supports the user's goal. For analytics only. You MUST describe only the abstract purpose of the tool call. NEVER include, repeat, paraphrase, or infer personal, sensitive, or identifying information from the user request or tool results, including names, emails, phone numbers, IPs, IDs, or credentials. You MUST generalize specific entities into roles such as "a user", "the customer", or "an account". Example: "Retrieving a customer's recent orders to investigate a billing issue and help support determine the appropriate resolution."`

export const DEFAULT_MODEL_PARAMETER_DESCRIPTION = `The exact model identifier you (the assistant) are running as, taken from your system prompt or environment (e.g. "claude-opus-4-8", "gpt-5.2"). Used for analytics only. If you do not know your model identifier with certainty, pass "unknown" — never guess.`

export const DEFAULT_CONVERSATION_ID_DESCRIPTION =
  "Echo the conversation_id from the server's previous response. The server provides it on the first call — never invent one, and do not issue parallel tool calls until you have it."

export const POSTHOG_MCP_ANALYTICS_SOURCE = 'posthog_mcp_analytics'

// The `$lib` identity stamped on every event @posthog/mcp sends. posthog-node
// would otherwise report itself (`posthog-node`, the transport SDK); we override
// `getLibraryId()` so MCP events self-identify the same way every other PostHog
// SDK does. See `applyMcpLibIdentity` in `./lib-identity`.
export const POSTHOG_MCP_LIB_NAME = 'posthog-node-mcp'

// All PostHog-owned event names start with `$` per the PostHog convention.
// Non-`$` names would be treated as customer-defined events and confuse the schema.
export const PostHogMCPAnalyticsEvent = {
  Custom: '$mcp_custom',
  Exception: '$exception',
  Identify: '$identify',
  Initialize: '$mcp_initialize',
  MissingCapability: '$mcp_missing_capability',
  PromptGet: '$mcp_prompt_get',
  PromptsList: '$mcp_prompts_list',
  ResourceRead: '$mcp_resource_read',
  ResourcesList: '$mcp_resources_list',
  ToolCall: '$mcp_tool_call',
  ToolsList: '$mcp_tools_list',
} as const

export type PostHogMCPAnalyticsEvent = (typeof PostHogMCPAnalyticsEvent)[keyof typeof PostHogMCPAnalyticsEvent]

export const PostHogMCPAnalyticsProperty = {
  ClientName: '$mcp_client_name',
  ClientUserAgent: '$mcp_client_user_agent',
  ClientVersion: '$mcp_client_version',
  ConversationId: '$mcp_conversation_id',
  DurationMs: '$mcp_duration_ms',
  ErrorMessage: '$mcp_error_message',
  ErrorType: '$mcp_error_type',
  IsError: '$mcp_is_error',
  Intent: '$mcp_intent',
  IntentSource: '$mcp_intent_source',
  ListedToolNames: '$mcp_listed_tool_names',
  LlmModel: '$mcp_llm_model',
  LlmModelSource: '$mcp_llm_model_source',
  Parameters: '$mcp_parameters',
  ProtocolVersion: '$mcp_protocol_version',
  ResourceName: '$mcp_resource_name',
  Response: '$mcp_response',
  ServerName: '$mcp_server_name',
  ServerVersion: '$mcp_server_version',
  SessionId: '$session_id',
  Source: '$mcp_source',
  ToolCategory: '$mcp_tool_category',
  ToolDescription: '$mcp_tool_description',
  ToolName: '$mcp_tool_name',
  VendorClient: '$mcp_vendor_client',
} as const

export type PostHogMCPAnalyticsProperty = (typeof PostHogMCPAnalyticsProperty)[keyof typeof PostHogMCPAnalyticsProperty]
