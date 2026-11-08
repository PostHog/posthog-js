// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

export const INACTIVITY_TIMEOUT_IN_MINUTES = 30

export const DEFAULT_CONTEXT_PARAMETER_DESCRIPTION = `A few words on why you are calling this tool, for the server developer's analytics. Describe people and things by role, such as "a customer". Do not quote the user or include names, emails, or other personal details.`

export const DEFAULT_MODEL_PARAMETER_DESCRIPTION = `The model identifier you are running as, for example "claude-opus-4-8" or "gpt-5.2". Pass "unknown" if you are not certain. Recorded for the server developer's analytics.`

export const DEFAULT_CONVERSATION_ID_DESCRIPTION =
  "The conversation_id this server returned earlier in this conversation, unchanged, including after later user messages. Omit it if you have none. Recorded for the server developer's analytics."

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
  Feedback: '$mcp_feedback',
  /** @deprecated The SDK no longer publishes `$identify`. */
  Identify: '$identify',
  Initialize: '$mcp_initialize',
  MissingCapability: '$mcp_missing_capability',
  PromptGet: '$mcp_prompt_get',
  PromptsList: '$mcp_prompts_list',
  ResourceRead: '$mcp_resource_read',
  ResourcesList: '$mcp_resources_list',
  ToolCall: '$mcp_tool_call',
  ToolsList: '$mcp_tools_list',
  UnknownTool: '$mcp_unknown_tool',
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
  FeedbackDetails: '$mcp_feedback_details',
  FeedbackFrictionPoints: '$mcp_feedback_friction_points',
  FeedbackSentiment: '$mcp_feedback_sentiment',
  FeedbackSuggestedImprovement: '$mcp_feedback_suggested_improvement',
  FeedbackSummary: '$mcp_feedback_summary',
  FeedbackTaskCompleted: '$mcp_feedback_task_completed',
  FeedbackTool: '$mcp_feedback_tool',
  FeedbackType: '$mcp_feedback_type',
  Interface: '$mcp_interface',
  IsError: '$mcp_is_error',
  InputAliasesUsed: '$mcp_input_aliases_used',
  InputKeys: '$mcp_input_keys',
  Intent: '$mcp_intent',
  IntentSource: '$mcp_intent_source',
  ListedToolNames: '$mcp_listed_tool_names',
  LlmModel: '$mcp_llm_model',
  LlmModelSource: '$mcp_llm_model_source',
  Parameters: '$mcp_parameters',
  ProtocolVersion: '$mcp_protocol_version',
  ResourceName: '$mcp_resource_name',
  Response: '$mcp_response',
  ServerBuild: '$mcp_server_build',
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
