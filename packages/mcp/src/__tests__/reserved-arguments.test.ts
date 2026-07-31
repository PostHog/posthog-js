import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { instrument } from '../index'
import { fakePostHog } from './test-utils'

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

  it('recomputes ownership after a schema-only tool update', async () => {
    const server = new McpServer({ name: 'updated-reserved-arguments', version: '1.0.0' })
    const receivedArgs: Record<string, unknown>[] = []

    const registeredTool = server.registerTool(
      'updated_schema',
      { inputSchema: z.object({ value: z.string() }).passthrough() },
      async (args) => {
        receivedArgs.push({ ...args })
        return { content: [{ type: 'text', text: 'ok' }] }
      }
    )

    const { client, cleanup } = await connect(server)
    try {
      instrument(server, fakePostHog(), { context: true, enableConversationId: true })

      const argumentsWithReservedFields = {
        context: 'supplied context',
        conversation_id: 'supplied conversation',
        value: 'kept',
      }
      await client.request(
        { method: 'tools/call', params: { name: 'updated_schema', arguments: argumentsWithReservedFields } },
        CallToolResultSchema
      )

      registeredTool.update({
        paramsSchema: {
          context: z.string(),
          conversation_id: z.string(),
          value: z.string(),
        },
      })

      await client.request(
        { method: 'tools/call', params: { name: 'updated_schema', arguments: argumentsWithReservedFields } },
        CallToolResultSchema
      )

      expect(receivedArgs).toEqual([
        { value: 'kept' },
        {
          context: 'supplied context',
          conversation_id: 'supplied conversation',
          value: 'kept',
        },
      ])
    } finally {
      await cleanup()
    }
  })

  it('preserves pre-existing reserved fields and strips only fields injected by analytics', async () => {
    const server = new McpServer({ name: 'owned-reserved-arguments', version: '1.0.0' })
    const receivedArgs = new Map<string, Record<string, unknown>>()
    const result = { content: [{ type: 'text' as const, text: 'ok' }] }

    server.registerTool(
      'existing_context',
      {
        inputSchema: z.object({ context: z.string().describe('Application context'), value: z.string() }).passthrough(),
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
      for (const name of ['existing_context', 'existing_conversation_id', 'analytics_owned']) {
        const tool = listResult.tools.find((candidate) => candidate.name === name)
        expect(tool?.inputSchema.properties?.context).toBeDefined()
        expect(tool?.inputSchema.properties?.conversation_id).toBeDefined()
      }

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
