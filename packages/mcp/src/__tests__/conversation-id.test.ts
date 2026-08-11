import { DEFAULT_CONVERSATION_ID_DESCRIPTION } from '../extensions/constants'
import {
  addConversationIdToTool,
  addConversationIdToTools,
  buildConversationIdContentBlock,
  CONVERSATION_ID_PARAM_NAME,
  extractConversationId,
  appendConversationIdToContent,
  resolveConversationId,
  stripConversationId,
} from '../extensions/conversation-id'
import { addConversationStateToOutputSchema } from '../extensions/conversation-state'

/**
 * Handles shaped like ones we would have minted — `resolveConversationId` only
 * echoes a value that could have come from us, and mints over anything else.
 */
const AGENT_ECHOED = '019fd2b0-1111-7111-8111-111111111111'
const AGENT_ECHOED_ON_ERROR = '019fd2b0-2222-7222-8222-222222222222'

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

    it('preserves a conversation_id property declared with a false schema', () => {
      const result = addConversationIdToTool({
        name: 'tool',
        inputSchema: { type: 'object', properties: { conversation_id: false } },
      })

      expect(result.inputSchema?.properties?.conversation_id).toBe(false)
    })

    it('skips a schema with a root $ref', () => {
      const result = addConversationIdToTool({
        name: 'referenced-tool',
        inputSchema: { $ref: '#/$defs/Input' },
      })

      expect(result.inputSchema).toEqual({ $ref: '#/$defs/Input' })
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
    it('injects into get_more_tools too, so capability gaps join their session', () => {
      const tools = [
        { name: 'get_more_tools', description: 'report missing' },
        { name: 'other_tool', description: 'fine' },
      ]
      const result = addConversationIdToTools(tools)
      expect(
        (result[0].inputSchema as { properties?: Record<string, unknown> }).properties?.conversation_id
      ).toBeDefined()
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

  describe('resolveConversationId', () => {
    const resolve = (args: unknown) => resolveConversationId(true, args)

    it('echoes a handle shaped like one we minted', () => {
      expect(resolve({ conversation_id: AGENT_ECHOED })).toEqual({
        minted: false,
        conversationId: AGENT_ECHOED,
      })
    })

    it('mints instead of trusting a value the agent invented', () => {
      // The reason this branch exists: the value becomes $session_id via a
      // deterministic hash, so two unrelated callers both sending `conv-1` would
      // otherwise be merged into a single session — across users and pods.
      for (const invented of ['conv-1', '1', 'session', 'chat_abc', 'not-a-uuid']) {
        const result = resolve({ conversation_id: invented })
        expect(result.minted).toBe(true)
        expect(result.conversationId).not.toBe(invented)
      }
    })

    it('mints a value that would itself be echoed back', () => {
      const { conversationId } = resolve({})
      expect(resolve({ conversation_id: conversationId })).toEqual({
        minted: false,
        conversationId,
      })
    })

    it('canonicalises an uppercased echo, so it hashes to the minting session', () => {
      // The shape test is case-insensitive; the hash behind `$session_id` is not.
      // A host that normalises uuids to uppercase must not be split off from the
      // call that minted the handle.
      const { conversationId } = resolve({ conversation_id: AGENT_ECHOED.toUpperCase() })
      expect(conversationId).toBe(AGENT_ECHOED)
    })

    it('rejects a uuid that is not v7', () => {
      // v4 in the version nibble. Nothing we mint looks like this, so it is a
      // value the agent brought from somewhere else.
      const v4 = '019fd2b0-1111-4111-8111-111111111111'
      expect(resolve({ conversation_id: v4 }).minted).toBe(true)
    })

    it('returns nothing when the feature is off', () => {
      expect(resolveConversationId(false, { conversation_id: AGENT_ECHOED })).toEqual({
        minted: false,
        conversationId: undefined,
      })
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

  describe('appendConversationIdToContent', () => {
    it('appends the handle content block on a successful result', () => {
      const result = appendConversationIdToContent({ content: [{ type: 'text', text: 'hello' }] }, 'conv-123')
      const { content } = result as {
        content: Array<{ type: string; text: string }>
      }
      expect(content).toHaveLength(2)
      expect(content[1].type).toBe('text')
      expect(content[1].text).toContain('conversation_id=conv-123')
    })

    it('injects into an errored result — the retry must land in the same conversation', () => {
      const original = {
        isError: true,
        content: [{ type: 'text', text: 'oops' }],
      }
      const result = appendConversationIdToContent(original, 'conv-123') as { content: { text: string }[] }
      expect(result.content).toHaveLength(2)
      expect(result.content[1].text).toContain('conv-123')
    })

    it('does not inject when content is missing or not an array', () => {
      expect(appendConversationIdToContent({}, 'conv-123')).toEqual({})
      expect(appendConversationIdToContent({ content: 'not-an-array' }, 'conv-123')).toEqual({
        content: 'not-an-array',
      })
    })

    it('does not inject on non-object results', () => {
      expect(appendConversationIdToContent(null, 'conv-123')).toBeNull()
      expect(appendConversationIdToContent('string', 'conv-123')).toBe('string')
    })
  })

  describe('buildConversationIdContentBlock', () => {
    it('references the conversation_id argument name', () => {
      const block = buildConversationIdContentBlock('xyz')
      expect(block.text).toContain(CONVERSATION_ID_PARAM_NAME)
      expect(block.text).toContain('xyz')
    })
  })

  /**
   * The invariant, as assertions: schemas are the trusted channel and may direct the
   * agent strictly; results are untrusted data and may only state facts. See ADR-0010.
   *
   * The split matters in both directions, and getting it backwards has already
   * happened once each way. Putting instructions in a *result* is the bug that
   * prompted this rewrite — clients refuse them, correctly. But sanding the
   * instructions out of a *schema* to match is the opposite error: it gives the agent
   * room to invent handles, fire parallel first calls, and generally drift, with
   * nothing left anywhere to stop it. The strictness has to live somewhere, and the
   * schema is where it is legitimate.
   */
  describe('agent-facing strings', () => {
    const declaredOutputSchema = addConversationStateToOutputSchema({
      name: 'tool',
      outputSchema: { type: 'object', properties: {} },
    }).outputSchema as {
      properties: Record<string, { properties: Record<string, { description: string }> }>
    }

    const SCHEMA_DESCRIPTIONS: Array<[string, string]> = [
      ['conversation_id parameter', DEFAULT_CONVERSATION_ID_DESCRIPTION],
      ...collectDescriptions('output schema', declaredOutputSchema),
    ]

    /**
     * The two descriptions that document the handle *value*, as opposed to the
     * `_conversation` wrapper around it. These are the ones that have to carry the
     * rules, since they are what an agent reads when deciding what to send back.
     */
    const HANDLE_DESCRIPTIONS: Array<[string, string]> = [
      ['conversation_id parameter', DEFAULT_CONVERSATION_ID_DESCRIPTION],
      [
        'output schema conversation_id field',
        declaredOutputSchema.properties._conversation.properties.conversation_id.description,
      ],
    ]
    const RESULT_STRINGS: Array<[string, string]> = [
      ['content block', buildConversationIdContentBlock('019fd2b0-3333-7333-8333-333333333333').text],
    ]
    const ALL = [...SCHEMA_DESCRIPTIONS, ...RESULT_STRINGS]

    /**
     * Results state facts. Every phrase here shipped in one: `[SERVER]:` impersonating
     * a privileged speaker, `Reuse` and `Read and follow` commanding the agent,
     * `Required` claiming a necessity that was untrue, `every subsequent` promising
     * something composed schemas cannot honour.
     */
    const RESULT_OVERREACH = /\byou must\b|\bReuse\b|\bRequired\b|Read and follow|every subsequent|\[SERVER\]/i

    /**
     * True of what PostHog does with the handle, useless to the agent, and read as
     * "safe to drop" — trading a visible refusal for silent non-compliance, which is
     * worse because it looks like it works. Banned in both channels.
     */
    const DISCOUNTABLE = /analytics|telemetry|tracking|metadata|posthog/i

    it.each(RESULT_STRINGS)('%s states a fact and issues no instruction', (_label, text) => {
      expect(text).not.toMatch(RESULT_OVERREACH)
    })

    it.each(ALL)('%s does not invite the agent to discount it', (_label, text) => {
      expect(text).not.toMatch(DISCOUNTABLE)
    })

    // The counterweight. Without these, "no instructions in results" quietly erodes
    // into "no instructions anywhere", which is how the agent gets permission to
    // drift. Both schema descriptions must keep forbidding invented handles, and the
    // parameter must keep forbidding the parallel first calls that fork a session.
    it.each(HANDLE_DESCRIPTIONS)('%s forbids inventing a handle', (_label, text) => {
      expect(text).toMatch(/never invent/i)
    })

    it('the conversation_id parameter forbids parallel calls before the handle exists', () => {
      expect(DEFAULT_CONVERSATION_ID_DESCRIPTION).toMatch(/do not issue parallel tool calls/i)
    })

    // Accurate strictness only: a composed schema never got the parameter, so no
    // description may claim every tool takes it.
    it.each(ALL)('%s does not over-promise which tools accept the handle', (_label, text) => {
      expect(text).not.toMatch(/every subsequent tool call|on every tool/i)
    })
  })
})

/** Every `description` anywhere in a JSON Schema, flattened for assertion. */
function collectDescriptions(label: string, schema: unknown): Array<[string, string]> {
  if (!schema || typeof schema !== 'object') {
    return []
  }
  const found: Array<[string, string]> = []
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === 'description' && typeof value === 'string') {
      found.push([label, value])
    } else if (value && typeof value === 'object') {
      found.push(...collectDescriptions(`${label}.${key}`, value))
    }
  }
  return found
}
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import type { HighLevelMCPServerLike, MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'
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
      instrument(server, fakePostHog(), { enableConversationId: true })

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
      instrument(server, fakePostHog(), { enableConversationId: false })

      const result = await client.request({ method: 'tools/list' }, ListToolsResultSchema)

      for (const tool of result.tools) {
        const schema = tool.inputSchema as {
          properties: Record<string, unknown>
        }
        expect(schema.properties.conversation_id).toBeUndefined()
      }
    })

    // The object form means enabled, matching `context`. But `context` defaults *on*
    // and this defaults *off*, so the predicate cannot be `context`'s `!== false` —
    // that would silently turn the feature on for every server that never named it.
    it('treats the object form as enabled and honours a description override', async () => {
      instrument(server, fakePostHog(), { enableConversationId: { description: 'Custom handle docs.' } })

      const result = await client.request({ method: 'tools/list' }, ListToolsResultSchema)

      for (const tool of result.tools) {
        const schema = tool.inputSchema as {
          properties: Record<string, { description: string }>
        }
        expect(schema.properties.conversation_id.description).toBe('Custom handle docs.')
      }
    })

    it('leaves the parameter injected when only the text block is turned off', async () => {
      instrument(server, fakePostHog(), { enableConversationId: { resultText: false } })

      const result = await client.request({ method: 'tools/list' }, ListToolsResultSchema)

      for (const tool of result.tools) {
        const schema = tool.inputSchema as { properties: Record<string, unknown> }
        expect(schema.properties.conversation_id).toBeDefined()
      }
    })
  })

  describe('tools/call conversation_id propagation', () => {
    it('captures the agent-supplied conversation_id verbatim on the event', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { enableConversationId: true })

      const agentConversationId = '019fd2b0-5555-7555-8555-555555555555'
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

    it('mints a conversation_id and appends a handle text block when the agent omits it', async () => {
      instrument(server, fakePostHog(), { enableConversationId: true })

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

      const handleBlock = result.content.find(
        (c) => c.type === 'text' && typeof c.text === 'string' && c.text.includes('conversation_id=')
      )
      expect(handleBlock).toBeDefined()
    })

    it('appends nothing to content when resultText is off', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { enableConversationId: { resultText: false } })

      const result = await client.request(
        {
          method: 'tools/call',
          params: { name: 'add_todo', arguments: { text: 'first' } },
        },
        CallToolResultSchema
      )

      expect(result.content.some((c) => c.type === 'text' && String(c.text).includes('conversation_id='))).toBe(false)

      // The handle was minted but no channel carried it, so it must not be reported
      // as a session the agent holds.
      await new Promise((r) => setTimeout(r, 50))
      const toolCall = capture.getEvents().find((e) => e.resourceName === 'add_todo')
      expect(toolCall?.conversationId).toBeUndefined()
      await capture.stop()
    })

    it('sets event.conversationId on the captured event when minted', async () => {
      const capture = new EventCapture()
      await capture.start()

      instrument(server, fakePostHog(), { enableConversationId: true })

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

      instrument(server, fakePostHog(), { enableConversationId: true })

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: { text: 'x', conversation_id: AGENT_ECHOED },
          },
        },
        CallToolResultSchema
      )

      await new Promise((r) => setTimeout(r, 50))
      const toolCall = capture.getEvents().find((e) => e.resourceName === 'add_todo')
      expect(toolCall?.conversationId).toBe(AGENT_ECHOED)
      await capture.stop()
    })

    it('injects the prompt-back into error results too', async () => {
      instrument(server, fakePostHog(), { enableConversationId: true })

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

      // A tool that fails on the first call is exactly when the agent needs the
      // session handle, or its retry starts a different conversation.
      const hasPromptBack = (result.content ?? []).some(
        (c) => c.type === 'text' && typeof c.text === 'string' && c.text.includes('conversation_id=')
      )
      expect(hasPromptBack).toBe(true)
    })

    it('clears event.conversationId when a minted handle reaches no channel at all', async () => {
      // The `minted && !delivered` cell. Both delivery channels have to miss:
      // no declared output schema means no mirror, and a result carrying no
      // `content` array means no prompt-back. The handle then exists only in our
      // event, describing a conversation the agent was never told about — so it
      // is cleared rather than reported as one.
      const capture = new EventCapture()
      await capture.start()

      // Replace the underlying handler *before* instrumenting, so our wrapper
      // still runs and simply sees a result with no content array — bypassing the
      // SDK's result normalisation, which would add one.
      const lowLevel = server.server as unknown as MCPServerLike
      lowLevel._requestHandlers.set('tools/call', async () => ({ structuredContent: { ok: true } }))
      instrument(server, fakePostHog(), { enableConversationId: true })

      const handler = lowLevel._requestHandlers.get('tools/call')!
      const result = (await handler(
        { method: 'tools/call', params: { name: 'add_todo', arguments: { text: 'x' } } },
        {} as never
      )) as { content?: unknown }

      await new Promise((r) => setTimeout(r, 50))
      const toolCall = capture.getEvents().find((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall)
      // The event must exist, or this asserts nothing.
      expect(toolCall).toBeDefined()
      expect(result.content).toBeUndefined()
      expect(toolCall?.conversationId).toBeUndefined()
      await capture.stop()
    })

    it('keeps event.conversationId on error, since the prompt-back now reaches the agent', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { enableConversationId: true })

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
      expect(toolCall?.conversationId).toBeDefined()
      await capture.stop()
    })

    it('keeps event.conversationId on error when the agent supplied it', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { enableConversationId: true })

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'complete_todo',
            arguments: {
              id: 'does-not-exist',
              conversation_id: AGENT_ECHOED_ON_ERROR,
            },
          },
        },
        CallToolResultSchema
      )

      await new Promise((r) => setTimeout(r, 50))
      const toolCall = capture.getEvents().find((e) => e.resourceName === 'complete_todo')
      expect(toolCall?.conversationId).toBe(AGENT_ECHOED_ON_ERROR)
      await capture.stop()
    })
  })
})

