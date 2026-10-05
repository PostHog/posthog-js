import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { z as z4 } from 'zod4'
import { DEFAULT_CONTEXT_PARAMETER_DESCRIPTION, DEFAULT_CONVERSATION_ID_DESCRIPTION } from '../extensions/constants'
import { instrument } from '../index'
import { EventCapture, fakePostHog } from './test-utils'

async function connect(server: McpServer | Server) {
  const client = new Client({ name: 'reserved-argument-test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const lowLevelServer = server instanceof McpServer ? server.server : server
  await Promise.all([client.connect(clientTransport), lowLevelServer.connect(serverTransport)])

  return {
    client,
    async cleanup() {
      await clientTransport.close?.()
      await serverTransport.close?.()
    },
  }
}

/** Shaped like a handle we would have minted, so it is echoed rather than replaced. */
const ANALYTICS_CONVERSATION = '019fd2b0-3333-7333-8333-333333333333'

describe('high-level reserved analytics arguments', () => {
  it('passes legitimate context and conversation_id fields to the callback when both features are disabled', async () => {
    const server = new McpServer({ name: 'disabled-reserved-arguments', version: '1.0.0' })
    let receivedArgs: Record<string, unknown> | undefined

    server.registerTool(
      'reserved_fields',
      {
        inputSchema: z.object({
          context: z.string(),
          conversation_id: z.string(),
          value: z.string(),
        }),
      },
      async (args) => {
        receivedArgs = { ...args }
        return { content: [{ type: 'text', text: 'ok' }] }
      }
    )

    const { client, cleanup } = await connect(server)
    try {
      instrument(server, fakePostHog(), { context: false, enableConversationId: false })

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'reserved_fields',
            arguments: { context: 'tool context', conversation_id: 'tool conversation', value: 'kept' },
          },
        },
        CallToolResultSchema
      )

      expect(receivedArgs).toEqual({
        context: 'tool context',
        conversation_id: 'tool conversation',
        value: 'kept',
      })
    } finally {
      await cleanup()
    }
  })

  it('strips analytics arguments injected into a non-object Zod schema', async () => {
    const server = new McpServer({ name: 'record-schema-reserved-arguments', version: '1.0.0' })
    let receivedArgs: Record<string, string> | undefined

    server.registerTool('record_schema', { inputSchema: z.record(z.string()) }, async (args) => {
      receivedArgs = { ...args }
      return { content: [{ type: 'text', text: 'ok' }] }
    })

    const { client, cleanup } = await connect(server)
    try {
      instrument(server, fakePostHog(), { context: true, enableConversationId: true })

      const listResult = await client.request({ method: 'tools/list' }, ListToolsResultSchema)
      const tool = listResult.tools.find((candidate) => candidate.name === 'record_schema')
      expect(tool?.inputSchema.properties?.context).toBeDefined()
      expect(tool?.inputSchema.properties?.conversation_id).toBeDefined()

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'record_schema',
            arguments: { context: 'analytics context', conversation_id: ANALYTICS_CONVERSATION, value: 'kept' },
          },
        },
        CallToolResultSchema
      )

      expect(receivedArgs).toEqual({ value: 'kept' })
    } finally {
      await cleanup()
    }
  })

  it('strips analytics-owned arguments before strict Zod validation', async () => {
    const server = new McpServer({ name: 'strict-reserved-arguments', version: '1.0.0' })
    let receivedArgs: Record<string, unknown> | undefined
    const capture = new EventCapture()
    await capture.start()

    server.registerTool('strict_schema', { inputSchema: z.object({ value: z.string() }).strict() }, async (args) => {
      receivedArgs = { ...args }
      return { content: [{ type: 'text', text: 'ok' }] }
    })

    const { client, cleanup } = await connect(server)
    try {
      instrument(server, fakePostHog(), { context: true, enableConversationId: true })

      const response = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'strict_schema',
            arguments: { context: 'analytics context', conversation_id: ANALYTICS_CONVERSATION, value: 'kept' },
          },
        },
        CallToolResultSchema
      )

      expect(response.isError).not.toBe(true)
      expect(receivedArgs).toEqual({ value: 'kept' })
      await new Promise((resolve) => setTimeout(resolve, 50))
      const event = capture.getEvents().find((candidate) => candidate.resourceName === 'strict_schema')
      expect(event?.userIntent).toBe('analytics context')
      expect(event?.conversationId).toBe(ANALYTICS_CONVERSATION)
    } finally {
      await capture.stop()
      await cleanup()
    }
  })

  it.each(['context', 'conversation_id'] as const)(
    'does not consume a tool-owned %s argument as analytics metadata',
    async (reservedArgument) => {
      const server = new McpServer({ name: 'tool-owned-analytics-arguments', version: '1.0.0' })
      const toolName = `tool_owned_${reservedArgument}`
      let receivedArgs: Record<string, unknown> | undefined
      const capture = new EventCapture()
      await capture.start()

      server.registerTool(
        toolName,
        { inputSchema: z.object({ [reservedArgument]: z.string(), value: z.string() }).strict() },
        async (args) => {
          receivedArgs = { ...args }
          return { content: [{ type: 'text', text: 'ok' }] }
        }
      )

      const { client, cleanup } = await connect(server)
      try {
        instrument(server, fakePostHog(), {
          context: reservedArgument === 'context',
          enableConversationId: reservedArgument === 'conversation_id',
        })

        const suppliedArguments = { [reservedArgument]: 'application value', value: 'kept' }
        const result = await client.request(
          {
            method: 'tools/call',
            params: { name: toolName, arguments: suppliedArguments },
          },
          CallToolResultSchema
        )
        expect(result.content).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('"conversation_id"') })])
        )

        expect(receivedArgs).toEqual(suppliedArguments)
        await new Promise((resolve) => setTimeout(resolve, 50))
        const events = capture.getEvents().filter((candidate) => candidate.resourceName === toolName)
        expect(events).toHaveLength(1)
        expect(events[0].userIntent).toBeUndefined()
        expect(events[0].conversationId).toBeUndefined()
      } finally {
        await capture.stop()
        await cleanup()
      }
    }
  )

  it('preserves pre-existing reserved fields and strips only fields injected by analytics', async () => {
    const server = new McpServer({ name: 'owned-reserved-arguments', version: '1.0.0' })
    const receivedArgs = new Map<string, Record<string, unknown>>()
    const result = { content: [{ type: 'text' as const, text: 'ok' }] }

    server.registerTool(
      'existing_context',
      {
        inputSchema: {
          properties: z.string().optional(),
          context: z.string().describe('Application context'),
          value: z.string(),
        },
      },
      async (args) => {
        receivedArgs.set('existing_context', { ...args })
        return result
      }
    )
    server.registerTool(
      'existing_conversation_id',
      {
        inputSchema: z
          .object({ conversation_id: z.string().describe('Application conversation'), value: z.string() })
          .passthrough(),
      },
      async (args) => {
        receivedArgs.set('existing_conversation_id', { ...args })
        return result
      }
    )
    server.registerTool(
      'analytics_owned',
      { inputSchema: z.object({ value: z.string() }).passthrough() },
      async (args) => {
        receivedArgs.set('analytics_owned', { ...args })
        return result
      }
    )

    const { client, cleanup } = await connect(server)
    try {
      instrument(server, fakePostHog(), { context: true, enableConversationId: true })

      const listResult = await client.request({ method: 'tools/list' }, ListToolsResultSchema)
      const listedTools = new Map(listResult.tools.map((tool) => [tool.name, tool]))
      expect(listedTools.get('existing_context')?.inputSchema.properties?.context).toMatchObject({
        description: 'Application context',
      })
      expect(listedTools.get('existing_context')?.inputSchema.properties?.conversation_id).toMatchObject({
        description: DEFAULT_CONVERSATION_ID_DESCRIPTION,
      })
      expect(listedTools.get('existing_context')?.inputSchema.properties?.properties).toBeDefined()
      expect(listedTools.get('existing_conversation_id')?.inputSchema.properties?.context).toMatchObject({
        description: DEFAULT_CONTEXT_PARAMETER_DESCRIPTION,
      })
      expect(listedTools.get('existing_conversation_id')?.inputSchema.properties?.conversation_id).toMatchObject({
        description: 'Application conversation',
      })
      expect(listedTools.get('analytics_owned')?.inputSchema.properties?.context).toMatchObject({
        description: DEFAULT_CONTEXT_PARAMETER_DESCRIPTION,
      })
      expect(listedTools.get('analytics_owned')?.inputSchema.properties?.conversation_id).toMatchObject({
        description: DEFAULT_CONVERSATION_ID_DESCRIPTION,
      })

      const suppliedArguments = {
        context: 'supplied context',
        conversation_id: 'supplied conversation',
        value: 'kept',
      }
      for (const name of ['existing_context', 'existing_conversation_id', 'analytics_owned']) {
        await client.request(
          { method: 'tools/call', params: { name, arguments: suppliedArguments } },
          CallToolResultSchema
        )
      }

      expect(receivedArgs.get('existing_context')).toEqual({
        context: 'supplied context',
        value: 'kept',
      })
      expect(receivedArgs.get('existing_conversation_id')).toEqual({
        conversation_id: 'supplied conversation',
        value: 'kept',
      })
      expect(receivedArgs.get('analytics_owned')).toEqual({ value: 'kept' })
    } finally {
      await cleanup()
    }
  })
})

