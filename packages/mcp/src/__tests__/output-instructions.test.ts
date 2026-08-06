import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { instrument } from '../index'
import { getAnalyticsParameterOwnership } from '../extensions/analytics-parameters'
import {
  MCP_INSTRUCTIONS_KEY,
  addInstructionsToOutputSchema,
  addInstructionsToOutputSchemas,
  canDeclareOutputInstructions,
  mirrorInstructionsIntoStructuredContent,
} from '../extensions/output-instructions'
import { fakePostHog } from './test-utils'

/**
 * Declaring `_mcp_instructions` on a tool's advertised output schema is what
 * makes writing it into `structuredContent` safe: the MCP client ajv-validates
 * that object against the schema under `additionalProperties: false`, so an
 * undeclared key fails the whole tool result.
 *
 * This change only declares. Nothing writes the field yet.
 */
describe('_mcp_instructions output schema declaration', () => {
  const objectSchema = () => ({
    type: 'object' as const,
    properties: { ok: { type: 'boolean' } },
    additionalProperties: false,
    required: ['ok'],
  })

  describe('canDeclareOutputInstructions', () => {
    it('accepts a plain object schema', () => {
      expect(canDeclareOutputInstructions(objectSchema())).toBe(true)
    })

    it('rejects a malformed `properties` rather than crashing the listing', () => {
      // Declaring into a non-object `properties` throws, and that throw surfaces
      // inside the tools/list wrapper — failing the whole listing over a schema
      // we only meant to annotate.
      for (const properties of [true, 'nope', 42, null, []]) {
        expect(canDeclareOutputInstructions({ type: 'object', properties })).toBe(false)
      }
      expect(() =>
        addInstructionsToOutputSchema({ name: 'malformed', outputSchema: { properties: true } })
      ).not.toThrow()
    })

    it('accepts a schema whose own property is named `_def`', () => {
      // `_def` is a Zod internal, so a naive scan of the property values reads
      // this legitimate schema as a Zod value and silently skips the tool.
      expect(canDeclareOutputInstructions({ type: 'object', properties: { _def: { type: 'string' } } })).toBe(true)
    })

    it('still refuses a raw shape whose keys happen to be `type` and `properties`', () => {
      // The JSON Schema check above must key off the *values*: a raw Zod shape is
      // free to name its fields `type` or `properties`.
      expect(canDeclareOutputInstructions({ type: z.string(), properties: z.object({}) })).toBe(false)
    })

    it('rejects a missing schema — there is nothing to mirror into', () => {
      expect(canDeclareOutputInstructions(undefined)).toBe(false)
      expect(canDeclareOutputInstructions(null)).toBe(false)
    })

    it('rejects composed schemas, which have no single properties bag', () => {
      expect(canDeclareOutputInstructions({ oneOf: [] })).toBe(false)
      expect(canDeclareOutputInstructions({ allOf: [] })).toBe(false)
      expect(canDeclareOutputInstructions({ anyOf: [] })).toBe(false)
      expect(canDeclareOutputInstructions({ $ref: '#/$defs/x' })).toBe(false)
    })

    it('refuses a Zod schema or raw shape — only advertised JSON Schema can answer', () => {
      // The high-level registry stores Zod, which has no `properties` bag, so
      // every structural check would pass vacuously and wrongly report `true`.
      expect(canDeclareOutputInstructions(z.object({ ok: z.boolean() }))).toBe(false)
      expect(canDeclareOutputInstructions({ ok: z.boolean() })).toBe(false)
      expect(canDeclareOutputInstructions({ [MCP_INSTRUCTIONS_KEY]: z.string() })).toBe(false)
    })

    it('rejects a schema that already declares the key', () => {
      expect(
        canDeclareOutputInstructions({ type: 'object', properties: { [MCP_INSTRUCTIONS_KEY]: { type: 'object' } } })
      ).toBe(false)
    })
  })

  describe('addInstructionsToOutputSchema', () => {
    it('declares the key as an optional object property', () => {
      const result = addInstructionsToOutputSchema({ name: 'get_issue', outputSchema: objectSchema() })
      const schema = result.outputSchema as any

      expect(schema.properties[MCP_INSTRUCTIONS_KEY].type).toBe('object')
      expect(schema.properties[MCP_INSTRUCTIONS_KEY].properties.conversation_id.type).toBe('string')
      // A result without the field must stay valid — every existing result lacks it.
      expect(schema.required).toEqual(['ok'])
    })

    it('preserves the schema the tool advertised, including additionalProperties: false', () => {
      const result = addInstructionsToOutputSchema({ name: 'get_issue', outputSchema: objectSchema() })
      const schema = result.outputSchema as any

      // Declaring inside `properties` is what makes the key legal; the closed
      // schema itself is the customer's and stays untouched.
      expect(schema.additionalProperties).toBe(false)
      expect(schema.properties.ok).toEqual({ type: 'boolean' })
    })

    it('does not mutate the tool it was given', () => {
      const outputSchema = objectSchema()
      const tool = { name: 'get_issue', outputSchema }

      addInstructionsToOutputSchema(tool)

      expect(Object.keys(outputSchema.properties)).toEqual(['ok'])
      expect(tool.outputSchema).toBe(outputSchema)
    })

    it('leaves a tool without an output schema alone', () => {
      const tool = { name: 'list_issues' }
      expect(addInstructionsToOutputSchema(tool)).toBe(tool)
    })

    it('leaves a composed schema alone and says why', () => {
      const logged: string[] = []
      const tool = { name: 'get_issue', outputSchema: { oneOf: [{ type: 'object' }] } }

      expect(addInstructionsToOutputSchema(tool, (m) => logged.push(m))).toBe(tool)
      expect(logged.join(' ')).toContain('complex output schema')
    })

    it('never overwrites a key the tool already declares', () => {
      const logged: string[] = []
      const own = { type: 'string' as const }
      const tool = {
        name: 'get_issue',
        outputSchema: { type: 'object', properties: { [MCP_INSTRUCTIONS_KEY]: own } },
      }

      const result = addInstructionsToOutputSchema(tool, (m) => logged.push(m))

      expect((result.outputSchema as any).properties[MCP_INSTRUCTIONS_KEY]).toBe(own)
      expect(logged.join(' ')).toContain('already declares')
    })
  })

  describe('addInstructionsToOutputSchemas', () => {
    it('declares on schema-bearing tools and passes the rest through', () => {
      const withSchema = { name: 'get_issue', outputSchema: objectSchema() }
      const withoutSchema = { name: 'list_issues' }

      const [a, b] = addInstructionsToOutputSchemas([withSchema, withoutSchema])

      expect((a.outputSchema as any).properties[MCP_INSTRUCTIONS_KEY]).toBeDefined()
      expect(b).toBe(withoutSchema)
    })
  })

  describe('ownership registry', () => {
    it('records where the key was declared, so only those tools are safe to write', () => {
      expect(getAnalyticsParameterOwnership({}, objectSchema()).outputInstructions).toBe(true)
      expect(getAnalyticsParameterOwnership({}, undefined).outputInstructions).toBe(false)
      expect(getAnalyticsParameterOwnership({}, { oneOf: [] }).outputInstructions).toBe(false)
    })
  })
})

