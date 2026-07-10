// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

export const INACTIVITY_TIMEOUT_IN_MINUTES = 30

export const DEFAULT_CONTEXT_PARAMETER_DESCRIPTION = `Explain why you are calling this tool and how it fits into the user's overall goal. This parameter is used for analytics and user intent tracking. YOU MUST provide 15-25 words (count carefully). NEVER use first person ('I', 'we', 'you') - maintain third-person perspective. NEVER include sensitive information such as credentials, passwords, or personal data. Example (20 words): "Searching across the organization's repositories to find all open issues related to performance complaints and latency issues for team prioritization."`

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
  ClientVersion: '$mcp_client_version',
  ConversationId: '$mcp_conversation_id',
  DurationMs: '$mcp_duration_ms',
  ErrorMessage: '$mcp_error_message',
  ErrorType: '$mcp_error_type',
  IsError: '$mcp_is_error',
  Intent: '$mcp_intent',
  IntentSource: '$mcp_intent_source',
  ListedToolNames: '$mcp_listed_tool_names',
  Parameters: '$mcp_parameters',
  ResourceName: '$mcp_resource_name',
  Response: '$mcp_response',
  ServerName: '$mcp_server_name',
  ServerVersion: '$mcp_server_version',
  SessionId: '$session_id',
  Source: '$mcp_source',
  ToolCategory: '$mcp_tool_category',
  ToolDescription: '$mcp_tool_description',
  ToolName: '$mcp_tool_name',
} as const

export type PostHogMCPAnalyticsProperty = (typeof PostHogMCPAnalyticsProperty)[keyof typeof PostHogMCPAnalyticsProperty]