describe('low-level reserved analytics arguments on a fresh instance', () => {
  const STRICT_SCHEMAS: Record<string, z.ZodTypeAny> = {
    strict_schema: z.object({ value: z.string() }).strict(),
    declares_context: z.object({ context: z.string(), value: z.string() }).strict(),
    union_context: z.union([
      z.object({ context: z.string(), value: z.string() }).strict(),
      z.object({ context: z.string(), other: z.string() }).strict(),
    ]),
    union4_context: z4.union([
      z4.object({ context: z4.string(), value: z4.string() }).strict(),
      z4.object({ context: z4.string(), other: z4.string() }).strict(),
    ]) as unknown as z.ZodTypeAny,
    intersection_context: z.intersection(z.object({ context: z.string() }), z.object({ value: z.string() })),
    record_schema: z.record(z.string()),
  }

  async function callFreshInstance(
    toolName: string,
    args: Record<string, unknown>,
    options: Parameters<typeof instrument>[2] = {}
  ) {
    const server = new Server({ name: 'fresh-low-level', version: '1.0.0' }, { capabilities: { tools: {} } })
    const received: unknown[] = []
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const parsed = STRICT_SCHEMAS[request.params.name].safeParse(request.params.arguments ?? {})
      if (!parsed.success) {
        return { isError: true, content: [{ type: 'text' as const, text: parsed.error.issues[0].message }] }
      }
      received.push(parsed.data)
      return { content: [{ type: 'text' as const, text: 'ok' }] }
    })
    const capture = new EventCapture()
    await capture.start()
    const { client, cleanup } = await connect(server)
    try {
      instrument(server, fakePostHog(), { enableConversationId: false, ...options })
      const response = await client.request(
        { method: 'tools/call', params: { name: toolName, arguments: args } },
        CallToolResultSchema
      )
      await new Promise((resolve) => setTimeout(resolve, 50))
      const event = capture.getEvents().find((candidate) => candidate.resourceName === toolName)
      return { response, received, event }
    } finally {
      await capture.stop()
      await cleanup()
    }
  }

  const ANALYTICS_ARGS = { context: 'analytics context', llm_model: 'model-a', value: 'kept' }

  it('passes analytics arguments to a strict tool when ownership is unresolved', async () => {
    const { response, received, event } = await callFreshInstance('strict_schema', ANALYTICS_ARGS)

    expect(response.isError).toBe(true)
    expect(received).toEqual([])
    expect(event?.userIntent).toBe('analytics context')
  })

  it.each([
    ['a Zod 3 schema', STRICT_SCHEMAS.strict_schema],
    ['a Zod 4 schema', z4.object({ value: z4.string() }).strict()],
    ['a JSON Schema', { type: 'object', properties: { value: { type: 'string' } }, additionalProperties: false }],
  ])('strips analytics arguments when resolveOriginalTool returns %s', async (_label, inputSchema) => {
    const { response, received, event } = await callFreshInstance('strict_schema', ANALYTICS_ARGS, {
      resolveOriginalTool: () => ({ inputSchema }),
    })

    expect(response.isError).not.toBe(true)
    expect(received).toEqual([{ value: 'kept' }])
    expect(event?.userIntent).toBe('analytics context')
    expect(event?.llmModel).toBe('model-a')
  })

  it('keeps a context argument that the resolved tool declares', async () => {
    const { response, received, event } = await callFreshInstance(
      'declares_context',
      { context: 'tool context', value: 'kept' },
      { resolveOriginalTool: (toolName) => ({ inputSchema: STRICT_SCHEMAS[toolName] }) }
    )

    expect(response.isError).not.toBe(true)
    expect(received).toEqual([{ context: 'tool context', value: 'kept' }])
    expect(event?.userIntent).toBeUndefined()
  })

  it.each([
    [
      'a Zod 3 refinement',
      z
        .object({ context: z.string(), value: z.string() })
        .strict()
        .refine(({ value }) => value.length > 0),
    ],
    [
      'a Zod 4 refinement',
      z4
        .object({ context: z4.string(), value: z4.string() })
        .strict()
        .refine(({ value }) => value.length > 0),
    ],
  ])('keeps a required context argument declared behind %s', async (_label, inputSchema) => {
    const { response, received, event } = await callFreshInstance(
      'declares_context',
      { context: 'tool context', value: 'kept' },
      { resolveOriginalTool: () => ({ inputSchema }) }
    )

    expect(response.isError).not.toBe(true)
    expect(received).toEqual([{ context: 'tool context', value: 'kept' }])
    expect(event?.userIntent).toBeUndefined()
  })

  it.each([
    ['a Zod 3 union', 'union_context'],
    ['a Zod 4 union', 'union4_context'],
    ['a Zod 3 intersection', 'intersection_context'],
  ])('keeps a required context argument declared by %s', async (_label, toolName) => {
    const { response, received, event } = await callFreshInstance(
      toolName,
      { context: 'tool context', value: 'kept' },
      { resolveOriginalTool: (name) => ({ inputSchema: STRICT_SCHEMAS[name] }) }
    )

    expect(response.isError).not.toBe(true)
    expect(received).toEqual([{ context: 'tool context', value: 'kept' }])
    expect(event?.userIntent).toBeUndefined()
  })

  it('leaves ownership unresolved when the resolved schema has no object shape', async () => {
    const { response, received, event } = await callFreshInstance('record_schema', ANALYTICS_ARGS, {
      resolveOriginalTool: (name) => ({ inputSchema: STRICT_SCHEMAS[name] }),
    })

    expect(response.isError).not.toBe(true)
    expect(received).toEqual([ANALYTICS_ARGS])
    expect(event?.userIntent).toBe('analytics context')
    expect(event?.llmModel).toBe('model-a')
  })

  it.each([
    ['returns undefined', () => undefined, 0],
    [
      'throws',
      () => {
        throw new Error('registry unavailable')
      },
      1,
    ],
  ])(
    'falls back to unresolved ownership when resolveOriginalTool %s',
    async (_label, resolveOriginalTool, warnings) => {
      const logger = vi.fn()
      const { response, received, event } = await callFreshInstance('strict_schema', ANALYTICS_ARGS, {
        resolveOriginalTool,
        logger,
      })

      expect(response.isError).toBe(true)
      expect(received).toEqual([])
      expect(event?.userIntent).toBe('analytics context')
      expect(
        logger.mock.calls.filter(([message]) => String(message).includes('resolveOriginalTool failed'))
      ).toHaveLength(warnings)
    }
  )
})