describe('conversation_id edge cases', () => {
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

  it('puts a capability gap in the same session as the calls around it', async () => {
    const capture = new EventCapture()
    await capture.start()
    instrument(server, fakePostHog(), { enableConversationId: true, reportMissing: true })

    await client.request({ method: 'tools/list' }, ListToolsResultSchema)

    // A real call mints the handle, then the agent echoes it while reporting the gap.
    const first = await client.request(
      { method: 'tools/call', params: { name: 'add_todo', arguments: { text: 'first' } } },
      CallToolResultSchema
    )
    const handle = (first.content ?? [])
      .map((c: any) => String(c.text ?? '').match(/conversation_id=([\w-]+)/)?.[1])
      .find(Boolean)
    expect(handle).toBeDefined()

    await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'get_more_tools',
          arguments: {
            context: 'Needed a tool to delete todos, which this server does not expose.',
            conversation_id: handle,
          },
        },
      },
      CallToolResultSchema
    )

    await new Promise((r) => setTimeout(r, 50))
    const events = capture.getEvents()
    const toolCall = events.find((e) => e.resourceName === 'add_todo')
    const missing = events.find((e) => e.eventType === MCPAnalyticsEventType.mcpMissingCapability)

    // This is what this PR controls: the gap report carries the same handle.
    expect(missing?.conversationId).toBe(handle)
    // Forward guard only. On one server instance over InMemoryTransport both
    // events fall back to the same in-memory session id anyway, so this cannot
    // tell "grouped by the handle" from "nothing rotated" until the handle
    // drives $session_id. The distinguishing assertion is the next test.
    expect(missing?.sessionId).toBe(toolCall?.sessionId)
    await capture.stop()
  })

  it('gives two different handles two different conversations', async () => {
    const capture = new EventCapture()
    await capture.start()
    instrument(server, fakePostHog(), { enableConversationId: true, reportMissing: true })
    await client.request({ method: 'tools/list' }, ListToolsResultSchema)

    // Same connection, so anything falling back to the transport or in-memory
    // session would report one id for both. Only the handle can separate them.
    // Both are shaped like handles the SDK would have minted, which is what a
    // real agent echoes. On this branch any non-empty string would do; #4428
    // adds the shape check that makes the distinction matter.
    const one = '019fd2b0-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
    const two = '019fd2b0-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
    for (const [handle, text] of [
      [one, 'Needed a delete tool.'],
      [two, 'Needed an export tool.'],
    ]) {
      await client.request(
        {
          method: 'tools/call',
          params: { name: 'get_more_tools', arguments: { context: text, conversation_id: handle } },
        },
        CallToolResultSchema
      )
    }

    await new Promise((r) => setTimeout(r, 50))
    const gaps = capture.getEvents().filter((e) => e.eventType === MCPAnalyticsEventType.mcpMissingCapability)
    expect(gaps.map((g) => g.conversationId)).toEqual([one, two])
    await capture.stop()
  })

  it('advertises conversation_id on the virtual get_more_tools tool', async () => {
    instrument(server, fakePostHog(), { enableConversationId: true, reportMissing: true })

    const { tools } = await client.request({ method: 'tools/list' }, ListToolsResultSchema)
    const virtual = tools.find((t: any) => t.name === 'get_more_tools')

    expect((virtual.inputSchema as any).properties.conversation_id).toBeDefined()
    // Its own bespoke `context` parameter is untouched.
    expect((virtual.inputSchema as any).properties.context).toBeDefined()
  })

  describe('with enableConversationId off', () => {
    it('leaves errored results alone', async () => {
      instrument(server, fakePostHog(), { enableConversationId: false })

      const result = await client.request(
        { method: 'tools/call', params: { name: 'complete_todo', arguments: { id: 'does-not-exist' } } },
        CallToolResultSchema
      )

      const hasPromptBack = (result.content ?? []).some((c: any) => String(c.text ?? '').includes('conversation_id='))
      expect(hasPromptBack).toBe(false)
    })

    it('leaves get_more_tools alone', async () => {
      instrument(server, fakePostHog(), { enableConversationId: false, reportMissing: true })

      const { tools } = await client.request({ method: 'tools/list' }, ListToolsResultSchema)
      const virtual = tools.find((t: any) => t.name === 'get_more_tools')

      expect((virtual.inputSchema as any).properties.conversation_id).toBeUndefined()
      // Its own parameter still there — we removed nothing.
      expect((virtual.inputSchema as any).properties.context).toBeDefined()
    })

    it('publishes a capability gap with no conversation id', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { enableConversationId: false, reportMissing: true })

      await client.request({ method: 'tools/list' }, ListToolsResultSchema)
      await client.request(
        { method: 'tools/call', params: { name: 'get_more_tools', arguments: { context: 'Needed a delete tool.' } } },
        CallToolResultSchema
      )

      await new Promise((r) => setTimeout(r, 50))
      const missing = capture.getEvents().find((e) => e.eventType === MCPAnalyticsEventType.mcpMissingCapability)
      expect(missing).toBeDefined()
      expect(missing?.conversationId).toBeUndefined()
      await capture.stop()
    })

    it('ignores a conversation_id an agent sends anyway', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { enableConversationId: false })

      // With injection off the argument is the host's, not ours — never read.
      await client.request(
        {
          method: 'tools/call',
          params: { name: 'add_todo', arguments: { text: 'x', conversation_id: 'agent-made-up' } },
        },
        CallToolResultSchema
      )

      await new Promise((r) => setTimeout(r, 50))
      const toolCall = capture.getEvents().find((e) => e.resourceName === 'add_todo')
      expect(toolCall?.conversationId).toBeUndefined()
      await capture.stop()
    })
  })
})

