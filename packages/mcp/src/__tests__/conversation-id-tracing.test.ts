import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { track } from '../index'
import type { HighLevelMCPServerLike } from '../types'
import { EventCapture } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

describe('conversation_id tool parameter', () => {
  let server: HighLevelMCPServerLike
  let client: any
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    resetTodos()
    const setup = await setupTestServerAndClient()
    server = setup.server
    client = setup.client
    cleanup = setup.cleanup
  })

  afterEach(async () => {
    await cleanup()
  })

  describe('tools/list schema injection', () => {
    it('adds an optional conversation_id parameter to every tool when enabled', async () => {
      track(server, { apiKey: 'phc_test', enableConversationId: true })

      const result = await client.request({ method: 'tools/list' }, ListToolsResultSchema)

      for (const tool of result.tools) {
        const schema = tool.inputSchema as {
          properties: Record<string, { type: string }>
          required?: string[]
        }
        expect(schema.properties.conversation_id).toBeDefined()
        expect(schema.properties.conversation_id.type).toBe('string')
        expect(schema.required ?? []).not.toContain('conversation_id')
      }
    })

    it('does not inject when enableConversationId is false', async () => {
      track(server, { apiKey: 'phc_test', enableConversationId: false })

      const result = await client.request({ method: 'tools/list' }, ListToolsResultSchema)

      for (const tool of result.tools) {
        const schema = tool.inputSchema as {
          properties: Record<string, unknown>
        }
        expect(schema.properties.conversation_id).toBeUndefined()
      }
    })
  })

  describe('tools/call conversation_id propagation', () => {
    it('captures the agent-supplied conversation_id verbatim on the event', async () => {
      const capture = new EventCapture()
      await capture.start()
      track(server, { apiKey: 'phc_test', enableConversationId: true })

      const agentConversationId = 'conversation-abc-1'
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: { text: 'first', conversation_id: agentConversationId },
          },
        },
        CallToolResultSchema
      )

      await new Promise((r) => setTimeout(r, 50))
      const toolCall = capture.getEvents().find((e) => e.resourceName === 'add_todo')
      expect(toolCall?.conversationId).toBe(agentConversationId)
      await capture.stop()
    })

    it('mints a conversation_id and appends a prompt-back text block when the agent omits it', async () => {
      track(server, { apiKey: 'phc_test', enableConversationId: true })

      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: { text: 'first' },
          },
        },
        CallToolResultSchema
      )

      const promptBack = result.content.find(
        (c) => c.type === 'text' && typeof c.text === 'string' && c.text.includes('conversation_id=')
      )
      expect(promptBack).toBeDefined()
    })

    it('sets event.conversationId on the captured event when minted', async () => {
      const capture = new EventCapture()
      await capture.start()

      track(server, { apiKey: 'phc_test', enableConversationId: true })

      await client.request(
        {
          method: 'tools/call',
          params: { name: 'add_todo', arguments: { text: 'x' } },
        },
        CallToolResultSchema
      )

      await new Promise((r) => setTimeout(r, 50))
      const toolCall = capture.getEvents().find((e) => e.resourceName === 'add_todo')
      expect(toolCall).toBeDefined()
      expect(typeof toolCall?.conversationId).toBe('string')
      expect(toolCall?.conversationId?.length).toBeGreaterThan(0)
      await capture.stop()
    })

    it('sets event.conversationId on the captured event when agent supplies one', async () => {
      const capture = new EventCapture()
      await capture.start()

      track(server, { apiKey: 'phc_test', enableConversationId: true })

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: { text: 'x', conversation_id: 'agent-supplied-1' },
          },
        },
        CallToolResultSchema
      )

      await new Promise((r) => setTimeout(r, 50))
      const toolCall = capture.getEvents().find((e) => e.resourceName === 'add_todo')
      expect(toolCall?.conversationId).toBe('agent-supplied-1')
      await capture.stop()
    })

    it('does not inject the prompt-back into error results', async () => {
      track(server, { apiKey: 'phc_test', enableConversationId: true })

      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'complete_todo',
            arguments: { id: 'does-not-exist' },
          },
        },
        CallToolResultSchema
      )

      const hasPromptBack = (result.content ?? []).some(
        (c) => c.type === 'text' && typeof c.text === 'string' && c.text.includes('conversation_id=')
      )
      expect(hasPromptBack).toBe(false)
    })

    it('clears event.conversationId on error when we minted it (agent never received it)', async () => {
      const capture = new EventCapture()
      await capture.start()
      track(server, { apiKey: 'phc_test', enableConversationId: true })

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'complete_todo',
            arguments: { id: 'does-not-exist' },
          },
        },
        CallToolResultSchema
      )

      await new Promise((r) => setTimeout(r, 50))
      const toolCall = capture.getEvents().find((e) => e.resourceName === 'complete_todo')
      expect(toolCall).toBeDefined()
      expect(toolCall?.conversationId).toBeUndefined()
      await capture.stop()
    })

    it('keeps event.conversationId on error when the agent supplied it', async () => {
      const capture = new EventCapture()
      await capture.start()
      track(server, { apiKey: 'phc_test', enableConversationId: true })

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'complete_todo',
            arguments: {
              id: 'does-not-exist',
              conversation_id: 'agent-supplied-on-error',
            },
          },
        },
        CallToolResultSchema
      )

      await new Promise((r) => setTimeout(r, 50))
      const toolCall = capture.getEvents().find((e) => e.resourceName === 'complete_todo')
      expect(toolCall?.conversationId).toBe('agent-supplied-on-error')
      await capture.stop()
    })
  })
})
