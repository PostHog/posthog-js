import type { MCPServerLike, UnredactedEvent } from '../types'
import { MCPAnalyticsEventType } from './event-types'
import { getServerTrackingData } from './internal'
import { log } from './logger'
import { getSessionInfo } from './session'

/**
 * Materializes an `UnredactedEvent` against the server's tracking data + session info,
 * then hands it to the configured `PostHogMCP` client for the redact/sanitize/truncate
 * pipeline and capture. No-ops if the server isn't tracked, no client is attached, or
 * `enableTracing` is false for an auto-captured event.
 *
 * `enableTracing: false` is the master switch for **auto-captured** events (tool calls,
 * tool listings, initialize, identify). User-initiated `publishCustomEvent()` calls land
 * here with `eventType: custom` and bypass that gate — disabling auto-capture should not
 * silently swallow events the host application explicitly chose to emit.
 */
export function publishEvent(server: MCPServerLike, eventInput: UnredactedEvent): void {
  const data = getServerTrackingData(server)
  if (!data) {
    log('Warning: Server tracking data not found. Event will not be published.')
    return
  }

  const isCustomEvent = eventInput.eventType === MCPAnalyticsEventType.custom
  if (!isCustomEvent && !data.options.enableTracing) {
    return
  }

  const client = data.client
  if (!client) {
    return
  }

  const sessionInfo = getSessionInfo(server, data)

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

  void client.ingest(fullEvent, data.options.enableAITracing ?? false)
}
