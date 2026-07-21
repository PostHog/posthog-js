import { getMoreToolsResult, PostHogMCP } from '../index'
import { PostHogMCPAnalyticsEvent, PostHogMCPAnalyticsProperty } from '../extensions/constants'
import { GET_MORE_TOOLS_NAME } from '../extensions/tools'
import type { PostHogCaptureEvent } from '../extensions/posthog-events'
import { EventCapture } from './test-utils'

// The capture methods are fire-and-forget (mirroring posthog-node's `capture()`),
// so let the microtask/timer queue drain before asserting on what the sink saw.
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('PostHogMCP', () => {
  let capture: EventCapture
  let posthog: PostHogMCP

  beforeEach(async () => {
    capture = new EventCapture()
    await capture.start()
    posthog = new PostHogMCP('phc_test', { host: 'http://localhost', flushAt: 1, fetchRetryCount: 0 })
  })

  afterEach(async () => {
    await capture.stop()
    await posthog.shutdown()
  })

  function newClient(options?: ConstructorParameters<typeof PostHogMCP>[1]): PostHogMCP {
    return new PostHogMCP('phc_test', { host: 'http://localhost', flushAt: 1, fetchRetryCount: 0, ...options })
  }

  function onlyCapture(eventName: string): PostHogCaptureEvent {
    const matches = capture.findCapturesByEvent(eventName)
    expect(matches).toHaveLength(1)
    return matches[0]
  }

  it('is a drop-in PostHog client (inherits capture/identify/etc.)', () => {
    expect(typeof posthog.capture).toBe('function')
    expect(typeof posthog.identify).toBe('function')
    expect(typeof posthog.shutdown).toBe('function')
  })

  // `$lib` / `$lib_version` identity is covered for both emit paths in lib-identity.test.ts.

  describe('captureToolCall', () => {
    it('emits $mcp_tool_call with canonical properties, identity, and groups', async () => {
      posthog.captureToolCall({
        toolName: 'execute-sql',
        toolDescription: 'Run a HogQL/SQL query against PostHog.',
        durationMs: 42,
        isError: false,
        distinctId: 'user-123',
        sessionId: 'session-abc',
        groups: { organization: 'org-1', project: 'proj-1' },
        properties: { $mcp_client_name: 'claude-code', custom_flag: true },
      })
      await tick()

      const payload = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall)
      expect(payload.distinct_id).toBe('user-123')
      const p = payload.properties
      expect(p[PostHogMCPAnalyticsProperty.ToolName]).toBe('execute-sql')
      expect(p[PostHogMCPAnalyticsProperty.ResourceName]).toBe('execute-sql')
      expect(p[PostHogMCPAnalyticsProperty.ToolDescription]).toBe('Run a HogQL/SQL query against PostHog.')
      expect(p[PostHogMCPAnalyticsProperty.DurationMs]).toBe(42)
      expect(p[PostHogMCPAnalyticsProperty.IsError]).toBe(false)
      expect(p[PostHogMCPAnalyticsProperty.SessionId]).toBe('session-abc')
      expect(p[PostHogMCPAnalyticsProperty.Source]).toBe('posthog_mcp_analytics')
      expect(p.$groups).toEqual({ organization: 'org-1', project: 'proj-1' })
      expect(p.$mcp_client_name).toBe('claude-code')
      expect(p.custom_flag).toBe(true)
      // A resolved identity keeps person processing on.
      expect(p.$process_person_profile).toBeUndefined()
    })

    it('maps category to $mcp_tool_category', async () => {
      posthog.captureToolCall({
        toolName: 'query-logs',
        category: 'Logs',
        distinctId: 'user-123',
        isError: false,
      })
      await tick()
      expect(onlyCapture(PostHogMCPAnalyticsEvent.ToolCall).properties[PostHogMCPAnalyticsProperty.ToolCategory]).toBe(
        'Logs'
      )
    })

    it('omits $mcp_tool_category when no category is provided', async () => {
      posthog.captureToolCall({ toolName: 'query-logs', distinctId: 'user-123', isError: false })
      await tick()
      expect(
        onlyCapture(PostHogMCPAnalyticsEvent.ToolCall).properties[PostHogMCPAnalyticsProperty.ToolCategory]
      ).toBeUndefined()
    })

    it('captures parameters and response (sanitized + truncated by the pipeline)', async () => {
      posthog.captureToolCall({
        toolName: 'execute-sql',
        distinctId: 'user-123',
        parameters: { query: 'select 1' },
        response: { rows: 1 },
        isError: false,
      })
      await tick()

      const p = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall).properties
      expect(p[PostHogMCPAnalyticsProperty.Parameters]).toEqual({ query: 'select 1' })
      expect(p[PostHogMCPAnalyticsProperty.Response]).toEqual({ rows: 1 })
    })

    it('fans out an $exception sibling on error, carrying the error message', async () => {
      posthog.captureToolCall({
        toolName: 'execute-sql',
        distinctId: 'user-123',
        isError: true,
        error: new Error('query failed'),
      })
      await tick()

      const toolCall = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall)
      expect(toolCall.properties[PostHogMCPAnalyticsProperty.IsError]).toBe(true)

      const exception = onlyCapture(PostHogMCPAnalyticsEvent.Exception)
      expect(exception.distinct_id).toBe('user-123')
      expect(JSON.stringify(exception.properties.$exception_list)).toContain('query failed')
    })

    it('forwards an explicit errorType to $mcp_error_type on the tool-call event', async () => {
      posthog.captureToolCall({
        toolName: 'execute-sql',
        distinctId: 'user-123',
        isError: true,
        errorType: 'validation',
        error: new Error('invalid HogQL'),
      })
      await tick()

      const toolCall = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall)
      expect(toolCall.properties[PostHogMCPAnalyticsProperty.ErrorType]).toBe('validation')
      expect(toolCall.properties[PostHogMCPAnalyticsProperty.ErrorMessage]).toContain('invalid HogQL')
    })

    it('synthesizes an exception from the tool name when isError is set without an error', async () => {
      posthog.captureToolCall({ toolName: 'execute-sql', distinctId: 'user-123', isError: true })
      await tick()

      const exception = onlyCapture(PostHogMCPAnalyticsEvent.Exception)
      expect(JSON.stringify(exception.properties.$exception_list)).toContain('execute-sql')
    })

    it('suppresses the $exception sibling when enableExceptionAutocapture is false', async () => {
      const client = newClient({ enableExceptionAutocapture: false })
      try {
        client.captureToolCall({
          toolName: 'execute-sql',
          distinctId: 'user-123',
          isError: true,
          error: new Error('boom'),
        })
        await tick()

        expect(capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.ToolCall)).toHaveLength(1)
        expect(capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Exception)).toHaveLength(0)
      } finally {
        await client.shutdown()
      }
    })
  })

  describe('intent capture', () => {
    it.each([
      {
        name: 'sets intent + source from the fields',
        intent: 'Find which tool fails most often',
        intentSource: 'context_parameter' as const,
        expectIntent: 'Find which tool fails most often',
        expectSource: 'context_parameter',
      },
      {
        name: 'defaults source to context_parameter when only intent is given',
        intent: 'do a thing',
        intentSource: undefined,
        expectIntent: 'do a thing',
        expectSource: 'context_parameter',
      },
      {
        name: 'passes through an inferred source',
        intent: 'inferred goal',
        intentSource: 'inferred' as const,
        expectIntent: 'inferred goal',
        expectSource: 'inferred',
      },
      {
        name: 'omits both properties when no intent is captured',
        intent: undefined,
        intentSource: undefined,
        expectIntent: undefined,
        expectSource: undefined,
      },
    ])('$name', async ({ intent, intentSource, expectIntent, expectSource }) => {
      posthog.captureToolCall({ toolName: 'execute-sql', distinctId: 'user-123', isError: false, intent, intentSource })
      await tick()

      const p = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall).properties
      if (expectIntent === undefined) {
        expect(p).not.toHaveProperty(PostHogMCPAnalyticsProperty.Intent)
        expect(p).not.toHaveProperty(PostHogMCPAnalyticsProperty.IntentSource)
      } else {
        expect(p[PostHogMCPAnalyticsProperty.Intent]).toBe(expectIntent)
        expect(p[PostHogMCPAnalyticsProperty.IntentSource]).toBe(expectSource)
      }
    })

    it('redacts secrets the agent narrated into the intent', async () => {
      posthog.captureToolCall({
        toolName: 'execute-sql',
        distinctId: 'user-123',
        isError: false,
        intent: 'use token phx_123456789012345678901234567890 to query',
      })
      await tick()
      const p = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall).properties
      expect(p[PostHogMCPAnalyticsProperty.Intent]).not.toContain('phx_123456789012345678901234567890')
      expect(p[PostHogMCPAnalyticsProperty.Intent]).toContain('[redacted]')
    })
  })

  describe('prepareToolList', () => {
    const tools = [
      { name: 'execute-sql', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
      { name: 'query-logs', inputSchema: { type: 'object', properties: {} } },
    ]

    it('injects a required context parameter into every tool by default', () => {
      const prepared = posthog.prepareToolList(tools)
      for (const tool of prepared) {
        expect(tool.inputSchema?.properties?.context).toMatchObject({ type: 'string' })
        expect(tool.inputSchema?.required).toContain('context')
      }
    })

    it('does not mutate the caller’s tools', () => {
      posthog.prepareToolList(tools)
      expect(tools[0].inputSchema.properties).not.toHaveProperty('context')
    })

    it('skips context injection when context is false', () => {
      const prepared = posthog.prepareToolList(tools, { context: false })
      expect(prepared[0].inputSchema?.properties).not.toHaveProperty('context')
    })

    it('returns a fresh array even when nothing is added', () => {
      const prepared = posthog.prepareToolList(tools, { context: false })
      expect(prepared).not.toBe(tools)
      expect(prepared).toEqual(tools)
    })

    it('appends get_more_tools only when reportMissing is on', () => {
      expect(posthog.prepareToolList(tools).some((t) => t.name === GET_MORE_TOOLS_NAME)).toBe(false)
      const withMissing = posthog.prepareToolList(tools, { reportMissing: true })
      expect(withMissing.some((t) => t.name === GET_MORE_TOOLS_NAME)).toBe(true)
    })

    it('honors a custom missingCapabilityToolName, and inject + detect stay consistent', async () => {
      const client = newClient({ missingCapabilityToolName: 'posthog_find_tools' })
      const prepared = client.prepareToolList(tools, { reportMissing: true })

      // injected under the custom name, not the default
      expect(prepared.some((t) => t.name === 'posthog_find_tools')).toBe(true)
      expect(prepared.some((t) => t.name === GET_MORE_TOOLS_NAME)).toBe(false)

      // detection matches the same custom name
      expect(client.prepareToolCall('posthog_find_tools', { context: 'x' }).isMissingCapability).toBe(true)
      expect(client.prepareToolCall(GET_MORE_TOOLS_NAME, { context: 'x' }).isMissingCapability).toBe(false)
      await client.shutdown()
    })
  })

  describe('prepareToolCall', () => {
    it('pulls the context argument out as intent and strips it from args', () => {
      const result = posthog.prepareToolCall('execute-sql', { query: 'select 1', context: 'Counting signups' })
      expect(result.intent).toBe('Counting signups')
      expect(result.intentSource).toBe('context_parameter')
      expect(result.args).toEqual({ query: 'select 1' })
      expect(result.isMissingCapability).toBe(false)
    })

    it('returns no intent when context is absent or blank', () => {
      expect(posthog.prepareToolCall('execute-sql', { query: 'select 1' }).intent).toBeUndefined()
      expect(posthog.prepareToolCall('execute-sql', { context: '   ' }).intent).toBeUndefined()
    })

    it('flags the get_more_tools virtual tool', () => {
      const result = posthog.prepareToolCall(GET_MORE_TOOLS_NAME, { context: 'I need a tool to delete cohorts' })
      expect(result.isMissingCapability).toBe(true)
      expect(result.intent).toBe('I need a tool to delete cohorts')
    })
  })

  describe('captureMissingCapability', () => {
    it('emits $mcp_missing_capability with the context as intent', async () => {
      posthog.captureMissingCapability({ context: 'I need a tool to delete cohorts', distinctId: 'user-123' })
      await tick()

      const payload = onlyCapture(PostHogMCPAnalyticsEvent.MissingCapability)
      const p = payload.properties
      expect(p[PostHogMCPAnalyticsProperty.Intent]).toBe('I need a tool to delete cohorts')
      expect(p[PostHogMCPAnalyticsProperty.IntentSource]).toBe('context_parameter')
    })
  })

  describe('getMoreToolsResult', () => {
    it('returns a text acknowledgement for the agent', () => {
      const result = getMoreToolsResult()
      expect(result.content[0]).toMatchObject({ type: 'text' })
    })
  })

  describe('captureToolsList', () => {
    it('emits $mcp_tools_list with the advertised tool names', async () => {
      posthog.captureToolsList({
        toolNames: ['execute-sql', 'query-logs', 'get_more_tools'],
        durationMs: 3,
        distinctId: 'user-123',
      })
      await tick()

      const p = onlyCapture(PostHogMCPAnalyticsEvent.ToolsList).properties
      expect(p[PostHogMCPAnalyticsProperty.ListedToolNames]).toEqual(['execute-sql', 'query-logs', 'get_more_tools'])
      expect(p[PostHogMCPAnalyticsProperty.DurationMs]).toBe(3)
    })

    it('fans out an $exception sibling when the listing fails', async () => {
      posthog.captureToolsList({ distinctId: 'user-123', isError: true, error: new Error('list blew up') })
      await tick()

      expect(onlyCapture(PostHogMCPAnalyticsEvent.ToolsList).properties[PostHogMCPAnalyticsProperty.IsError]).toBe(true)
      expect(JSON.stringify(onlyCapture(PostHogMCPAnalyticsEvent.Exception).properties.$exception_list)).toContain(
        'list blew up'
      )
    })
  })

  describe('captureInitialize', () => {
    it('emits $mcp_initialize with client metadata', async () => {
      posthog.captureInitialize({
        clientName: 'claude-code',
        clientVersion: '1.2.3',
        protocolVersion: '2025-06-18',
        distinctId: 'user-123',
        durationMs: 7,
      })
      await tick()

      const p = onlyCapture(PostHogMCPAnalyticsEvent.Initialize).properties
      expect(p[PostHogMCPAnalyticsProperty.ClientName]).toBe('claude-code')
      expect(p[PostHogMCPAnalyticsProperty.ClientVersion]).toBe('1.2.3')
      expect(p[PostHogMCPAnalyticsProperty.ProtocolVersion]).toBe('2025-06-18')
      expect(p[PostHogMCPAnalyticsProperty.DurationMs]).toBe(7)
    })
  })

  describe('identity + session handling', () => {
    it('writes setProperties to $set', async () => {
      posthog.captureToolCall({
        toolName: 'execute-sql',
        distinctId: 'user-123',
        setProperties: { email: 'a@b.com', plan: 'pro' },
        isError: false,
      })
      await tick()

      const p = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall).properties
      expect(p.$set).toEqual({ email: 'a@b.com', plan: 'pro' })
    })

    it('marks anonymous and skips person processing when no distinctId is given', async () => {
      posthog.captureToolCall({ toolName: 'execute-sql', isError: false })
      await tick()

      const payload = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall)
      expect(payload.distinct_id).toBe('anonymous')
      expect(payload.properties.$process_person_profile).toBe(false)
    })

    it('omits $session_id entirely when no session is supplied', async () => {
      posthog.captureToolCall({ toolName: 'execute-sql', distinctId: 'user-123', isError: false })
      await tick()

      const payload = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall)
      expect(payload.properties).not.toHaveProperty(PostHogMCPAnalyticsProperty.SessionId)
    })
  })
})
