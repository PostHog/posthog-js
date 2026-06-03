import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ErrorTracking } from '@posthog/core'
import type { PostHog } from 'posthog-node'
import type { MCPAnalyticsEventType } from './extensions/event-types'
import type { IdentityCache } from './extensions/internal'
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

export interface MCPAnalyticsOptions {
  /**
   * A `posthog-node` client. Construct it yourself and pass it in (matching `@posthog/ai`),
   * so you own its configuration and lifecycle — call `posthog.shutdown()` on exit to flush.
   * Without it, the SDK instruments the server but does not send events.
   *
   * @example
   * ```ts
   * import { PostHog } from "posthog-node"
   * const posthog = new PostHog(process.env.POSTHOG_PROJECT_TOKEN, { host: "https://us.i.posthog.com" })
   * instrument(server, { posthog })
   * ```
   */
  posthog?: PostHog
  /**
   * Optional STDIO-safe log sink for SDK-internal warnings. Receives single string messages.
   * Defaults to a no-op since MCP STDIO transports cannot use console.
   */
  logger?: LoggerFn
  /** Enable the `get_more_tools` virtual tool so agents can report missing functionality. */
  reportMissing?: boolean
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
   * Async string redactor applied to every user-controlled string field before capture.
   * Protected fields (session id, server name, etc.) are skipped.
   */
  redactSensitiveInformation?: RedactFunction
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
  inputSchema?: unknown
  update?: (...args: unknown[]) => unknown
} & ({ callback: ToolCallback; handler?: never } | { handler: ToolCallback; callback?: never })

export type RedactFunction = (text: string) => Promise<string>

export interface Event {
  actorId?: string
  clientName?: string
  clientVersion?: string
  conversationId?: string
  duration?: number
  error?: ErrorProperties | null
  eventId?: string
  eventType: MCPAnalyticsEventType
  id: string
  identifyActorData?: JsonRecord
  identifyActorGivenId?: string
  identifyActorName?: string
  identifyData?: JsonRecord
  ipAddress?: string
  isError?: boolean
  listedToolNames?: string[]
  parameters?: unknown
  properties?: JsonRecord | null
  resourceName?: string
  response?: unknown
  sdkLanguage?: string
  sdkVersion?: string
  serverName?: string
  serverVersion?: string
  sessionId: string
  timestamp: Date
  toolDescription?: string
  userIntent?: string
  userIntentSource?: MCPAnalyticsIntentSource
}

export interface UnredactedEvent extends Partial<Event> {
  redactionFn?: RedactFunction
}

export interface CompatibleRequestHandlerExtra {
  headers?: Record<string, string | string[]>
  sessionId?: string
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

export interface MCPServerLike {
  _requestHandlers: Map<string, (request: MCPRequestLike, extra?: CompatibleRequestHandlerExtra) => Promise<unknown>>
  _serverInfo?: ServerClientInfoLike
  getClientVersion(): ServerClientInfoLike | undefined
  setRequestHandler(
    schema: unknown,
    handler: (request: MCPRequestLike, extra?: CompatibleRequestHandlerExtra) => Promise<unknown>
  ): void
}

export interface UserIdentity {
  userData?: JsonRecord
  userId: string
  userName?: string
}

export interface SessionInfo {
  clientName?: string
  clientVersion?: string
  identifyActorData?: JsonRecord
  identifyActorGivenId?: string
  identifyActorName?: string
  ipAddress?: string
  sdkLanguage?: string
  sdkVersion?: string
  serverName?: string
  serverVersion?: string
}

export interface MCPAnalyticsData {
  sink: McpEventSink | undefined
  identifiedSessions: IdentityCache
  lastActivity: Date
  lastMcpSessionId?: string
  options: MCPAnalyticsOptions
  sessionId: string
  sessionInfo: SessionInfo
  sessionSource: 'generated' | 'mcp'
  toolDescriptions: Map<string, string>
}

export interface CustomEventData {
  duration?: number
  error?: unknown
  isError?: boolean
  message?: string
  parameters?: unknown
  properties?: JsonRecord
  resourceName?: string
  response?: unknown
}
