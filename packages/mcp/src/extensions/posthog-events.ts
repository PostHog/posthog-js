import type { Event } from '../types'
import { POSTHOG_MCP_ANALYTICS_SOURCE, PostHogMCPAnalyticsEvent, PostHogMCPAnalyticsProperty } from './constants'
import { MCPAnalyticsEventType } from './event-types'

const BUILT_IN_EVENT_NAME_BY_TYPE = {
  [MCPAnalyticsEventType.custom]: PostHogMCPAnalyticsEvent.Custom,
  [MCPAnalyticsEventType.identify]: PostHogMCPAnalyticsEvent.Identify,
  [MCPAnalyticsEventType.mcpInitialize]: PostHogMCPAnalyticsEvent.Initialize,
  [MCPAnalyticsEventType.mcpPromptsGet]: PostHogMCPAnalyticsEvent.PromptGet,
  [MCPAnalyticsEventType.mcpPromptsList]: PostHogMCPAnalyticsEvent.PromptsList,
  [MCPAnalyticsEventType.mcpResourcesList]: PostHogMCPAnalyticsEvent.ResourcesList,
  [MCPAnalyticsEventType.mcpResourcesRead]: PostHogMCPAnalyticsEvent.ResourceRead,
  [MCPAnalyticsEventType.mcpToolsCall]: PostHogMCPAnalyticsEvent.ToolCall,
  [MCPAnalyticsEventType.mcpToolsList]: PostHogMCPAnalyticsEvent.ToolsList,
} satisfies Record<MCPAnalyticsEventType, PostHogMCPAnalyticsEvent>

function getDistinctId(event: Event): string {
  return event.identifyActorGivenId || event.sessionId || 'anonymous'
}

function getTimestamp(event: Event): string {
  return event.timestamp ? event.timestamp.toISOString() : new Date().toISOString()
}

export interface PostHogCaptureEvent {
  distinct_id: string
  event: string
  properties: Record<string, unknown>
  timestamp: string
  type: 'capture'
}

export interface BuildPostHogCaptureEventsOptions {
  enableAITracing?: boolean
  /** Whether to emit a `$exception` sibling alongside errored events. Defaults to `true`. */
  enableExceptionAutocapture?: boolean
}

export function buildPostHogCaptureEvents(
  event: Event,
  options: BuildPostHogCaptureEventsOptions = {}
): PostHogCaptureEvent[] {
  const batch = [buildCaptureEvent(event, options)]

  if (event.isError && event.error && options.enableExceptionAutocapture !== false) {
    batch.push(buildExceptionEvent(event))
  }

  if (shouldBuildAISpan(event, options)) {
    batch.push(buildAISpanEvent(event))
  }

  return batch
}

function buildCaptureEvent(event: Event, options: BuildPostHogCaptureEventsOptions): PostHogCaptureEvent {
  const distinctId = getDistinctId(event)
  const timestamp = getTimestamp(event)

  const properties: Record<string, unknown> = {
    [PostHogMCPAnalyticsProperty.SessionId]: event.sessionId,
    [PostHogMCPAnalyticsProperty.Source]: POSTHOG_MCP_ANALYTICS_SOURCE,
  }
  addConversationIdProperty(event, properties)
  addPersonProcessingProperty(event, properties)

  addCommonEventProperties(event, properties)
  addTraceReferenceProperties(event, properties, options)
  addCustomEventProperties(event, properties)

  return {
    event: BUILT_IN_EVENT_NAME_BY_TYPE[event.eventType],
    distinct_id: distinctId,
    properties,
    timestamp,
    type: 'capture',
  }
}

function shouldBuildAISpan(event: Event, options: BuildPostHogCaptureEventsOptions): boolean {
  return options.enableAITracing === true && event.eventType === MCPAnalyticsEventType.mcpToolsCall
}

function getAITraceId(event: Event): string {
  return event.sessionId
}

function getAISpanId(event: Event): string {
  return event.id
}

