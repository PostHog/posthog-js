// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ErrorTracking } from '@posthog/core'
import type { MCPAnalyticsEventType } from './extensions/event-types'
import type { IdentityCache } from './extensions/internal'
import type { PostHogCaptureEvent } from './extensions/posthog-events'
import type { McpEventSink } from './extensions/sink'
import type { LoggerFn } from './extensions/logger'

export type JsonRecord = Record<string, unknown>

/** PostHog error-tracking properties (`$exception_list`). Re-exported from `@posthog/core`. */
export type ErrorProperties = ErrorTracking.ErrorProperties
/** A single parsed stack frame. Re-exported from `@posthog/core`. */
export type StackFrame = ErrorTracking.StackFrame

export interface MCPRequestParamsLike {
  arguments?: JsonRecord
  name?: string
  [key: string]: unknown
}

export interface MCPRequestLike {
  id?: number | string
  jsonrpc?: string
  method?: string
  params?: MCPRequestParamsLike
  [key: string]: unknown
}

/** Handle returned by `instrument()` — the analytics surface for an instrumented server. */
export interface McpAnalytics {
  /**
   * Capture a custom event for this server. The `event` name is required and sent
   * verbatim (a customer event, so it is not `$`-prefixed). Resolves once the event
   * has been processed. Use for domain-specific actions that aren't auto-captured
   * (user feedback, workflow milestones, etc).
   */
  capture(eventData: CaptureEventData): Promise<void>
}

export interface MCPAnalyticsOptions {
  /**
   * Optional STDIO-safe log sink for SDK-internal warnings. Receives single string messages.
   * Defaults to a no-op since MCP STDIO transports cannot use console.
   */
  logger?: LoggerFn
  /** Enable the `get_more_tools` virtual tool so agents can report missing functionality. */
  reportMissing?: boolean
  /**
   * Rename the `get_more_tools` virtual tool (the `reportMissing` feature).
   * Defaults to `get_more_tools`. Set once here so the tool is advertised and
   * detected under the same name.
   */
  missingCapabilityToolName?: string
  /** Enables the `conversation_id` tool parameter + prompt-back loop. */
  enableConversationId?: boolean
  /**
   * Emit a `$exception` event alongside any failed tool call. Defaults to `true`.
   * Set to `false` if you handle error tracking elsewhere and don't want MCP errors
   * fanning out into PostHog error tracking.
   */
  enableExceptionAutocapture?: boolean
  /** Inject a required `context` parameter on every tool to capture user intent. */
  context?: boolean | MCPAnalyticsContextOptions
  /**
   * Identify the calling user. Returning a non-null value sets `distinct_id` and `$set`
   * on subsequent events for the session. Object form is treated as a static identity.
   * A standalone `$identify` event is published once per session — at `initialize`, or
   * when a long-lived server sees the identity appear or change — never per tool call.
   */
  identify?:
    | ((request: MCPRequestLike, extra?: CompatibleRequestHandlerExtra) => Promise<UserIdentity | null>)
    | UserIdentity
    | null
  /**
   * Called when a tool is invoked without an explicit `context` argument. Return a short
   * intent string to record as `$mcp_intent` with `$mcp_intent_source = "inferred"`.
   */
  intentFallback?: (
    request: MCPRequestLike,
    extra?: CompatibleRequestHandlerExtra
  ) => MaybePromise<string | null | undefined>
  /**
   * Inspect, modify, or drop each event right before it is sent to PostHog
   * (matching posthog-node's `beforeSend`). Receives the fully-built capture
   * payload — event name, `distinct_id`, and `properties` — and runs once per
   * emitted event, including the `$exception` sibling of a failed tool call.
   *
   * Return the (possibly mutated) event to send it, or `null`/`undefined` to
   * drop it. Use this to redact sensitive values, add or remove properties, or
   * suppress specific events. A throw drops that event.
   */
  beforeSend?: BeforeSendFn
  /**
   * Attach extra event properties on every auto-captured event. Spread into the PostHog
   * event properties as-is; values must be JSON-serializable.
   */
  eventProperties?: (
    request: MCPRequestLike,
    extra?: CompatibleRequestHandlerExtra
  ) => JsonRecord | null | Promise<JsonRecord | null>
}

export interface MCPAnalyticsContextOptions {
  description?: string
}

export type MaybePromise<T> = T | Promise<T>
export type MCPAnalyticsIntentSource = 'context_parameter' | 'inferred'

