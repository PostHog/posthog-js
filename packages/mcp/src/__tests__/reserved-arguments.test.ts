import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { DEFAULT_CONTEXT_PARAMETER_DESCRIPTION, DEFAULT_CONVERSATION_ID_DESCRIPTION } from '../extensions/constants'
import { instrument } from '../index'
import { EventCapture, fakePostHog } from './test-utils'

async function connect(server: McpServer) {
  const client = new Client({ name: 'reserved-argument-test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.server.connect(serverTransport)])

  return {
    client,
    async cleanup() {
      await clientTransport.close?.()
      await serverTransport.close?.()
    },
  }
}

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
            arguments: { context: 'analytics context', conversation_id: 'analytics conversation', value: 'kept' },
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
            arguments: { context: 'analytics context', conversation_id: 'analytics conversation', value: 'kept' },
          },
        },
        CallToolResultSchema
      )

      expect(response.isError).not.toBe(true)
      expect(receivedArgs).toEqual({ value: 'kept' })
      await new Promise((resolve) => setTimeout(resolve, 50))
      const event = capture.getEvents().find((candidate) => candidate.resourceName === 'strict_schema')
      expect(event?.userIntent).toBe('analytics context')
      expect(event?.conversationId).toBe('analytics conversation')
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
          expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('conversation_id=') })])
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