function addTraceReferenceProperties(
  event: Event,
  properties: Record<string, unknown>,
  options: BuildPostHogCaptureEventsOptions
): void {
  if (!shouldBuildAISpan(event, options)) {
    return
  }

  properties[PostHogMCPAnalyticsProperty.AiTraceId] = getAITraceId(event)
  properties[PostHogMCPAnalyticsProperty.AiSpanId] = getAISpanId(event)
}

function addConversationIdProperty(event: Event, properties: Record<string, unknown>): void {
  if (event.conversationId !== undefined && event.conversationId !== '') {
    properties[PostHogMCPAnalyticsProperty.ConversationId] = event.conversationId
  }
}

/**
 * Without a resolved identity the distinct id is just the session id, so
 * processing a person profile would mint one anonymous person per session and
 * inflate person counts. Opt out of person processing in that case (matching
 * `@posthog/ai` / posthog-node). When an identity is present we keep person
 * processing so `$set` lands on a real person.
 */
function addPersonProcessingProperty(event: Event, properties: Record<string, unknown>): void {
  if (!event.identifyActorGivenId) {
    properties.$process_person_profile = false
  }
}

function addCommonEventProperties(event: Event, properties: Record<string, unknown>): void {
  if (event.resourceName) {
    properties[PostHogMCPAnalyticsProperty.ResourceName] = event.resourceName
    if (event.eventType === MCPAnalyticsEventType.mcpToolsCall) {
      properties[PostHogMCPAnalyticsProperty.ToolName] = event.resourceName
    }
  }
  if (event.toolDescription && event.eventType === MCPAnalyticsEventType.mcpToolsCall) {
    properties[PostHogMCPAnalyticsProperty.ToolDescription] = event.toolDescription
  }
  if (
    event.listedToolNames &&
    event.listedToolNames.length > 0 &&
    event.eventType === MCPAnalyticsEventType.mcpToolsList
  ) {
    properties[PostHogMCPAnalyticsProperty.ListedToolNames] = event.listedToolNames
  }
  if (event.duration !== undefined) {
    properties[PostHogMCPAnalyticsProperty.DurationMs] = event.duration
  }
  if (event.serverName) {
    properties[PostHogMCPAnalyticsProperty.ServerName] = event.serverName
  }
  if (event.serverVersion) {
    properties[PostHogMCPAnalyticsProperty.ServerVersion] = event.serverVersion
  }
  if (event.clientName) {
    properties[PostHogMCPAnalyticsProperty.ClientName] = event.clientName
  }
  if (event.clientVersion) {
    properties[PostHogMCPAnalyticsProperty.ClientVersion] = event.clientVersion
  }
  if (event.userIntent) {
    properties[PostHogMCPAnalyticsProperty.Intent] = event.userIntent
  }
  if (event.userIntentSource) {
    properties[PostHogMCPAnalyticsProperty.IntentSource] = event.userIntentSource
  }
  if (event.isError !== undefined) {
    properties[PostHogMCPAnalyticsProperty.IsError] = event.isError
  }

  if (event.parameters !== undefined) {
    properties[PostHogMCPAnalyticsProperty.Parameters] = event.parameters
  }
  if (event.response !== undefined) {
    properties[PostHogMCPAnalyticsProperty.Response] = event.response
  }

  const $set: Record<string, unknown> = {}
  if (event.identifyActorName) {
    $set.name = event.identifyActorName
  }
  if (event.identifyActorData) {
    Object.assign($set, event.identifyActorData)
  }
  if (Object.keys($set).length > 0) {
    properties.$set = $set
  }
}

function addCustomEventProperties(event: Event, properties: Record<string, unknown>): void {
  if (event.properties) {
    for (const [key, value] of Object.entries(event.properties)) {
      properties[key] = value
    }
  }
}