export type ToolCallback =
  | ((args: unknown, extra: CompatibleRequestHandlerExtra) => CallToolResult | Promise<CallToolResult>)
  | ((extra: CompatibleRequestHandlerExtra) => CallToolResult | Promise<CallToolResult>)

// RegisteredTool type that supports both MCP SDK 1.23- (callback) and 1.24+ (handler)
export type RegisteredTool = {
  description?: string
  /** MCP tool `_meta` block (spec-allowed arbitrary metadata, e.g. `category`). */
  _meta?: Record<string, unknown>
  inputSchema?: unknown
  update?: (...args: unknown[]) => unknown
} & ({ callback: ToolCallback; handler?: never } | { handler: ToolCallback; callback?: never })

/**
 * Hook invoked for every event just before it is handed to `posthog.capture()`.
 * Return the event (optionally mutated) to send it, or a nullish value to drop it.
 */
export type BeforeSendFn = (event: PostHogCaptureEvent) => MaybePromise<PostHogCaptureEvent | null | undefined>

export interface Event {
  actorId?: string
  clientName?: string
  clientVersion?: string
  conversationId?: string
  duration?: number
  error?: ErrorProperties | null
  /**
   * Coarse failure category → `$mcp_error_type`. An explicit, low-cardinality
   * label the host can supply (e.g. `validation`, `permission`, `timeout`).
   * When omitted on an errored call, it falls back to the thrown error's type
   * (the `$exception_list` entry's `type`).
   */
  errorType?: string
  eventId?: string
  eventType: MCPAnalyticsEventType
  groups?: Record<string, string>
  /**
   * Explicit PostHog event name. When set (via `capture(server, { event })`) it
   * overrides the built-in name derived from `eventType`, so callers can emit any
   * event name. User-supplied names are sent verbatim (not `$`-prefixed).
   */
  eventName?: string
  id: string
  /** Resolved person properties for the session, written to `$set`. */
  identifyActorData?: JsonRecord
  /** Resolved distinct id for the session (from `identify().distinctId`). */
  identifyActorGivenId?: string
  ipAddress?: string
  isError?: boolean
  listedToolNames?: string[]
  parameters?: unknown
  properties?: JsonRecord | null
  /**
   * Negotiated MCP protocol (spec) version → `$mcp_protocol_version`. Learned at
   * `initialize` and carried onto every event for the session (see SessionInfo) —
   * used to track spec adoption and to slice event metrics by spec version.
   */
  protocolVersion?: string
  resourceName?: string
  response?: unknown
  sdkLanguage?: string
  sdkVersion?: string
  serverName?: string
  serverVersion?: string
  sessionId: string
  timestamp: Date
  toolCategory?: string
  toolDescription?: string
  userIntent?: string
  userIntentSource?: MCPAnalyticsIntentSource
}

/** A partially-built MCP event as it flows through the SDK before capture. */
export type McpEvent = Partial<Event>

/** HTTP request info the SDK's Streamable HTTP transports attach per request. */
export interface CompatibleRequestInfoLike {
  headers?: Record<string, string | string[] | undefined>
  [key: string]: unknown
}

export interface CompatibleRequestHandlerExtra {
  headers?: Record<string, string | string[]>
  sessionId?: string
  /** Present on HTTP transports only — headers ride every request, unlike `clientInfo`. */
  requestInfo?: CompatibleRequestInfoLike
  [key: string]: unknown
}

export interface ServerClientInfoLike {
  name?: string
  version?: string
}

export interface HighLevelMCPServerLike {
  _registeredTools: { [name: string]: RegisteredTool }
  registerTool?(name: string, config: { description?: string; inputSchema?: unknown }, handler: ToolCallback): void
  server: MCPServerLike
  tool?(name: string, cb: ToolCallback): void
  tool?(name: string, paramsSchema: unknown, cb: ToolCallback): void
  tool?(name: string, description: string, paramsSchema: unknown, cb: ToolCallback): void
}

/** The connected transport as exposed by the SDK's `Protocol.transport` getter. */
export interface CompatibleTransportLike {
  sessionId?: string
  [key: string]: unknown
}

export interface MCPServerLike {
  _requestHandlers: Map<string, (request: MCPRequestLike, extra?: CompatibleRequestHandlerExtra) => Promise<unknown>>
  _serverInfo?: ServerClientInfoLike
  /** Optional so older SDKs (and bare test doubles) still validate. */
  transport?: CompatibleTransportLike
  getClientVersion(): ServerClientInfoLike | undefined
  setRequestHandler(
    schema: unknown,
    handler: (request: MCPRequestLike, extra?: CompatibleRequestHandlerExtra) => Promise<unknown>
  ): void
}

