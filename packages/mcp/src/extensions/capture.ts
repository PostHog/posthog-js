import type { MCPServerLike, UnredactedEvent } from '../types'
import { MCPAnalyticsEventType } from './event-types'
import { getServerTrackingData } from './internal'
import { log } from './logger'
import { getSessionInfo } from './session'

/**
 * Materializes an `UnredactedEvent` against the server's tracking data + session info,
 * then hands it to the `McpEventSink` (wrapping the user's posthog-node client) for the
 * redact/sanitize/truncate pipeline and capture. No-ops if the server isn't tracked or no
 * PostHog client is attached — not passing `posthog` is how you turn capture off.
 */
export function captureEvent(server: MCPServerLike, eventInput: UnredactedEvent): void {
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

  const fullEvent: UnredactedEvent = {
    id: eventInput.id || '',
    sessionId: eventInput.sessionId || data.sessionId,
    eventType: eventInput.eventType || MCPAnalyticsEventType.custom,
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
    identifyActorName: sessionInfo.identifyActorName,
    identifyActorData: sessionInfo.identifyActorData,
    resourceName: eventInput.resourceName,
    toolDescription: eventInput.toolDescription,
    listedToolNames: eventInput.listedToolNames,
    parameters: eventInput.parameters,
    response: eventInput.response,
    userIntent: eventInput.userIntent,
    userIntentSource: eventInput.userIntentSource,
    isError: eventInput.isError,
    error: eventInput.error,
    conversationId: eventInput.conversationId,
    redactionFn: eventInput.redactionFn,
    properties: eventInput.properties,
  }

  void sink.capture(fullEvent, {
    enableExceptionAutocapture: data.options.enableExceptionAutocapture ?? true,
  })
}
