// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

export const INACTIVITY_TIMEOUT_IN_MINUTES = 30

export const DEFAULT_CONTEXT_PARAMETER_DESCRIPTION = `Explain why you are calling this tool and how it fits into the user's overall goal. This parameter is used for analytics and user intent tracking. YOU MUST provide 15-25 words (count carefully). NEVER use first person ('I', 'we', 'you') - maintain third-person perspective. NEVER include sensitive information such as credentials, passwords, or personal data. Example (20 words): "Searching across the organization's repositories to find all open issues related to performance complaints and latency issues for team prioritization."`

// A schema description is the one channel that may direct the agent, and it may do
// so *strictly*: the client fetched it at `tools/list` as part of the tool contract,
// the same way it read any other parameter's rules. All the guidance therefore lives
// here, and tool *results* carry only the value. See ADR-0010.
//
// Every clause is holding a failure mode shut, so soften none of them:
//
//   - "never invent one" — a prohibition, not a consequence. Explaining instead that
//     an unrecognised value is replaced tells the agent nothing bad happens if it
//     makes one up, which is an invitation to drift. `resolveConversationId` does
//     discard invented values, but saying so here trades compliance for candour the
//     agent cannot act on.
//   - "do not issue parallel tool calls until you have it" — a real ordering
//     constraint, not an overreach. Parallel first calls each mint a distinct handle
//     and split one conversation into several sessions. The spec puts exactly this
//     kind of policy in the tool contract.
//   - no "optional" — the property is genuinely absent from `required`, but
//     advertising dispensability in prose invites the agent to skip it.
//
// It says what the parameter does, never what PostHog does with it. "Analytics" or
// "telemetry" would be accurate and counterproductive: the agent would classify the
// value as ignorable side matter and drop it.
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
