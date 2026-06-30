// Portions of this file are derived from MCPCat/mcpcat-typescript-sdk
// Copyright (c) 2025 MCPcat
// Licensed under the MIT License: https://github.com/MCPCat/mcpcat-typescript-sdk/blob/main/LICENSE

import type { MCPServerLike, McpEvent } from '../types'
import { MCPAnalyticsEventType } from './event-types'
import { getServerTrackingData } from './internal'
import { log } from './logger'
import { getSessionInfo } from './session'

/**
 * Materializes an `McpEvent` against the server's tracking data + session info,
 * then hands it to the `McpEventSink` (wrapping the user's posthog-node client) for the
 * sanitize/truncate/beforeSend pipeline and capture. No-ops if the server isn't tracked or
 * no PostHog client is attached — not passing `posthog` is how you turn capture off.
 *
 * Returns the sink's capture promise so the user-facing `capture()` can await it.
 * Auto-capture callers (tool calls, listings, identify) intentionally ignore the
 * return value, keeping the tool path isolated from analytics latency/errors.
 */
export function captureEvent(server: MCPServerLike, eventInput: McpEvent): Promise<void> | undefined {
  const data = getServerTrackingData(server)
  if (!data) {
    log('Warning: Server tracking data not found. Event will not be published.')
    return
  }

  const sink = data.sink
  if (!sink) {
    return
  }

  const sessionInfo = getSessionInfo(server, data, eventInput.sessionId)

  const duration =
    eventInput.duration || (eventInput.timestamp ? Date.now() - eventInput.timestamp.getTime() : undefined)

  const fullEvent: McpEvent = {
    id: eventInput.id || '',
    sessionId: eventInput.sessionId || data.sessionId,
    eventType: eventInput.eventType || MCPAnalyticsEventType.custom,
    eventName: eventInput.eventName,
    timestamp: eventInput.timestamp || new Date(),
    duration,
    ipAddress: sessionInfo.ipAddress,
    sdkLanguage: sessionInfo.sdkLanguage,
    sdkVersion: sessionInfo.sdkVersion,
    serverName: sessionInfo.serverName,
    serverVersion: sessionInfo.serverVersion,
    clientName: sessionInfo.clientName,
    clientVersion: sessionInfo.clientVersion,
    identifyActorGivenId: sessionInfo.identifyActorGivenId,
    identifyActorData: sessionInfo.identifyActorData,
    groups: sessionInfo.identifyActorGroups,
    resourceName: eventInput.resourceName,
    toolCategory: eventInput.toolCategory,
    toolDescription: eventInput.toolDescription,
    listedToolNames: eventInput.listedToolNames,
    parameters: eventInput.parameters,
    response: eventInput.response,
    userIntent: eventInput.userIntent,
    userIntentSource: eventInput.userIntentSource,
    isError: eventInput.isError,
    error: eventInput.error,
    errorType: eventInput.errorType,
    conversationId: eventInput.conversationId,
    properties: eventInput.properties,
  }

  return sink.capture(fullEvent, {
    enableExceptionAutocapture: data.options.enableExceptionAutocapture ?? true,
    beforeSend: data.options.beforeSend,
  })
}
