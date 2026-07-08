import {
  POSTHOG_MCP_ANALYTICS_SOURCE,
  PostHogMCPAnalyticsEvent,
  PostHogMCPAnalyticsProperty,
} from '../extensions/constants'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { buildPostHogCaptureEvents, type PostHogCaptureEvent } from '../extensions/posthog-events'
import type { Event } from '../types'

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt_test123',
    sessionId: 'ses_session456',
    projectToken: 'proj_1',
    eventType: MCPAnalyticsEventType.mcpToolsCall,
    timestamp: new Date('2025-01-15T10:00:00Z'),
    resourceName: 'get_weather',
    serverName: 'weather-server',
    serverVersion: '1.0.0',
    clientName: 'claude-desktop',
    clientVersion: '2.0.0',
    duration: 150,
    isError: false,
    ...overrides,
  }
}

function findEvent(events: PostHogCaptureEvent[], eventName: string): PostHogCaptureEvent | undefined {
  return events.find((event) => event.event === eventName)
}

// Minimal core ErrorProperties ($exception_list) shape for fixtures.
function makeError(value: string, type = 'Error'): Event['error'] {
  return {
    $exception_list: [{ type, value, mechanism: { type: 'generic', handled: true } }],
    $exception_level: 'error',
  }
}

describe('buildPostHogCaptureEvents', () => {
  it('builds the regular MCP tool-call event payload', () => {
    const [event] = buildPostHogCaptureEvents(makeEvent())

    expect(event.event).toBe(PostHogMCPAnalyticsEvent.ToolCall)
    expect(event.type).toBe('capture')
    expect(event.distinct_id).toBe('ses_session456')
    expect(event.timestamp).toBe('2025-01-15T10:00:00.000Z')

    expect(event.properties[PostHogMCPAnalyticsProperty.SessionId]).toBe('ses_session456')
    expect(event.properties[PostHogMCPAnalyticsProperty.Source]).toBe(POSTHOG_MCP_ANALYTICS_SOURCE)
    expect(event.properties[PostHogMCPAnalyticsProperty.ToolName]).toBe('get_weather')
    expect(event.properties[PostHogMCPAnalyticsProperty.ResourceName]).toBe('get_weather')
    expect(event.properties[PostHogMCPAnalyticsProperty.DurationMs]).toBe(150)
    expect(event.properties[PostHogMCPAnalyticsProperty.ServerName]).toBe('weather-server')
    expect(event.properties[PostHogMCPAnalyticsProperty.ServerVersion]).toBe('1.0.0')
    expect(event.properties[PostHogMCPAnalyticsProperty.ClientName]).toBe('claude-desktop')
    expect(event.properties[PostHogMCPAnalyticsProperty.ClientVersion]).toBe('2.0.0')
    expect(event.properties[PostHogMCPAnalyticsProperty.IsError]).toBe(false)
    expect(event.properties).not.toHaveProperty('project_id')
  })

  it('does not stamp $lib/$lib_version in the built properties (the client owns those)', () => {
    // `$lib` / `$lib_version` are set by the posthog-node client via
    // `getLibraryId()` / `getLibraryVersion()` (see `applyMcpLibIdentity`), not
    // by the event builder — and never as the legacy `$mcp_lib` keys.
    const [event] = buildPostHogCaptureEvents(makeEvent())

    expect(event.properties).not.toHaveProperty('$lib')
    expect(event.properties).not.toHaveProperty('$lib_version')
    expect(event.properties).not.toHaveProperty('$mcp_lib')
    expect(event.properties).not.toHaveProperty('$mcp_lib_version')
  })

  it('keeps the canonical MCP analytics event contract stable', () => {
    const events = buildPostHogCaptureEvents(
      makeEvent({
        identifyActorGivenId: 'user_abc123',
        duration: 250,
        parameters: { city: 'London' },
        response: { temp: 15 },
        userIntent: 'Check the weather in London',
        userIntentSource: 'context_parameter',
      })
    )

    const toolCall = findEvent(events, PostHogMCPAnalyticsEvent.ToolCall)

    expect(toolCall?.properties).toEqual(
      expect.objectContaining({
        [PostHogMCPAnalyticsProperty.DurationMs]: 250,
        [PostHogMCPAnalyticsProperty.Intent]: 'Check the weather in London',
        [PostHogMCPAnalyticsProperty.IntentSource]: 'context_parameter',
        [PostHogMCPAnalyticsProperty.IsError]: false,
        [PostHogMCPAnalyticsProperty.Parameters]: { city: 'London' },
        [PostHogMCPAnalyticsProperty.Response]: { temp: 15 },
        [PostHogMCPAnalyticsProperty.SessionId]: 'ses_session456',
        [PostHogMCPAnalyticsProperty.Source]: POSTHOG_MCP_ANALYTICS_SOURCE,
        [PostHogMCPAnalyticsProperty.ToolName]: 'get_weather',
      })
    )
    expect(toolCall?.properties).not.toHaveProperty('$mcp_context')
    // With an identity resolved we do not opt out of person processing.
    expect(toolCall?.properties).not.toHaveProperty('$process_person_profile')
  })

  it('uses identifyActorGivenId as distinct_id when available', () => {
    const [event] = buildPostHogCaptureEvents(makeEvent({ identifyActorGivenId: 'user_abc123' }))

    expect(event.distinct_id).toBe('user_abc123')
  })

  it('falls back to sessionId when identifyActorGivenId is not set', () => {
    const [event] = buildPostHogCaptureEvents(makeEvent({ identifyActorGivenId: undefined }))

    expect(event.distinct_id).toBe('ses_session456')
  })

  it('builds an $exception event alongside the regular event for errors', () => {
    const events = buildPostHogCaptureEvents(
      makeEvent({
        isError: true,
        error: makeError('Connection timeout', 'TimeoutError'),
      })
    )

    expect(events).toHaveLength(2)
    expect(events[0].event).toBe('$mcp_tool_call')
    expect(events[0].properties.$mcp_is_error).toBe(true)

    const exceptionEvent = events[1]
    expect(exceptionEvent.event).toBe('$exception')
    expect(exceptionEvent.distinct_id).toBe('ses_session456')
    // The core $exception_list / $exception_level properties are spread through.
    expect(exceptionEvent.properties.$exception_level).toBe('error')
    expect(exceptionEvent.properties.$exception_list).toEqual([
      expect.objectContaining({ type: 'TimeoutError', value: 'Connection timeout' }),
    ])
    expect(exceptionEvent.properties.$session_id).toBe('ses_session456')
    expect(exceptionEvent.properties.$mcp_resource_name).toBe('get_weather')
    expect(exceptionEvent.properties.$mcp_tool_name).toBe('get_weather')
    expect(exceptionEvent.properties.$mcp_server_name).toBe('weather-server')
    expect(exceptionEvent.properties).not.toHaveProperty('$mcp_lib')
    expect(exceptionEvent.properties).not.toHaveProperty('$mcp_lib_version')
  })

  it('spreads customer eventProperties onto the $exception event', () => {
    const events = buildPostHogCaptureEvents(
      makeEvent({
        isError: true,
        error: makeError('boom'),
        properties: {
          deployment: 'prod',
          $mcp_exec_tool_call_description: 'Run a HogQL/SQL query.',
          $groups: { organization: 'org_123' },
        },
      })
    )

    const exceptionEvent = findEvent(events, PostHogMCPAnalyticsEvent.Exception)

    expect(exceptionEvent?.properties.deployment).toBe('prod')
    expect(exceptionEvent?.properties.$mcp_exec_tool_call_description).toBe('Run a HogQL/SQL query.')
    expect(exceptionEvent?.properties.$groups).toEqual({
      organization: 'org_123',
    })
  })

  it('does not build an $exception event when isError is false', () => {
    const events = buildPostHogCaptureEvents(makeEvent({ isError: false }))

    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('$mcp_tool_call')
  })

  it('does not build an $exception event when enableExceptionAutocapture is false', () => {
    const events = buildPostHogCaptureEvents(makeEvent({ isError: true, error: makeError('boom') }), {
      enableExceptionAutocapture: false,
    })

    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('$mcp_tool_call')
    expect(findEvent(events, PostHogMCPAnalyticsEvent.Exception)).toBeUndefined()
  })

  it('builds an $exception event by default when isError is true', () => {
    const events = buildPostHogCaptureEvents(makeEvent({ isError: true, error: makeError('boom') }))

    expect(events).toHaveLength(2)
    expect(findEvent(events, PostHogMCPAnalyticsEvent.Exception)).toBeDefined()
  })

  // `undefined` expected value = property must be absent.
  it.each<[string, Partial<Event>, string | undefined, string | undefined]>([
    [
      'derives type and message from the thrown error',
      { isError: true, error: makeError('Connection timeout', 'TimeoutError') },
      'TimeoutError',
      'Connection timeout',
    ],
    [
      'explicit errorType overrides the thrown error type, message still flows',
      { isError: true, errorType: 'rate_limited', error: makeError('429 Too Many Requests', 'Error') },
      'rate_limited',
      '429 Too Many Requests',
    ],
    [
      'explicit errorType with no thrown error stamps type only',
      { isError: true, errorType: 'validation' },
      'validation',
      undefined,
    ],
    ['successful call omits both', { isError: false }, undefined, undefined],
  ])('error properties on the tool-call event: %s', (_, overrides, expectedType, expectedMessage) => {
    const [event] = buildPostHogCaptureEvents(makeEvent(overrides))

    if (expectedType === undefined) {
      expect(event.properties).not.toHaveProperty(PostHogMCPAnalyticsProperty.ErrorType)
    } else {
      expect(event.properties[PostHogMCPAnalyticsProperty.ErrorType]).toBe(expectedType)
    }

    if (expectedMessage === undefined) {
      expect(event.properties).not.toHaveProperty(PostHogMCPAnalyticsProperty.ErrorMessage)
    } else {
      expect(event.properties[PostHogMCPAnalyticsProperty.ErrorMessage]).toBe(expectedMessage)
    }
  })

  it('includes $set person properties from identity data', () => {
    const [event] = buildPostHogCaptureEvents(
      makeEvent({
        identifyActorGivenId: 'user_abc',
        identifyActorData: { name: 'Alice', email: 'alice@example.com', plan: 'pro' },
      })
    )

    expect(event.properties.$set).toEqual({
      name: 'Alice',
      email: 'alice@example.com',
      plan: 'pro',
    })
  })

  it('does not include $set when no identity data is present', () => {
    const [event] = buildPostHogCaptureEvents(makeEvent())

    expect(event.properties.$set).toBeUndefined()
  })

  it('passes through parameters and response as-is', () => {
    const [event] = buildPostHogCaptureEvents(
      makeEvent({
        parameters: { city: 'London', units: 'celsius' },
        response: { temperature: 15, condition: 'cloudy' },
      })
    )

    expect(event.properties.$mcp_parameters).toEqual({
      city: 'London',
      units: 'celsius',
    })
    expect(event.properties.$mcp_response).toEqual({
      temperature: 15,
      condition: 'cloudy',
    })
  })

  it('passes through string parameters and response as-is', () => {
    const [event] = buildPostHogCaptureEvents(
      makeEvent({
        parameters: 'raw input',
        response: 'raw output',
      })
    )

    expect(event.properties.$mcp_parameters).toBe('raw input')
    expect(event.properties.$mcp_response).toBe('raw output')
  })

  it('sets $mcp_listed_tool_names on mcp_tools_list events', () => {
    const [event] = buildPostHogCaptureEvents(
      makeEvent({
        eventType: MCPAnalyticsEventType.mcpToolsList,
        resourceName: undefined,
        listedToolNames: ['get_weather', 'list_alerts', 'find_station'],
      })
    )

    expect(event.properties[PostHogMCPAnalyticsProperty.ListedToolNames]).toEqual([
      'get_weather',
      'list_alerts',
      'find_station',
    ])
  })

  it('does not set $mcp_listed_tool_names on non-tools/list events', () => {
    const [event] = buildPostHogCaptureEvents(
      makeEvent({
        listedToolNames: ['should_be_ignored'],
      })
    )

    expect(event.properties[PostHogMCPAnalyticsProperty.ListedToolNames]).toBeUndefined()
  })

  it('does not set $mcp_listed_tool_names when the array is empty', () => {
    const [event] = buildPostHogCaptureEvents(
      makeEvent({
        eventType: MCPAnalyticsEventType.mcpToolsList,
        listedToolNames: [],
      })
    )

    expect(event.properties[PostHogMCPAnalyticsProperty.ListedToolNames]).toBeUndefined()
  })

  it('sets $mcp_tool_description on tool-call and exception events', () => {
    const description = 'Fetches the current weather for a given city, returning temperature and conditions.'
    const events = buildPostHogCaptureEvents(
      makeEvent({
        toolDescription: description,
        isError: true,
        error: makeError('boom'),
      })
    )

    const toolCallEvent = findEvent(events, PostHogMCPAnalyticsEvent.ToolCall)
    const exceptionEvent = findEvent(events, PostHogMCPAnalyticsEvent.Exception)

    expect(toolCallEvent?.properties[PostHogMCPAnalyticsProperty.ToolDescription]).toBe(description)
    expect(exceptionEvent?.properties[PostHogMCPAnalyticsProperty.ToolDescription]).toBe(description)
  })

  it('sets $mcp_tool_category on tool-call and exception events, and omits it elsewhere', () => {
    const events = buildPostHogCaptureEvents(
      makeEvent({
        toolCategory: 'Logs',
        isError: true,
        error: makeError('boom'),
      })
    )

    const toolCallEvent = findEvent(events, PostHogMCPAnalyticsEvent.ToolCall)
    const exceptionEvent = findEvent(events, PostHogMCPAnalyticsEvent.Exception)
    expect(toolCallEvent?.properties[PostHogMCPAnalyticsProperty.ToolCategory]).toBe('Logs')
    expect(exceptionEvent?.properties[PostHogMCPAnalyticsProperty.ToolCategory]).toBe('Logs')

    const [resourceEvent] = buildPostHogCaptureEvents(
      makeEvent({
        eventType: MCPAnalyticsEventType.mcpResourcesRead,
        toolCategory: 'should be omitted',
      })
    )
    expect(resourceEvent.properties[PostHogMCPAnalyticsProperty.ToolCategory]).toBeUndefined()
  })

  it('does not set $mcp_tool_description for non tools/call events', () => {
    const [event] = buildPostHogCaptureEvents(
      makeEvent({
        eventType: MCPAnalyticsEventType.mcpResourcesRead,
        toolDescription: 'should be omitted',
      })
    )

    expect(event.properties[PostHogMCPAnalyticsProperty.ToolDescription]).toBeUndefined()
  })

  it('only sets $mcp_tool_name for tools/call events', () => {
    const [toolCallEvent] = buildPostHogCaptureEvents(
      makeEvent({
        eventType: MCPAnalyticsEventType.mcpToolsCall,
        resourceName: 'get_weather',
      })
    )
    expect(toolCallEvent.properties.$mcp_tool_name).toBe('get_weather')
    expect(toolCallEvent.properties.$mcp_resource_name).toBe('get_weather')

    const [resourceEvent] = buildPostHogCaptureEvents(
      makeEvent({
        eventType: MCPAnalyticsEventType.mcpResourcesRead,
        resourceName: 'my_resource',
      })
    )
    expect(resourceEvent.properties.$mcp_tool_name).toBeUndefined()
    expect(resourceEvent.properties.$mcp_resource_name).toBe('my_resource')
  })

  it('maps MCP event types to PostHog event names', () => {
    const eventTypes = [
      [MCPAnalyticsEventType.custom, PostHogMCPAnalyticsEvent.Custom],
      [MCPAnalyticsEventType.identify, PostHogMCPAnalyticsEvent.Identify],
      [MCPAnalyticsEventType.mcpToolsCall, PostHogMCPAnalyticsEvent.ToolCall],
      [MCPAnalyticsEventType.mcpToolsList, PostHogMCPAnalyticsEvent.ToolsList],
      [MCPAnalyticsEventType.mcpInitialize, PostHogMCPAnalyticsEvent.Initialize],
      [MCPAnalyticsEventType.mcpResourcesRead, PostHogMCPAnalyticsEvent.ResourceRead],
      [MCPAnalyticsEventType.mcpResourcesList, PostHogMCPAnalyticsEvent.ResourcesList],
      [MCPAnalyticsEventType.mcpPromptsGet, PostHogMCPAnalyticsEvent.PromptGet],
      [MCPAnalyticsEventType.mcpPromptsList, PostHogMCPAnalyticsEvent.PromptsList],
    ] satisfies [MCPAnalyticsEventType, PostHogMCPAnalyticsEvent][]

    for (const [input, expected] of eventTypes) {
      const [event] = buildPostHogCaptureEvents(makeEvent({ eventType: input }))

      expect(event.event).toBe(expected)
    }
  })

  it('spreads customer-defined tags and properties directly into properties', () => {
    const [event] = buildPostHogCaptureEvents(
      makeEvent({
        properties: {
          env: 'production',
          trace_id: 'abc-123',
          device: 'mobile',
          feature_flags: ['dark_mode'],
        },
      })
    )

    expect(event.properties.env).toBe('production')
    expect(event.properties.trace_id).toBe('abc-123')
    expect(event.properties.device).toBe('mobile')
    expect(event.properties.feature_flags).toEqual(['dark_mode'])
  })

  it('does not include customer tag or property keys when not set on event', () => {
    const [event] = buildPostHogCaptureEvents(makeEvent())

    expect(event.properties.$mcp_source).toBe('posthog_mcp_analytics')
    expect(event.properties.env).toBeUndefined()
    expect(event.properties.device).toBeUndefined()
  })

  it('maps userIntent to the MCP intent property', () => {
    const [event] = buildPostHogCaptureEvents(makeEvent({ userIntent: 'Check the weather in London' }))

    expect(event.properties.$mcp_intent).toBe('Check the weather in London')
  })

  it('maps userIntentSource to the MCP intent source property', () => {
    const [event] = buildPostHogCaptureEvents(
      makeEvent({
        userIntent: 'Check the weather in London',
        userIntentSource: 'inferred',
      })
    )

    expect(event.properties.$mcp_intent_source).toBe('inferred')
  })
})