export interface UserIdentity {
  /**
   * The person's distinct id (becomes `distinct_id`). Same concept as
   * posthog-node's `identify({ distinctId })`.
   */
  distinctId: string
  /**
   * Person properties, written to `$set` (e.g. `{ name, email, plan }`) — the
   * same `properties` you'd pass to posthog-node's `identify`.
   */
  properties?: JsonRecord
  /**
   * PostHog group memberships as `{ groupType: groupKey }`. Stamped onto every
   * event for the session as `$groups`, so callers never hand-write the
   * `$groups` dollar-key themselves.
   */
  groups?: Record<string, string>
}

export interface SessionInfo {
  clientName?: string
  clientVersion?: string
  identifyActorData?: JsonRecord
  identifyActorGivenId?: string
  identifyActorGroups?: Record<string, string>
  ipAddress?: string
  /**
   * Negotiated MCP protocol (spec) version, learned at `initialize` and carried
   * forward for the session (across pods via the session token) → `$mcp_protocol_version`.
   */
  protocolVersion?: string
  sdkLanguage?: string
  sdkVersion?: string
  serverName?: string
  serverVersion?: string
}

export interface MCPAnalyticsData {
  sink: McpEventSink | undefined
  identifiedSessions: IdentityCache
  lastActivity: Date
  options: MCPAnalyticsOptions
  sessionId: string
  sessionInfo: SessionInfo
  /** `token` = recovered from a self-encoded `Mcp-Session-Id` token (see session-token.ts). */
  sessionSource: 'generated' | 'mcp' | 'token'
  toolCategories: Map<string, string>
  toolDescriptions: Map<string, string>
}

export interface CaptureEventData {
  /**
   * PostHog event name (required). Sent verbatim — a custom event is a
   * customer-defined event, so it is NOT `$`-prefixed.
   */
  event: string
  /** Event properties, spread onto the PostHog event. Values must be JSON-serializable. */
  properties?: JsonRecord
}

/**
 * Identity + routing fields shared by every {@link PostHogMCP} capture call. The
 * caller resolves these per request (there is no wrapped server to derive them
 * from), so they are passed explicitly on each event.
 */
export interface McpCaptureCommon {
  /**
   * Resolved person distinct id (becomes `distinct_id`). Supplying it enables
   * person processing so `$set` lands on a real person; omitting it falls back
   * to an anonymous capture with `$process_person_profile: false`.
   */
  distinctId?: string
  /** Session id → `$session_id`. Omitted from the event entirely when not provided. */
  sessionId?: string
  /**
   * Negotiated MCP protocol (spec) version → `$mcp_protocol_version`. Pass it on
   * every capture for the session (like `sessionId`) so later events carry it too,
   * not just the initialize event — the `PostHogMCP` client holds no per-session state.
   */
  protocolVersion?: string
  /** Person properties → `$set` (e.g. `{ name, email, plan }`). */
  setProperties?: JsonRecord
  /** Group memberships → `$groups`. */
  groups?: Record<string, string>
  /** Extra event properties, spread onto the PostHog event verbatim. */
  properties?: JsonRecord
  /** Event timestamp. Defaults to the time of the capture call. */
  timestamp?: Date
}

