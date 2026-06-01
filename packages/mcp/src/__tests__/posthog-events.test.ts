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

  it('keeps the canonical MCP analytics event contract stable', () => {
    const events = buildPostHogCaptureEvents(
      makeEvent({
        duration: 250,
        parameters: { city: 'London' },
        response: { temp: 15 },
        userIntent: 'Check the weather in London',
        userIntentSource: 'context_parameter',
      }),
      { enableAITracing: true }
    )

    const toolCall = findEvent(events, PostHogMCPAnalyticsEvent.ToolCall)
    const span = findEvent(events, PostHogMCPAnalyticsEvent.AiSpan)

    expect(toolCall?.properties).toEqual(
      expect.objectContaining({
        [PostHogMCPAnalyticsProperty.AiSpanId]: 'evt_test123',
        [PostHogMCPAnalyticsProperty.AiTraceId]: 'ses_session456',
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

    expect(span?.properties).toEqual(
      expect.objectContaining({
        [PostHogMCPAnalyticsProperty.AiInputState]: { city: 'London' },
        [PostHogMCPAnalyticsProperty.AiIsError]: false,
        [PostHogMCPAnalyticsProperty.AiLatency]: 0.25,
        [PostHogMCPAnalyticsProperty.AiOutputState]: { temp: 15 },
        [PostHogMCPAnalyticsProperty.AiSessionId]: 'posthog_mcp_analytics_ses_session456',
        [PostHogMCPAnalyticsProperty.AiSpanId]: 'evt_test123',
        [PostHogMCPAnalyticsProperty.AiSpanName]: 'get_weather',
        [PostHogMCPAnalyticsProperty.AiTraceId]: 'ses_session456',
        [PostHogMCPAnalyticsProperty.Intent]: 'Check the weather in London',
        [PostHogMCPAnalyticsProperty.IntentSource]: 'context_parameter',
        [PostHogMCPAnalyticsProperty.SessionId]: 'ses_session456',
        [PostHogMCPAnalyticsProperty.Source]: POSTHOG_MCP_ANALYTICS_SOURCE,
      })
    )
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

  it('includes $set person properties from identity data', () => {
    const [event] = buildPostHogCaptureEvents(
      makeEvent({
        identifyActorGivenId: 'user_abc',
        identifyActorName: 'Alice',
        identifyActorData: { email: 'alice@example.com', plan: 'pro' },
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

  it('emits $ai_span alongside regular event for tool calls when enableAITracing is true', () => {
    const events = buildPostHogCaptureEvents(
      makeEvent({
        eventType: MCPAnalyticsEventType.mcpToolsCall,
        resourceName: 'get_weather',
        duration: 250,
        parameters: { city: 'London' },
        response: { temp: 15 },
      }),
      { enableAITracing: true }
    )

    expect(events).toHaveLength(2)

    const regular = findEvent(events, '$mcp_tool_call')
    expect(regular).toBeDefined()

    const span = findEvent(events, '$ai_span')
    expect(span).toBeDefined()
    expect(span?.type).toBe('capture')
    expect(span?.distinct_id).toBe('ses_session456')
    expect(span?.timestamp).toBe('2025-01-15T10:00:00.000Z')

    expect(span?.properties.$ai_session_id).toBe('posthog_mcp_analytics_ses_session456')
    expect(span?.properties.$ai_trace_id).toBeDefined()
    expect(span?.properties.$ai_span_id).toBeDefined()
    expect(span?.properties.$ai_trace_id).not.toBe(span?.properties.$ai_span_id)
    expect(span?.properties.$ai_span_name).toBe('get_weather')
    expect(span?.properties.$ai_latency).toBeCloseTo(0.25)
    expect(span?.properties.$ai_is_error).toBe(false)
    expect(span?.properties.$ai_input_state).toEqual({ city: 'London' })
    expect(span?.properties.$ai_output_state).toEqual({ temp: 15 })
    expect(span?.properties.$session_id).toBe('ses_session456')
    expect(span?.properties.$mcp_source).toBe('posthog_mcp_analytics')
    expect(span?.properties.$mcp_server_name).toBe('weather-server')
    expect(span?.properties.$mcp_client_name).toBe('claude-desktop')

    expect(regular?.properties.$ai_trace_id).toBe(span?.properties.$ai_trace_id)
    expect(regular?.properties.$ai_span_id).toBe(span?.properties.$ai_span_id)
  })

  it('uses SDK event and session IDs directly for AI trace and span IDs', () => {
    const sesId = 'ses_trace123'
    const evtA = 'evt_a123'
    const evtB = 'evt_b123'

    const spanA = findEvent(
      buildPostHogCaptureEvents(makeEvent({ id: evtA, sessionId: sesId }), {
        enableAITracing: true,
      }),
      '$ai_span'
    )
    const spanB = findEvent(
      buildPostHogCaptureEvents(makeEvent({ id: evtB, sessionId: sesId }), {
        enableAITracing: true,
      }),
      '$ai_span'
    )
    const spanC = findEvent(
      buildPostHogCaptureEvents(makeEvent({ id: evtA, sessionId: sesId }), {
        enableAITracing: true,
      }),
      '$ai_span'
    )

    expect(spanA?.properties.$ai_session_id).toBe(`posthog_mcp_analytics_${sesId}`)
    expect(spanA?.properties.$ai_session_id).toBe(spanB?.properties.$ai_session_id)
    expect(spanA?.properties.$ai_trace_id).toBe(spanB?.properties.$ai_trace_id)
    expect(spanA?.properties.$ai_span_id).not.toBe(spanB?.properties.$ai_span_id)
    expect(spanA?.properties.$ai_span_id).toBe(spanC?.properties.$ai_span_id)
    expect(spanA?.properties.$ai_trace_id).not.toBe(spanA?.properties.$ai_span_id)
    expect(spanA?.properties.$ai_trace_id).toBe(sesId)
    expect(spanA?.properties.$ai_span_id).toBe(evtA)
  })

  it('does not emit $ai_span when enableAITracing is false or unset', () => {
    const defaultEvents = buildPostHogCaptureEvents(makeEvent({ eventType: MCPAnalyticsEventType.mcpToolsCall }))
    expect(defaultEvents).toHaveLength(1)
    expect(defaultEvents[0].event).toBe('$mcp_tool_call')

    const disabledEvents = buildPostHogCaptureEvents(makeEvent({ eventType: MCPAnalyticsEventType.mcpToolsCall }), {
      enableAITracing: false,
    })
    expect(disabledEvents).toHaveLength(1)
    expect(disabledEvents[0].event).toBe('$mcp_tool_call')
  })

  it('does not emit $ai_span for non-tool-call events even with enableAITracing', () => {
    const nonToolCallTypes = [
      MCPAnalyticsEventType.mcpInitialize,
      MCPAnalyticsEventType.mcpToolsList,
      MCPAnalyticsEventType.mcpResourcesRead,
      MCPAnalyticsEventType.mcpResourcesList,
      MCPAnalyticsEventType.mcpPromptsGet,
      MCPAnalyticsEventType.mcpPromptsList,
    ]

    for (const eventType of nonToolCallTypes) {
      const events = buildPostHogCaptureEvents(makeEvent({ eventType }), {
        enableAITracing: true,
      })

      expect(findEvent(events, '$ai_span')).toBeUndefined()
    }
  })

  it('spreads customer properties directly on $ai_span', () => {
    const events = buildPostHogCaptureEvents(
      makeEvent({
        eventType: MCPAnalyticsEventType.mcpToolsCall,
        properties: {
          env: 'production',
          region: 'us-east',
          feature_flag: 'new_ui',
          count: 42,
        },
      }),
      { enableAITracing: true }
    )

    const span = findEvent(events, '$ai_span')
    expect(span?.properties.env).toBe('production')
    expect(span?.properties.region).toBe('us-east')
    expect(span?.properties.feature_flag).toBe('new_ui')
    expect(span?.properties.count).toBe(42)

    const regular = findEvent(events, '$mcp_tool_call')
    expect(regular?.properties.env).toBe('production')
    expect(regular?.properties.feature_flag).toBe('new_ui')
    expect(regular?.properties.count).toBe(42)
  })

  it('allows customer properties to override $ai_* defaults on $ai_span', () => {
    const customTraceId = 'custom-trace-uuid-from-customer'
    const events = buildPostHogCaptureEvents(
      makeEvent({
        eventType: MCPAnalyticsEventType.mcpToolsCall,
        properties: { $ai_trace_id: customTraceId, $ai_span_name: 'custom_name' },
      }),
      { enableAITracing: true }
    )

    const span = findEvent(events, '$ai_span')
    expect(span?.properties.$ai_trace_id).toBe(customTraceId)
    expect(span?.properties.$ai_span_name).toBe('custom_name')
  })

  it('emits regular + $exception + $ai_span for error tool calls with enableAITracing', () => {
    const events = buildPostHogCaptureEvents(
      makeEvent({
        eventType: MCPAnalyticsEventType.mcpToolsCall,
        isError: true,
        error: makeError('Tool execution failed', 'ExecutionError'),
      }),
      { enableAITracing: true }
    )

    expect(events).toHaveLength(3)
    expect(events[0].event).toBe('$mcp_tool_call')
    expect(events[1].event).toBe('$exception')
    expect(events[2].event).toBe('$ai_span')
    expect(events[2].properties.$ai_is_error).toBe(true)
    expect(events[2].properties.$ai_error).toEqual(
      expect.objectContaining({
        $exception_list: [expect.objectContaining({ type: 'ExecutionError', value: 'Tool execution failed' })],
      })
    )
  })
})
