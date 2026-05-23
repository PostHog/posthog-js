import { DEFAULT_CONVERSATION_ID_DESCRIPTION } from '../extensions/constants'
import {
  addConversationIdToTool,
  addConversationIdToTools,
  buildConversationIdPromptBack,
  CONVERSATION_ID_PARAM_NAME,
  extractConversationId,
  injectConversationIdPromptBack,
  stripConversationId,
} from '../extensions/conversation-id'

describe('conversation-id', () => {
  describe('addConversationIdToTool', () => {
    it('adds an optional conversation_id property to a bare tool', () => {
      const result = addConversationIdToTool({
        name: 'tool',
        description: 'test',
      })

      const schema = result.inputSchema as {
        properties: Record<string, { type: string; description: string }>
        required?: string[]
      }

      expect(schema.properties.conversation_id.type).toBe('string')
      expect(schema.properties.conversation_id.description).toBe(DEFAULT_CONVERSATION_ID_DESCRIPTION)
      expect(schema.required ?? []).not.toContain('conversation_id')
    })

    it('preserves existing required fields and does not require conversation_id', () => {
      const result = addConversationIdToTool({
        name: 'tool',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      })
      const schema = result.inputSchema as {
        properties: Record<string, unknown>
        required: string[]
      }

      expect(schema.required).toContain('text')
      expect(schema.required).not.toContain('conversation_id')
      expect(schema.properties.conversation_id).toBeDefined()
    })

    it('strips additionalProperties:false so the new property is valid', () => {
      const result = addConversationIdToTool({
        name: 'tool',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      })
      const schema = result.inputSchema as { additionalProperties?: boolean }
      expect(schema.additionalProperties).toBeUndefined()
    })

    it('skips tools that already define conversation_id', () => {
      const original = {
        name: 'tool',
        inputSchema: {
          type: 'object',
          properties: {
            conversation_id: { type: 'number', description: 'preexisting' },
          },
        },
      }
      const result = addConversationIdToTool(original)
      const schema = result.inputSchema as {
        properties: Record<string, { type: string; description: string }>
      }
      expect(schema.properties.conversation_id.type).toBe('number')
      expect(schema.properties.conversation_id.description).toBe('preexisting')
    })

    it('skips complex schemas (oneOf/allOf/anyOf)', () => {
      for (const key of ['oneOf', 'allOf', 'anyOf']) {
        const result = addConversationIdToTool({
          name: `tool_${key}`,
          inputSchema: { [key]: [] } as never,
        })
        const schema = result.inputSchema as {
          properties?: Record<string, unknown>
        }
        expect(schema.properties?.conversation_id).toBeUndefined()
      }
    })

    it('does not mutate the original tool', () => {
      const original = {
        name: 'tool',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      }
      const snapshot = JSON.stringify(original)
      addConversationIdToTool(original)
      expect(JSON.stringify(original)).toBe(snapshot)
    })
  })

  describe('addConversationIdToTools', () => {
    it('skips the get_more_tools tool', () => {
      const tools = [
        { name: 'get_more_tools', description: 'report missing' },
        { name: 'other_tool', description: 'fine' },
      ]
      const result = addConversationIdToTools(tools)
      expect(result[0]).toBe(tools[0])
      expect(
        (
          result[1].inputSchema as {
            properties?: Record<string, unknown>
          }
        ).properties?.conversation_id
      ).toBeDefined()
    })
  })

  describe('extractConversationId', () => {
    it('returns trimmed non-empty string values', () => {
      expect(extractConversationId({ conversation_id: '  abc  ' })).toBe('abc')
    })

    it('returns undefined for missing, empty, or non-string values', () => {
      expect(extractConversationId(undefined)).toBeUndefined()
      expect(extractConversationId(null)).toBeUndefined()
      expect(extractConversationId({})).toBeUndefined()
      expect(extractConversationId({ conversation_id: '' })).toBeUndefined()
      expect(extractConversationId({ conversation_id: '   ' })).toBeUndefined()
      expect(extractConversationId({ conversation_id: 42 })).toBeUndefined()
    })
  })

  describe('stripConversationId', () => {
    it('returns args without conversation_id and leaves other keys intact', () => {
      const result = stripConversationId({
        conversation_id: 'abc',
        keep: 1,
      })
      expect(result).toEqual({ keep: 1 })
    })

    it('returns the args unchanged when conversation_id is absent', () => {
      const args = { keep: 1 }
      expect(stripConversationId(args)).toBe(args)
    })
  })

  describe('injectConversationIdPromptBack', () => {
    it('appends the prompt-back content block on a successful result', () => {
      const result = injectConversationIdPromptBack({ content: [{ type: 'text', text: 'hello' }] }, 'conv-123')
      const { content } = result as {
        content: Array<{ type: string; text: string }>
      }
      expect(content).toHaveLength(2)
      expect(content[1].type).toBe('text')
      expect(content[1].text).toContain('conversation_id=conv-123')
    })

    it('does not inject when result.isError is true', () => {
      const original = {
        isError: true,
        content: [{ type: 'text', text: 'oops' }],
      }
      expect(injectConversationIdPromptBack(original, 'conv-123')).toBe(original)
    })

    it('does not inject when content is missing or not an array', () => {
      expect(injectConversationIdPromptBack({}, 'conv-123')).toEqual({})
      expect(injectConversationIdPromptBack({ content: 'not-an-array' }, 'conv-123')).toEqual({
        content: 'not-an-array',
      })
    })

    it('does not inject on non-object results', () => {
      expect(injectConversationIdPromptBack(null, 'conv-123')).toBeNull()
      expect(injectConversationIdPromptBack('string', 'conv-123')).toBe('string')
    })
  })

  describe('buildConversationIdPromptBack', () => {
    it('references the conversation_id argument name', () => {
      const block = buildConversationIdPromptBack('xyz')
      expect(block.text).toContain(CONVERSATION_ID_PARAM_NAME)
      expect(block.text).toContain('xyz')
    })
  })
})
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
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
      instrument(server, { apiKey: 'phc_test', enableConversationId: true })

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
      instrument(server, { apiKey: 'phc_test', enableConversationId: false })

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
      instrument(server, { apiKey: 'phc_test', enableConversationId: true })

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
      instrument(server, { apiKey: 'phc_test', enableConversationId: true })

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

      instrument(server, { apiKey: 'phc_test', enableConversationId: true })

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

      instrument(server, { apiKey: 'phc_test', enableConversationId: true })

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
      instrument(server, { apiKey: 'phc_test', enableConversationId: true })

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
      instrument(server, { apiKey: 'phc_test', enableConversationId: true })

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
      instrument(server, { apiKey: 'phc_test', enableConversationId: true })

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