/** Payload for {@link PostHogMCP.captureToolCall}. Emits `$mcp_tool_call`. */
export interface ToolCallCaptureData extends McpCaptureCommon {
  /** Tool name → `$mcp_tool_name` / `$mcp_resource_name`. */
  toolName: string
  /** Tool description → `$mcp_tool_description`. */
  toolDescription?: string
  /** Product category the tool belongs to (e.g. "Logs") → `$mcp_tool_category`. */
  category?: string
  /**
   * The agent's stated intent for this call → `$mcp_intent`. On the custom
   * dispatcher path, read it off the incoming call with
   * {@link PostHogMCP.prepareToolCall} (which pulls the injected `context`
   * argument). Omitted when no intent was captured.
   */
  intent?: string
  /**
   * Where {@link ToolCallCaptureData.intent} came from → `$mcp_intent_source`.
   * `context_parameter` when the client supplied it on the call, `inferred` when
   * the host derived it. Defaults to `context_parameter` when an intent is set.
   */
  intentSource?: MCPAnalyticsIntentSource
  /** Captured call arguments → `$mcp_parameters` (sanitized + truncated). */
  parameters?: unknown
  /** Captured tool result → `$mcp_response` (sanitized + truncated). */
  response?: unknown
  /** Wall-clock duration → `$mcp_duration_ms`. */
  durationMs?: number
  /** Whether the call failed → `$mcp_is_error`. */
  isError?: boolean
  /**
   * The thrown value (Error, string, object, or CallToolResult). When `isError`
   * is true and `enableExceptionAutocapture` is on, this is turned into the
   * `$exception` sibling event. If omitted on an error, a generic exception is
   * synthesized from the tool name.
   */
  error?: unknown
  /**
   * Coarse failure category → `$mcp_error_type` (e.g. `validation`,
   * `permission`, `timeout`, `rate_limited`). A low-cardinality label that lets
   * the dashboard break failures down by reason without joining to `$exception`.
   * When omitted on an error, the SDK falls back to the thrown error's type.
   */
  errorType?: string
}

/** Payload for {@link PostHogMCP.captureInitialize}. Emits `$mcp_initialize`. */
export interface InitializeCaptureData extends McpCaptureCommon {
  /** MCP client name → `$mcp_client_name`. */
  clientName?: string
  /** MCP client version → `$mcp_client_version`. */
  clientVersion?: string
  /** Captured initialize params → `$mcp_parameters`. */
  parameters?: unknown
  /** Captured initialize result → `$mcp_response`. */
  response?: unknown
  /** Wall-clock duration → `$mcp_duration_ms`. */
  durationMs?: number
}

/** Payload for {@link PostHogMCP.captureToolsList}. Emits `$mcp_tools_list`. */
export interface ToolsListCaptureData extends McpCaptureCommon {
  /**
   * Names of the tools advertised in this `tools/list` response →
   * `$mcp_listed_tool_names`. Powers "advertised but never called" analysis.
   */
  toolNames?: string[]
  /** Captured request params → `$mcp_parameters` (sanitized + truncated). */
  parameters?: unknown
  /** Captured listing result → `$mcp_response` (sanitized + truncated). */
  response?: unknown
  /** Wall-clock duration → `$mcp_duration_ms`. */
  durationMs?: number
  /** Whether building the listing failed → `$mcp_is_error`. */
  isError?: boolean
  /** The thrown value when `isError` is true → fans out an `$exception` sibling. */
  error?: unknown
  /** Coarse failure category → `$mcp_error_type`. Falls back to the thrown error's type. */
  errorType?: string
}

/** Options for {@link PostHogMCP.prepareToolList}. */
export interface PrepareToolListOptions {
  /**
   * Inject the `context` argument into every tool so agents state their intent
   * (captured as `$mcp_intent`). `true` (default) uses the standard prompt;
   * pass `{ description }` to customize it, or `false` to skip injection.
   */
  context?: boolean | MCPAnalyticsContextOptions
  /**
   * Append the `get_more_tools` virtual tool so agents can report a missing
   * capability. Defaults to `false`. When the agent calls it, route the call to
   * {@link PostHogMCP.captureMissingCapability} and reply with `getMoreToolsResult()`.
   */
  reportMissing?: boolean
}

/**
 * Result of {@link PostHogMCP.prepareToolCall}: the intent pulled off the
 * incoming call, the arguments with the injected `context` removed (so your tool
 * handler and its schema validation never see it), and whether the call targeted
 * the `get_more_tools` virtual tool.
 */
export interface PreparedToolCall {
  /** The agent's stated intent (the `context` argument), if present. */
  intent?: string
  /** Where the intent came from. Always `context_parameter` here when set. */
  intentSource?: MCPAnalyticsIntentSource
  /** The call arguments with the injected `context` key stripped out. */
  args?: Record<string, unknown>
  /** True when `name` is the `get_more_tools` virtual tool. */
  isMissingCapability: boolean
}

/** Payload for {@link PostHogMCP.captureMissingCapability}. Emits `$mcp_missing_capability`. */
export interface MissingCapabilityCaptureData extends McpCaptureCommon {
  /**
   * The agent's description of the capability it wanted (the `context` argument
   * on the `get_more_tools` call) → `$mcp_intent`.
   */
  context?: string
  /** Captured call arguments → `$mcp_parameters` (sanitized + truncated). */
  parameters?: unknown
}
