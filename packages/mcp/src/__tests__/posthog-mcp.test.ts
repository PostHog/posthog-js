import { getMoreToolsResult, PostHogMCP } from '../index'
import { PostHogMCPAnalyticsEvent, PostHogMCPAnalyticsProperty } from '../extensions/constants'
import { GET_MORE_TOOLS_NAME } from '../extensions/tools'
import type { PostHogCaptureEvent } from '../extensions/posthog-events'
import { deriveSessionIdFromConversation } from '../extensions/session'
import { MCP_INSTRUCTIONS_KEY } from '../extensions/output-instructions'
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

    it.each([
      {
        name: 'trims a direct model value',
        llmModel: '  claude-sonnet-4-20250514  ',
        expected: 'claude-sonnet-4-20250514',
      },
      { name: 'drops a direct unknown model', llmModel: ' unknown ', expected: undefined },
      {
        name: 'redacts a token from a direct model value',
        llmModel: 'gateway-phx_abcdefghijklmnopqrstuvwxyz1234',
        expected: 'gateway-[redacted]',
      },
    ])('$name', async ({ llmModel, expected }) => {
      posthog.captureToolCall({
        toolName: 'execute-sql',
        distinctId: 'user-123',
        isError: false,
        llmModel,
        llmModelSource: 'self_reported',
      })
      await tick()

      const properties = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall).properties
      expect(properties[PostHogMCPAnalyticsProperty.LlmModel]).toBe(expected)
      expect(properties[PostHogMCPAnalyticsProperty.LlmModelSource]).toBe(
        expected === undefined ? undefined : 'self_reported'
      )
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
        expect(tool.inputSchema?.properties).toHaveProperty('llm_model')
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
      const client = new PostHogMCP('test', {
        disabled: true,
        captureModel: false,
        enableConversationId: false,
      })
      const prepared = client.prepareToolList(tools, { context: false })
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

    it('injects and extracts a self-reported model when captureModel is enabled', async () => {
      const client = newClient({ captureModel: true })
      try {
        const prepared = client.prepareToolList(tools)
        expect(prepared[0].inputSchema?.properties?.llm_model).toMatchObject({ type: 'string' })
        expect(prepared[0].inputSchema?.required).toContain('llm_model')

        const call = client.prepareToolCall('execute-sql', {
          query: 'select 1',
          context: 'Counting signups',
          llm_model: 'claude-sonnet-4-20250514',
        })
        expect(call.args).toEqual({ query: 'select 1' })
        expect(call.llmModel).toBe('claude-sonnet-4-20250514')
        expect(call.llmModelSource).toBe('self_reported')

        client.captureToolCall({
          toolName: 'execute-sql',
          distinctId: 'user-123',
          isError: false,
          llmModel: call.llmModel,
          llmModelSource: call.llmModelSource,
        })
        await tick()

        const properties = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall).properties
        expect(properties[PostHogMCPAnalyticsProperty.LlmModel]).toBe('claude-sonnet-4-20250514')
        expect(properties[PostHogMCPAnalyticsProperty.LlmModelSource]).toBe('self_reported')
      } finally {
        await client.shutdown()
      }
    })

    it('leaves an application-owned llm_model argument untouched and uncaptured', async () => {
      const client = newClient({ captureModel: true })
      const ownedTools = [
        {
          name: 'route-model',
          inputSchema: {
            type: 'object',
            properties: { llm_model: { type: 'string', description: 'Application routing model' } },
            required: ['llm_model'],
          },
        },
      ]
      try {
        const prepared = client.prepareToolList(ownedTools)
        expect(prepared[0].inputSchema.properties.llm_model).toEqual({
          type: 'string',
          description: 'Application routing model',
        })

        const call = client.prepareToolCall('route-model', { llm_model: 'application-owned-value' })
        expect(call.args).toEqual({ llm_model: 'application-owned-value' })
        expect(call.llmModel).toBeUndefined()
        expect(call.llmModelSource).toBeUndefined()
      } finally {
        await client.shutdown()
      }
    })

    it('captures a Codex metadata model without taking an application-owned llm_model argument', async () => {
      const client = newClient({ captureModel: true })
      const ownedTool = {
        name: 'route-model',
        inputSchema: {
          type: 'object',
          properties: { llm_model: { type: 'string', description: 'Application routing model' } },
          required: ['llm_model'],
        },
      }
      try {
        client.prepareToolList([ownedTool])
        const call = client.prepareToolCall(
          'route-model',
          { llm_model: 'application-owned-value' },
          {
            originalTool: ownedTool,
            requestMeta: { 'x-codex-turn-metadata': { model: 'gpt-5.6-sol' } },
          }
        )

        expect(call.args).toEqual({ llm_model: 'application-owned-value' })
        expect(call.llmModel).toBe('gpt-5.6-sol')
        expect(call.llmModelSource).toBe('client_metadata')
      } finally {
        await client.shutdown()
      }
    })

    it('skips model injection for duplicate names when any descriptor owns llm_model', async () => {
      const client = newClient({ captureModel: true })
      const duplicateTools = [
        tools[0],
        {
          name: 'execute-sql',
          inputSchema: {
            type: 'object',
            properties: { llm_model: { type: 'string' } },
            required: ['llm_model'],
          },
        },
      ]
      try {
        const prepared = client.prepareToolList(duplicateTools)
        expect(prepared[0].inputSchema.properties).not.toHaveProperty('llm_model')
        expect(prepared[1].inputSchema.properties.llm_model).toEqual({ type: 'string' })

        const call = client.prepareToolCall('execute-sql', { llm_model: 'application-owned-value' })
        expect(call.args).toEqual({ llm_model: 'application-owned-value' })
        expect(call.llmModel).toBeUndefined()
      } finally {
        await client.shutdown()
      }
    })

    it('drops an unknown self-reported model', async () => {
      const client = newClient({ captureModel: true })
      try {
        client.prepareToolList(tools)
        const call = client.prepareToolCall('execute-sql', { query: 'select 1', llm_model: ' unknown ' })
        expect(call.args).toEqual({ query: 'select 1' })
        expect(call.llmModel).toBeUndefined()
        expect(call.llmModelSource).toBeUndefined()
      } finally {
        await client.shutdown()
      }
    })

    it('forgets ownership for tools removed from a refreshed list', async () => {
      const client = newClient({ captureModel: true })
      try {
        client.prepareToolList(tools)
        client.prepareToolList([tools[1]])

        const call = client.prepareToolCall('execute-sql', { llm_model: 'application-owned-value' })
        expect(call.args).toEqual({ llm_model: 'application-owned-value' })
        expect(call.llmModel).toBeUndefined()
        expect(call.llmModelSource).toBeUndefined()
      } finally {
        await client.shutdown()
      }
    })

    it.each([
      {
        name: 'strips an SDK-owned model argument',
        originalTool: tools[0],
        expectedArgs: { query: 'select 1' },
        expectedModel: 'claude-sonnet-4-20250514',
      },
      {
        name: 'preserves an application-owned model argument',
        originalTool: {
          name: 'route-model',
          inputSchema: {
            type: 'object',
            properties: { llm_model: { type: 'string' } },
            required: ['llm_model'],
          },
        },
        expectedArgs: { query: 'select 1', llm_model: 'claude-sonnet-4-20250514' },
        expectedModel: undefined,
      },
    ])(
      '$name from the original schema without prior list preparation',
      async ({ originalTool, expectedArgs, expectedModel }) => {
        const client = newClient({ captureModel: true })
        try {
          const call = client.prepareToolCall(
            originalTool.name,
            { query: 'select 1', llm_model: 'claude-sonnet-4-20250514' },
            { originalTool }
          )

          expect(call.args).toEqual(expectedArgs)
          expect(call.llmModel).toBe(expectedModel)
          expect(call.llmModelSource).toBe(expectedModel ? 'self_reported' : undefined)
        } finally {
          await client.shutdown()
        }
      }
    )
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

  describe('conversation correlation', () => {
    const conversationId = '0198ef20-1234-7abc-8def-123456789abc'
    const tools = [
      {
        name: 'execute-sql',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { rows: { type: 'array' } }, additionalProperties: false },
      },
    ]

    it('adds conversation schemas by default without mutating the source tool', () => {
      const prepared = posthog.prepareToolList(tools)

      expect(prepared[0].inputSchema.properties.conversation_id).toMatchObject({ type: 'string' })
      expect(prepared[0].inputSchema.required).not.toContain('conversation_id')
      expect(prepared[0].outputSchema.properties[MCP_INSTRUCTIONS_KEY]).toMatchObject({ type: 'object' })
      expect(tools[0].inputSchema.properties).not.toHaveProperty('conversation_id')
      expect(tools[0].outputSchema.properties).not.toHaveProperty(MCP_INSTRUCTIONS_KEY)
    })

    it('leaves schemas, arguments, and results unchanged when disabled', async () => {
      const client = newClient({ enableConversationId: false })
      try {
        const preparedTools = client.prepareToolList(tools)
        expect(preparedTools[0].inputSchema.properties).not.toHaveProperty('conversation_id')
        expect(preparedTools[0].outputSchema.properties).not.toHaveProperty(MCP_INSTRUCTIONS_KEY)

        const rawArgs = { query: 'select 1', conversation_id: conversationId }
        const preparedCall = client.prepareToolCall('execute-sql', rawArgs)
        const toolResult = { content: [], structuredContent: { rows: [] } }
        const preparedResult = client.prepareToolResult(toolResult, preparedCall)

        expect(preparedCall.args).toEqual(rawArgs)
        expect(preparedCall.sessionId).toBeUndefined()
        expect(preparedCall.conversationId).toBeUndefined()
        expect(preparedResult).toEqual({ result: toolResult, sessionId: undefined, conversationId: undefined })
        expect(preparedResult.result).toBe(toolResult)
      } finally {
        await client.shutdown()
      }
    })

    it('preserves application-owned fields and fails closed for duplicate names', () => {
      const applicationOwned = {
        name: 'execute-sql',
        inputSchema: {
          type: 'object',
          properties: { conversation_id: { type: 'string', description: 'Application value' } },
        },
        outputSchema: {
          type: 'object',
          properties: { [MCP_INSTRUCTIONS_KEY]: { type: 'string', description: 'Application value' } },
        },
      }
      const prepared = posthog.prepareToolList([tools[0], applicationOwned])

      expect(prepared[0].inputSchema.properties).not.toHaveProperty('conversation_id')
      expect(prepared[1].inputSchema.properties.conversation_id).toEqual({
        type: 'string',
        description: 'Application value',
      })
      expect(prepared[0].outputSchema.properties).not.toHaveProperty(MCP_INSTRUCTIONS_KEY)
      expect(prepared[1].outputSchema.properties[MCP_INSTRUCTIONS_KEY]).toEqual({
        type: 'string',
        description: 'Application value',
      })

      const preparedCall = posthog.prepareToolCall('execute-sql', { conversation_id: conversationId })
      expect(preparedCall.args).toEqual({ conversation_id: conversationId })
      expect(preparedCall.conversationId).toBeUndefined()
    })

    it('uses the original tool without prior list preparation', async () => {
      const client = newClient()
      try {
        const preparedCall = client.prepareToolCall(
          'execute-sql',
          { query: 'select 1', conversation_id: conversationId },
          { originalTool: tools[0] }
        )

        expect(preparedCall.args).toEqual({ query: 'select 1' })
        expect(preparedCall.conversationId).toBe(conversationId)
        expect(preparedCall.sessionId).toBe(deriveSessionIdFromConversation(conversationId))
      } finally {
        await client.shutdown()
      }
    })

    it('mints UUIDv7 handles and derives stable sessions across clients', async () => {
      posthog.prepareToolList(tools)
      const minted = posthog.prepareToolCall('execute-sql', { query: 'select 1', conversation_id: 'invalid' })
      expect(minted.conversationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(minted.args).toEqual({ query: 'select 1' })
      expect(minted.sessionId).toBe(deriveSessionIdFromConversation(minted.conversationId!))

      const client = newClient()
      try {
        const first = posthog.prepareToolCall('execute-sql', { conversation_id: conversationId })
        const echoed = client.prepareToolCall(
          'execute-sql',
          { conversation_id: conversationId.toUpperCase() },
          { originalTool: tools[0] }
        )
        expect(echoed.conversationId).toBe(conversationId)
        expect(echoed.sessionId).toBe(first.sessionId)
        expect(echoed.sessionId).toBe(deriveSessionIdFromConversation(conversationId))
      } finally {
        await client.shutdown()
      }
    })

    it('keeps a carried session unless the client echoes a valid handle', () => {
      posthog.prepareToolList(tools)
      const carried = posthog.prepareToolCall('execute-sql', {}, { sessionId: 'ses_carried' })
      expect(carried).toMatchObject({ sessionId: 'ses_carried', conversationId: undefined })

      const echoed = posthog.prepareToolCall(
        'execute-sql',
        { conversation_id: conversationId },
        { sessionId: 'ses_carried' }
      )
      expect(echoed.sessionId).toBe(deriveSessionIdFromConversation(conversationId))
      expect(echoed.conversationId).toBe(conversationId)
    })

    it('delivers a minted handle through text and structured content without mutation', () => {
      posthog.prepareToolList(tools)
      const preparedCall = posthog.prepareToolCall('execute-sql', { query: 'select 1' })
      const toolResult = { content: [{ type: 'text', text: 'done' }], structuredContent: { rows: [] } }
      const prepared = posthog.prepareToolResult(toolResult, preparedCall)

      expect(prepared.result).not.toBe(toolResult)
      expect(toolResult).toEqual({ content: [{ type: 'text', text: 'done' }], structuredContent: { rows: [] } })
      expect(prepared.result.content.at(-1)).toEqual({
        type: 'text',
        text: JSON.stringify({ conversation_id: preparedCall.conversationId }),
      })
      expect(prepared.result.structuredContent[MCP_INSTRUCTIONS_KEY]).toEqual({
        conversation_id: preparedCall.conversationId,
      })
      expect(prepared.conversationId).toBe(preparedCall.conversationId)
    })

    it('preserves application-owned structured instructions', () => {
      const tool = {
        ...tools[0],
        outputSchema: {
          type: 'object',
          properties: { [MCP_INSTRUCTIONS_KEY]: { type: 'string' } },
        },
      }
      posthog.prepareToolList([tool])
      const preparedCall = posthog.prepareToolCall('execute-sql', {})
      const prepared = posthog.prepareToolResult(
        { content: [], structuredContent: { [MCP_INSTRUCTIONS_KEY]: 'application-value' } },
        preparedCall
      )

      expect(prepared.result.structuredContent[MCP_INSTRUCTIONS_KEY]).toBe('application-value')
      expect(prepared.conversationId).toBe(preparedCall.conversationId)
    })

    it('delivers a minted handle on error results', () => {
      posthog.prepareToolList(tools)
      const preparedCall = posthog.prepareToolCall('execute-sql', {})
      const prepared = posthog.prepareToolResult({ content: [], isError: true }, preparedCall)

      expect(prepared.result.isError).toBe(true)
      expect(prepared.result.content).toContainEqual({
        type: 'text',
        text: JSON.stringify({ conversation_id: preparedCall.conversationId }),
      })
      expect(prepared.conversationId).toBe(preparedCall.conversationId)
    })

    it('omits an undelivered minted handle from capture but keeps its session', () => {
      posthog.prepareToolList(tools)
      const preparedCall = posthog.prepareToolCall('execute-sql', {})
      const toolResult = { value: 1 }
      const prepared = posthog.prepareToolResult(toolResult, preparedCall)

      expect(prepared.result).toBe(toolResult)
      expect(prepared.conversationId).toBeUndefined()
      expect(prepared.sessionId).toBe(preparedCall.sessionId)
    })

    it('adds conversation fields to virtual tools', () => {
      const prepared = posthog.prepareToolList([], { reportMissing: true })
      const virtualTool = prepared.find((tool) => tool.name === GET_MORE_TOOLS_NAME)
      const preparedCall = posthog.prepareToolCall(GET_MORE_TOOLS_NAME, { context: 'Find a tool' })
      const preparedResult = posthog.prepareToolResult(getMoreToolsResult(), preparedCall)

      expect(virtualTool?.inputSchema?.properties?.conversation_id).toMatchObject({ type: 'string' })
      expect(preparedResult.result.content.at(-1)).toEqual({
        type: 'text',
        text: JSON.stringify({ conversation_id: preparedCall.conversationId }),
      })
    })

    it('captures the finalized conversation and session properties', async () => {
      posthog.prepareToolList(tools)
      const preparedCall = posthog.prepareToolCall('execute-sql', {})
      const prepared = posthog.prepareToolResult({ content: [] }, preparedCall)
      posthog.captureToolCall({
        toolName: 'execute-sql',
        distinctId: 'user-123',
        sessionId: prepared.sessionId,
        conversationId: prepared.conversationId,
        isError: false,
      })
      await tick()

      const properties = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall).properties
      expect(properties[PostHogMCPAnalyticsProperty.ConversationId]).toBe(prepared.conversationId)
      expect(properties[PostHogMCPAnalyticsProperty.SessionId]).toBe(prepared.sessionId)
    })
  })

  describe('captureMissingCapability', () => {
    it('emits $mcp_missing_capability with the context and model', async () => {
      posthog.captureMissingCapability({
        context: 'I need a tool to delete cohorts',
        distinctId: 'user-123',
        llmModel: 'claude-sonnet-4-20250514',
        llmModelSource: 'self_reported',
      })
      await tick()

      const payload = onlyCapture(PostHogMCPAnalyticsEvent.MissingCapability)
      const p = payload.properties
      expect(p[PostHogMCPAnalyticsProperty.Intent]).toBe('I need a tool to delete cohorts')
      expect(p[PostHogMCPAnalyticsProperty.IntentSource]).toBe('context_parameter')
      expect(p[PostHogMCPAnalyticsProperty.LlmModel]).toBe('claude-sonnet-4-20250514')
      expect(p[PostHogMCPAnalyticsProperty.LlmModelSource]).toBe('self_reported')
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

    it('stamps $mcp_protocol_version on later captures too (passed per call, like sessionId)', async () => {
      // The client holds no per-session state, so callers pass protocolVersion on
      // every capture — not just initialize — to satisfy the every-event contract.
      posthog.captureToolCall({
        toolName: 'execute-sql',
        protocolVersion: '2025-06-18',
        distinctId: 'user-123',
        isError: false,
      })
      await tick()

      const p = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall).properties
      expect(p[PostHogMCPAnalyticsProperty.ProtocolVersion]).toBe('2025-06-18')
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
