// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import type { Event } from '../types'
import { POSTHOG_MCP_ANALYTICS_SOURCE, PostHogMCPAnalyticsEvent, PostHogMCPAnalyticsProperty } from './constants'
import { MCPAnalyticsEventType } from './event-types'

const BUILT_IN_EVENT_NAME_BY_TYPE = {
  [MCPAnalyticsEventType.custom]: PostHogMCPAnalyticsEvent.Custom,
  [MCPAnalyticsEventType.identify]: PostHogMCPAnalyticsEvent.Identify,
  [MCPAnalyticsEventType.mcpMissingCapability]: PostHogMCPAnalyticsEvent.MissingCapability,
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
  /** Whether to emit a `$exception` sibling alongside errored events. Defaults to `true`. */
  enableExceptionAutocapture?: boolean
}

export function buildPostHogCaptureEvents(
  event: Event,
  options: BuildPostHogCaptureEventsOptions = {}
): PostHogCaptureEvent[] {
  const batch = [buildCaptureEvent(event)]

  if (event.isError && event.error && options.enableExceptionAutocapture !== false) {
    batch.push(buildExceptionEvent(event))
  }

  return batch
}

function buildCaptureEvent(event: Event): PostHogCaptureEvent {
  const distinctId = getDistinctId(event)
  const timestamp = getTimestamp(event)

  const properties: Record<string, unknown> = {
    [PostHogMCPAnalyticsProperty.Source]: POSTHOG_MCP_ANALYTICS_SOURCE,
  }
  addSessionIdProperty(event, properties)
  addConversationIdProperty(event, properties)
  addPersonProcessingProperty(event, properties)
  addGroupsProperty(event, properties)

  addCommonEventProperties(event, properties)
  addCustomEventProperties(event, properties)

  return {
    event: event.eventName ?? BUILT_IN_EVENT_NAME_BY_TYPE[event.eventType],
    distinct_id: distinctId,
    properties,
    timestamp,
    type: 'capture',
  }
}

/**
 * Stamps `$session_id` only when the event carries a session. The auto-capture
 * (`instrument`) path always resolves a session id, but the server-agnostic
 * `createMcpAnalytics` path leaves it unset when the caller has no session — and
 * a fabricated `$session_id` would wrongly bucket events into a non-existent
 * Session Replay session.
 */
function addSessionIdProperty(event: Event, properties: Record<string, unknown>): void {
  if (typeof event.sessionId === 'string' && event.sessionId.length > 0) {
    properties[PostHogMCPAnalyticsProperty.SessionId] = event.sessionId
  }
}

function addConversationIdProperty(event: Event, properties: Record<string, unknown>): void {
  if (event.conversationId !== undefined && event.conversationId !== '') {
    properties[PostHogMCPAnalyticsProperty.ConversationId] = event.conversationId
  }
}

function addGroupsProperty(event: Event, properties: Record<string, unknown>): void {
  if (event.groups && Object.keys(event.groups).length > 0) {
    properties.$groups = event.groups
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
  if (event.toolCategory && event.eventType === MCPAnalyticsEventType.mcpToolsCall) {
    properties[PostHogMCPAnalyticsProperty.ToolCategory] = event.toolCategory
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

  if (event.isError) {
    // Surface the failure reason directly on the primary event so the dashboard
    // can break errors down by cause without joining to the `$exception` sibling
    // (which can be disabled, and isn't emitted when no error value is passed).
    const firstException = event.error?.$exception_list?.[0]
    const errorType = event.errorType ?? firstException?.type
    if (errorType) {
      properties[PostHogMCPAnalyticsProperty.ErrorType] = errorType
    }
    if (firstException?.value) {
      // Already bounded to MAX_ERROR_MESSAGE_LENGTH by `truncateExceptionList`.
      properties[PostHogMCPAnalyticsProperty.ErrorMessage] = firstException.value
    }
  }

  if (event.parameters !== undefined) {
    properties[PostHogMCPAnalyticsProperty.Parameters] = event.parameters
  }
  if (event.response !== undefined) {
    properties[PostHogMCPAnalyticsProperty.Response] = event.response
  }

  if (event.identifyActorData && Object.keys(event.identifyActorData).length > 0) {
    // Person properties from `identify().properties` go straight to `$set`.
    properties.$set = { ...event.identifyActorData }
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

  const properties: Record<string, unknown> = {}
  addSessionIdProperty(event, properties)
  addConversationIdProperty(event, properties)
  addPersonProcessingProperty(event, properties)
  addGroupsProperty(event, properties)

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
  if (event.toolCategory && event.eventType === MCPAnalyticsEventType.mcpToolsCall) {
    properties[PostHogMCPAnalyticsProperty.ToolCategory] = event.toolCategory
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
