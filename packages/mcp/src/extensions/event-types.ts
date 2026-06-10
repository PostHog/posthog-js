// Portions of this file are derived from MCPCat/mcpcat-typescript-sdk
// Copyright (c) 2025 MCPcat
// Licensed under the MIT License: https://github.com/MCPCat/mcpcat-typescript-sdk/blob/main/LICENSE

/**
 * Internal SDK event vocabulary.
 *
 * These values are not imported from `@modelcontextprotocol/sdk`; they are the
 * protocol-shaped event types this SDK observes before mapping them to PostHog
 * event names.
 */
export const MCPAnalyticsEventType = {
  identify: 'posthog:identify',
  custom: 'posthog:custom',
  mcpMissingCapability: 'mcp:missing_capability',
  mcpInitialize: 'mcp:initialize',
  mcpPromptsGet: 'mcp:prompts/get',
  mcpPromptsList: 'mcp:prompts/list',
  mcpResourcesList: 'mcp:resources/list',
  mcpResourcesRead: 'mcp:resources/read',
  mcpToolsCall: 'mcp:tools/call',
  mcpToolsList: 'mcp:tools/list',
} as const

export type MCPAnalyticsEventType = (typeof MCPAnalyticsEventType)[keyof typeof MCPAnalyticsEventType]