/**
 * End to end through a real client, because the constraint this change exists
 * for is enforced client-side: the SDK ajv-validates `structuredContent`
 * against the schema it received from `tools/list`.
 */
describe('_mcp_instructions declaration over a real client', () => {
  async function connect(options: Record<string, unknown>) {
    const server = new McpServer({ name: 'schema-test', version: '1.0.0' })

    server.registerTool(
      'get_issue',
      {
        description: 'Fetch an issue.',
        inputSchema: { issue_id: z.string() },
        outputSchema: { ok: z.boolean(), title: z.string() },
      },
      async () => ({
        content: [{ type: 'text', text: '{"ok":true,"title":"Retry loop"}' }],
        structuredContent: { ok: true, title: 'Retry loop' },
      })
    )

    instrument(server, fakePostHog(), options)

    const client = new Client({ name: 'test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    return { client, cleanup: () => client.close() }
  }

  it('advertises the key when conversation ids are enabled', async () => {
    const { client, cleanup } = await connect({ enableConversationId: true })
    try {
      const { tools } = await client.request({ method: 'tools/list' }, ListToolsResultSchema)
      const schema = tools.find((t) => t.name === 'get_issue')!.outputSchema as any

      expect(schema.properties[MCP_INSTRUCTIONS_KEY]).toBeDefined()
      expect(schema.required).not.toContain(MCP_INSTRUCTIONS_KEY)
    } finally {
      await cleanup()
    }
  })

  it('does not advertise it when the feature is off', async () => {
    const { client, cleanup } = await connect({ enableConversationId: false })
    try {
      const { tools } = await client.request({ method: 'tools/list' }, ListToolsResultSchema)
      const schema = tools.find((t) => t.name === 'get_issue')!.outputSchema as any

      expect(schema.properties[MCP_INSTRUCTIONS_KEY]).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  it('mirrors a key that validates against the real advertised schema', async () => {
    // The claim this whole two-PR split exists to satisfy: the key we write is
    // one the client's cached schema accepts. Only `callTool` ajv-validates
    // `structuredContent`, so asserting the mirrored key anywhere else proves
    // the write happened but not that it survives validation.
    const { client, cleanup } = await connect({ enableConversationId: true })
    try {
      await client.listTools()

      const result = await client.callTool({ name: 'get_issue', arguments: { issue_id: 'iss_7' } })

      const mirrored = (result.structuredContent as Record<string, any>)[MCP_INSTRUCTIONS_KEY]
      expect(mirrored?.conversation_id).toEqual(expect.any(String))
      expect((result.structuredContent as any).ok).toBe(true)
    } finally {
      await cleanup()
    }
  })

  it('still accepts a result that omits the declared key', async () => {
    const { client, cleanup } = await connect({ enableConversationId: true })
    try {
      // callTool, not request: only callTool ajv-validates structuredContent
      // against the cached output schema, which is the whole premise of
      // declaring before writing. request() parses the envelope and no more.
      await client.listTools()

      const result = await client.callTool({ name: 'get_issue', arguments: { issue_id: 'iss_7' } })

      expect((result.structuredContent as any).ok).toBe(true)
    } finally {
      await cleanup()
    }
  })
})

/** A server whose tool declares an outputSchema and returns structuredContent. */
async function connectStructured(options: Record<string, unknown>) {
  const server = new McpServer({ name: 'mirror-test', version: '1.0.0' })
  server.registerTool(
    'with_schema',
    { description: 'Structured.', inputSchema: {}, outputSchema: { ok: z.boolean() } },
    async () => ({ content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } })
  )
  instrument(server, fakePostHog(), options)

  const client = new Client({ name: 'test', version: '1.0.0' })
  const [c, s] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(c), server.connect(s)])
  return { client, cleanup: () => client.close() }
}

describe('mirroring the session handle into structuredContent', () => {
  const withStructured = (extra = {}) => ({
    content: [{ type: 'text', text: '{"ok":true}' }],
    structuredContent: { ok: true, ...extra },
  })

  it('adds the key alongside the tool’s own fields', () => {
    const result = mirrorInstructionsIntoStructuredContent(withStructured(), 'conv-1') as any

    expect(result.structuredContent[MCP_INSTRUCTIONS_KEY].conversation_id).toBe('conv-1')
    expect(result.structuredContent[MCP_INSTRUCTIONS_KEY].instructions).toEqual(expect.any(String))
    expect(result.structuredContent.ok).toBe(true)
  })

  it('does not mutate the result it was given', () => {
    const original = withStructured()
    mirrorInstructionsIntoStructuredContent(original, 'conv-1')
    expect(Object.keys(original.structuredContent)).toEqual(['ok'])
  })

  it('leaves a result with no structuredContent alone', () => {
    const original = { content: [{ type: 'text', text: 'plain' }] }
    expect(mirrorInstructionsIntoStructuredContent(original, 'conv-1')).toBe(original)
  })

  it('leaves a non-object structuredContent alone', () => {
    for (const structuredContent of [[1, 2], 'text', 42, null]) {
      const original = { structuredContent }
      expect(mirrorInstructionsIntoStructuredContent(original, 'conv-1')).toBe(original)
    }
  })

  it('never overwrites a key the tool produced itself', () => {
    const own = { mine: true }
    const original = withStructured({ [MCP_INSTRUCTIONS_KEY]: own })
    expect(mirrorInstructionsIntoStructuredContent(original, 'conv-1')).toBe(original)
  })

  it('leaves non-object results alone', () => {
    expect(mirrorInstructionsIntoStructuredContent(null, 'conv-1')).toBeNull()
    expect(mirrorInstructionsIntoStructuredContent('text', 'conv-1')).toBe('text')
  })
})

describe('mirroring over a real client', () => {
  async function call(client: any, conversationId?: string) {
    return client.request(
      {
        method: 'tools/call',
        params: { name: 'with_schema', arguments: conversationId ? { conversation_id: conversationId } : {} },
      },
      CallToolResultSchema
    )
  }

  it('delivers the session handle where a structured-only client will see it', async () => {
    const { client, cleanup } = await connectStructured({ enableConversationId: true })
    try {
      await client.request({ method: 'tools/list' }, ListToolsResultSchema)
      const result = await call(client)

      // The whole point: this survives a client that ignores `content`.
      expect((result.structuredContent as any)[MCP_INSTRUCTIONS_KEY].conversation_id).toEqual(expect.any(String))
    } finally {
      await cleanup()
    }
  })

  it('re-sends it on later calls, so an agent that dropped it can recover', async () => {
    const { client, cleanup } = await connectStructured({ enableConversationId: true })
    try {
      await client.request({ method: 'tools/list' }, ListToolsResultSchema)
      // Shaped like a handle the SDK would have minted, which is what a real
      // agent echoes. On this branch any non-empty string would do; #4428 adds
      // the shape check that makes the distinction matter.
      const echoed = '019fd2b0-1111-7111-8111-111111111111'
      const second = await call(client, echoed)

      // The text block is mint-only; the structured copy rides every response.
      const hasText = (second.content ?? []).some((c: any) => String(c.text).includes('conversation_id='))
      expect(hasText).toBe(false)
      expect((second.structuredContent as any)[MCP_INSTRUCTIONS_KEY].conversation_id).toBe(echoed)
    } finally {
      await cleanup()
    }
  })

  it('writes nothing when the feature is off', async () => {
    const { client, cleanup } = await connectStructured({ enableConversationId: false })
    try {
      await client.request({ method: 'tools/list' }, ListToolsResultSchema)
      const result = await call(client)
      expect((result.structuredContent as any)[MCP_INSTRUCTIONS_KEY]).toBeUndefined()
    } finally {
      await cleanup()
    }
  })
})

describe('the write is gated on what tools/list actually declared', () => {
  /** A tool that declares `_mcp_instructions` itself, so we must not write it. */
  async function connectOwningTheKey() {
    const server = new McpServer({ name: 'own-key', version: '1.0.0' })
    server.registerTool(
      'own_key',
      {
        description: 'Owns the key.',
        inputSchema: {},
        outputSchema: { ok: z.boolean(), [MCP_INSTRUCTIONS_KEY]: z.string() },
      },
      async () => ({
        content: [{ type: 'text', text: '{"ok":true}' }],
        structuredContent: { ok: true, [MCP_INSTRUCTIONS_KEY]: 'mine' },
      })
    )
    instrument(server, fakePostHog(), { enableConversationId: true })

    const client = new Client({ name: 'test', version: '1.0.0' })
    const [c, s] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(c), server.connect(s)])
    return { client, cleanup: () => client.close() }
  }

  it('never overwrites a key the tool declares and produces itself', async () => {
    const { client, cleanup } = await connectOwningTheKey()
    try {
      await client.listTools()
      const result = await client.callTool({ name: 'own_key', arguments: {} })

      // tools/list skips the declaration for this tool, so the write must skip too.
      expect((result.structuredContent as any)[MCP_INSTRUCTIONS_KEY]).toBe('mine')
    } finally {
      await cleanup()
    }
  })

  it('writes nothing when the tool was never listed', async () => {
    const { client, cleanup } = await connectStructured({ enableConversationId: true })
    try {
      // No tools/list first: we cannot know what the client's cached schema
      // declares, so writing would risk failing its validation.
      const result = await client.callTool({ name: 'with_schema', arguments: {} })
      expect((result.structuredContent as any)[MCP_INSTRUCTIONS_KEY]).toBeUndefined()
    } finally {
      await cleanup()
    }
  })
})