function buildExceptionEvent(event: Event): PostHogCaptureEvent {
  const distinctId = getDistinctId(event)
  const timestamp = getTimestamp(event)

  const properties: Record<string, unknown> = {
    [PostHogMCPAnalyticsProperty.SessionId]: event.sessionId,
  }
  addConversationIdProperty(event, properties)
  addPersonProcessingProperty(event, properties)

  if (event.error) {
    // Spread the core `$exception_list` / `$exception_level` properties so MCP
    // tool failures use the same error-tracking contract as every other SDK.
    Object.assign(properties, event.error)
  }

  if (event.resourceName) {
    properties[PostHogMCPAnalyticsProperty.ResourceName] = event.resourceName
    if (event.eventType === MCPAnalyticsEventType.mcpToolsCall) {
      properties[PostHogMCPAnalyticsProperty.ToolName] = event.resourceName
    }
  }
  if (event.toolDescription && event.eventType === MCPAnalyticsEventType.mcpToolsCall) {
    properties[PostHogMCPAnalyticsProperty.ToolDescription] = event.toolDescription
  }
  if (event.serverName) {
    properties[PostHogMCPAnalyticsProperty.ServerName] = event.serverName
  }
  if (event.serverVersion) {
    properties[PostHogMCPAnalyticsProperty.ServerVersion] = event.serverVersion
  }
  if (event.clientName) {
    properties[PostHogMCPAnalyticsProperty.ClientName] = event.clientName
  }
  if (event.clientVersion) {
    properties[PostHogMCPAnalyticsProperty.ClientVersion] = event.clientVersion
  }

  addCustomEventProperties(event, properties)

  return {
    event: PostHogMCPAnalyticsEvent.Exception,
    distinct_id: distinctId,
    properties,
    timestamp,
    type: 'capture',
  }
}

function buildAISpanEvent(event: Event): PostHogCaptureEvent {
  const distinctId = getDistinctId(event)
  const timestamp = getTimestamp(event)

  const properties: Record<string, unknown> = {
    [PostHogMCPAnalyticsProperty.AiSessionId]: `posthog_mcp_analytics_${event.sessionId}`,
    [PostHogMCPAnalyticsProperty.AiTraceId]: getAITraceId(event),
    [PostHogMCPAnalyticsProperty.AiSpanId]: getAISpanId(event),
    [PostHogMCPAnalyticsProperty.AiSpanName]: event.resourceName || 'unknown_tool',
    [PostHogMCPAnalyticsProperty.AiIsError]: event.isError,
    [PostHogMCPAnalyticsProperty.SessionId]: event.sessionId,
    [PostHogMCPAnalyticsProperty.Source]: POSTHOG_MCP_ANALYTICS_SOURCE,
  }
  addConversationIdProperty(event, properties)

  if (event.duration !== undefined) {
    properties[PostHogMCPAnalyticsProperty.AiLatency] = event.duration / 1000
  }
  if (event.isError && event.error) {
    properties.$ai_error = event.error
  }
  if (event.parameters !== undefined) {
    properties[PostHogMCPAnalyticsProperty.AiInputState] = event.parameters
  }
  if (event.response !== undefined) {
    properties[PostHogMCPAnalyticsProperty.AiOutputState] = event.response
  }
  if (event.serverName) {
    properties[PostHogMCPAnalyticsProperty.ServerName] = event.serverName
  }
  if (event.clientName) {
    properties[PostHogMCPAnalyticsProperty.ClientName] = event.clientName
  }
  if (event.userIntent) {
    properties[PostHogMCPAnalyticsProperty.Intent] = event.userIntent
  }
  if (event.userIntentSource) {
    properties[PostHogMCPAnalyticsProperty.IntentSource] = event.userIntentSource
  }

  if (event.properties) {
    for (const [key, value] of Object.entries(event.properties)) {
      properties[key] = value
    }
  }

  return {
    event: PostHogMCPAnalyticsEvent.AiSpan,
    distinct_id: distinctId,
    properties,
    timestamp,
    type: 'capture',
  }
}