describe('enableConversationId and reportMissing are independent', () => {
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

  /** [enableConversationId, reportMissing] → [handle on a real tool, virtual tool exists] */
  const matrix: [boolean, boolean, boolean, boolean][] = [
    [false, false, false, false],
    [false, true, false, true],
    [true, false, true, false],
    [true, true, true, true],
  ]

  it.each(matrix)(
    'enableConversationId=%s reportMissing=%s → handle=%s virtualTool=%s',
    async (enableConversationId, reportMissing, expectHandle, expectVirtual) => {
      instrument(server, fakePostHog(), { enableConversationId, reportMissing })

      const { tools } = await client.request({ method: 'tools/list' }, ListToolsResultSchema)
      const realTool = tools.find((t: any) => t.name === 'add_todo')
      const virtual = tools.find((t: any) => t.name === 'get_more_tools')

      // One option decides stitching, the other decides whether the tool exists.
      expect(!!(realTool.inputSchema as any).properties.conversation_id).toBe(expectHandle)
      expect(!!virtual).toBe(expectVirtual)

      // When both are on they compose: the virtual tool stitches like any other.
      if (expectVirtual) {
        expect(!!(virtual.inputSchema as any).properties.conversation_id).toBe(expectHandle)
        expect((virtual.inputSchema as any).properties.context).toBeDefined()
      }
    }
  )
})
