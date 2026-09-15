import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { SEND_FEEDBACK_TOOL_NAME } from '../extensions/feedback'
import { EventCapture, fakePostHog } from './test-utils'

/**
 * `tools/list` responses must reach the wire as the application built them.
 * Rebuilding them as `{ tools }` drops `nextCursor`, so a paginated catalogue's
 * later pages become unreachable the moment `instrument()` is applied — the SDK
 * removing behaviour the customer's server produced.
 */

const PAGE_ONE = [{ name: 'page_one_tool', description: 'On page one', inputSchema: { type: 'object' as const } }]
const PAGE_TWO = [{ name: 'page_two_tool', description: 'On page two', inputSchema: { type: 'object' as const } }]

/**
 * A paginated catalogue: page one advertises a cursor, page two ends the
 * enumeration. Pass `cursorToken: ''` to paginate by the empty-string cursor.
 */
function setupPaginatedServer(
  listResponses?: { firstPage?: Record<string, unknown>; secondPage?: Record<string, unknown> },
  cursorToken = 'page-2'
) {
  const server = new Server({ name: 'paginated test', version: '1.0.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    if (request.params?.cursor === cursorToken) {
      return listResponses?.secondPage ?? { tools: PAGE_TWO }
    }
    return listResponses?.firstPage ?? { tools: PAGE_ONE, nextCursor: cursorToken }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [{ type: 'text' as const, text: `called: ${request.params?.name}` }],
  }))

  const client = new Client({ name: 'test client', version: '1.0' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  return {
    server,
    client,
    async connect() {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    },
    async cleanup() {
      await clientTransport.close?.()
      await serverTransport.close?.()
    },
  }
}

describe('tools/list response envelope', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  it('keeps nextCursor, so the client can reach page two through an instrumented server', async () => {
    const { server, client, connect, cleanup } = await setupPaginatedServer()
    try {
      instrument(server, fakePostHog(), { reportMissing: false })
      await connect()

      const firstPage = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(firstPage.nextCursor).toBe('page-2')

      const secondPage = await client.request(
        { method: 'tools/list', params: { cursor: firstPage.nextCursor } },
        ListToolsResultSchema
      )
      expect(secondPage.tools.map((tool) => tool.name)).toEqual(['page_two_tool'])
      expect(secondPage.nextCursor).toBeUndefined()

      // Enumeration is only worth anything if the tools it reaches are callable.
      const result = await client.request(
        { method: 'tools/call', params: { name: 'page_two_tool', arguments: { context: 'reaching page two' } } },
        CallToolResultSchema
      )
      expect((result.content as { text: string }[])[0].text).toBe('called: page_two_tool')
    } finally {
      await cleanup()
    }
  })

  it('keeps the 2026-07-28 cache directives and result _meta', async () => {
    const { server, client, connect, cleanup } = await setupPaginatedServer({
      firstPage: {
        tools: PAGE_ONE,
        nextCursor: 'page-2',
        ttlMs: 60_000,
        cacheScope: 'public',
        _meta: { 'io.modelcontextprotocol/custom': { keep: true } },
      },
    })
    try {
      instrument(server, fakePostHog(), { reportMissing: false })
      await connect()

      const page = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)

      expect(page.ttlMs).toBe(60_000)
      expect(page.cacheScope).toBe('public')
      expect(page._meta).toEqual({ 'io.modelcontextprotocol/custom': { keep: true } })
    } finally {
      await cleanup()
    }
  })

  it('still injects the analytics parameters into the tools it passes through', async () => {
    const { server, client, connect, cleanup } = await setupPaginatedServer()
    try {
      instrument(server, fakePostHog(), { reportMissing: false, enableConversationId: true })
      await connect()

      const page = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)

      expect(page.nextCursor).toBe('page-2')
      expect(page.tools[0].inputSchema.properties?.context).toBeDefined()
      expect(page.tools[0].inputSchema.properties?.conversation_id).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('keeps the envelope on an empty page, which is the exit point that captures an error', async () => {
    const { server, client, connect, cleanup } = await setupPaginatedServer({
      firstPage: { tools: [], nextCursor: 'page-2' },
    })
    try {
      instrument(server, fakePostHog(), { reportMissing: false })
      await connect()

      const page = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)

      expect(page.tools).toEqual([])
      expect(page.nextCursor).toBe('page-2')
    } finally {
      await cleanup()
    }
  })

  /**
   * A real paginated catalogue, not a two-tool stand-in: 100 tools over two pages.
   * The oversized row pushes `$mcp_response` past the 100KB event cap, so it pins
   * that the truncation ladder sheds tool contents and keeps the envelope — the
   * pagination facts have to survive on exactly the large catalogues that need them.
   */
  it.each([
    ['a realistic catalogue', 300],
    ['a catalogue past the 100KB event cap', 4000],
  ])('paginates 100 tools over two pages — %s', async (_label, descriptionChars) => {
    const page = (offset: number) =>
      Array.from({ length: 50 }, (_, i) => ({
        name: `tool_${offset + i}`,
        description: 'x'.repeat(descriptionChars),
        inputSchema: { type: 'object' as const, properties: { alpha: { type: 'string' } } },
      }))

    const server = new Server({ name: 'big catalogue', version: '1.0.0' }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async (request) =>
      request.params?.cursor === 'page-2'
        ? { tools: page(50) }
        : { tools: page(0), nextCursor: 'page-2', ttlMs: 60_000, cacheScope: 'public' }
    )
    instrument(server, fakePostHog(), { reportMissing: false })

    const client = new Client({ name: 'test client', version: '1.0' }, { capabilities: {} })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    try {
      const firstPage = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const secondPage = await client.request(
        { method: 'tools/list', params: { cursor: firstPage.nextCursor } },
        ListToolsResultSchema
      )

      expect(firstPage.tools).toHaveLength(50)
      expect(firstPage.nextCursor).toBe('page-2')
      expect(secondPage.tools.at(-1)?.name).toBe('tool_99')
      // Every tool on every page, which a single-tool page cannot distinguish.
      expect(firstPage.tools.every((tool) => tool.inputSchema.properties?.context)).toBe(true)
      expect(secondPage.tools.every((tool) => tool.inputSchema.properties?.context)).toBe(true)

      const event = eventCapture.findEventByType(MCPAnalyticsEventType.mcpToolsList)
      const response = event?.response as { nextCursor?: string; ttlMs?: number; cacheScope?: string }
      expect(response.nextCursor).toBe('page-2')
      expect(response.ttlMs).toBe(60_000)
      expect(response.cacheScope).toBe('public')
      expect(event?.listedToolNames).toHaveLength(50)
    } finally {
      await clientTransport.close?.()
      await serverTransport.close?.()
    }
  })

  it('captures the response as sent, envelope included', async () => {
    const { server, client, connect, cleanup } = await setupPaginatedServer({
      firstPage: { tools: PAGE_ONE, nextCursor: 'page-2', ttlMs: 60_000, cacheScope: 'public' },
    })
    try {
      instrument(server, fakePostHog(), { reportMissing: false })
      await connect()

      await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)

      const event = eventCapture.findEventByType(MCPAnalyticsEventType.mcpToolsList)
      const response = event?.response as {
        tools: unknown[]
        nextCursor?: string
        ttlMs?: number
        cacheScope?: string
      }
      expect(response.nextCursor).toBe('page-2')
      expect(response.ttlMs).toBe(60_000)
      expect(response.cacheScope).toBe('public')
      expect(response.tools).toHaveLength(1)
    } finally {
      await cleanup()
    }
  })

  /**
   * A compliant client concatenates every page into one tool list, so the
   * virtual feedback tool may appear on exactly one page — the first one, the
   * page every client reads, including clients that never follow `nextCursor`.
   *
   * Collision detection is deliberately cheap: the served page at list time,
   * the raw first page at call time. A real owner on a later page is the
   * host's responsibility — the SDK shadows it, warns when a client fetches
   * that page, and the host renames the SDK's tool with
   * `collectFeedback: { toolName }`.
   */
  describe('send_feedback on a paginated catalogue', () => {
    const REAL_FEEDBACK_TOOL = {
      name: SEND_FEEDBACK_TOOL_NAME,
      description: 'A real application tool that owns the name',
      inputSchema: { type: 'object' as const },
    }

    /** Walk the whole enumeration, returning the names each page advertised. */
    const listBothPages = async (client: Client, cursorToken = 'page-2'): Promise<[string[], string[]]> => {
      const firstPage = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const secondPage = await client.request(
        { method: 'tools/list', params: { cursor: cursorToken } },
        ListToolsResultSchema
      )
      return [firstPage.tools.map((tool) => tool.name), secondPage.tools.map((tool) => tool.name)]
    }

    it('appends the virtual tool only to the first page', async () => {
      const { server, client, connect, cleanup } = await setupPaginatedServer()
      try {
        instrument(server, fakePostHog(), { reportMissing: false, collectFeedback: true })
        await connect()

        const [pageOne, pageTwo] = await listBothPages(client)
        expect(pageOne).toEqual(['page_one_tool', SEND_FEEDBACK_TOOL_NAME])
        expect(pageTwo).toEqual(['page_two_tool'])
      } finally {
        await cleanup()
      }
    })

    it('a single un-paginated listing still gets the virtual tool', async () => {
      const { server, client, connect, cleanup } = await setupPaginatedServer({
        firstPage: { tools: PAGE_ONE },
      })
      try {
        instrument(server, fakePostHog(), { reportMissing: false, collectFeedback: true })
        await connect()

        const page = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
        expect(page.tools.map((tool) => tool.name)).toEqual(['page_one_tool', SEND_FEEDBACK_TOOL_NAME])
      } finally {
        await cleanup()
      }
    })

    // Read as "no cursor", `''` puts the virtual tool on this page as well as
    // the first, so a client concatenating the pages sees it twice.
    it('treats an empty-string cursor as a continuation page, not the first one', async () => {
      const { server, client, connect, cleanup } = setupPaginatedServer(undefined, '')
      try {
        instrument(server, fakePostHog(), { reportMissing: false, collectFeedback: true })
        await connect()

        const [pageOne, pageTwo] = await listBothPages(client, '')
        expect(pageOne).toEqual(['page_one_tool', SEND_FEEDBACK_TOOL_NAME])
        expect(pageTwo).toEqual(['page_two_tool'])
      } finally {
        await cleanup()
      }
    })

    it('a real owner on page one blocks injection and keeps its calls', async () => {
      const { server, client, connect, cleanup } = await setupPaginatedServer({
        firstPage: { tools: [REAL_FEEDBACK_TOOL], nextCursor: 'page-2' },
      })
      const warnings: string[] = []
      try {
        instrument(server, fakePostHog(), {
          reportMissing: false,
          collectFeedback: true,
          logger: (message: string) => warnings.push(message),
        })
        await connect()

        const [pageOne, pageTwo] = await listBothPages(client)
        expect(pageOne).toEqual([SEND_FEEDBACK_TOOL_NAME])
        expect(pageTwo).toEqual(['page_two_tool'])
        expect(warnings.some((message) => message.includes('Cannot inject agent-feedback tool'))).toBe(true)

        const result = await client.request(
          { method: 'tools/call', params: { name: SEND_FEEDBACK_TOOL_NAME, arguments: {} } },
          CallToolResultSchema
        )
        expect((result.content as { text: string }[])[0].text).toBe(`called: ${SEND_FEEDBACK_TOOL_NAME}`)
        expect(eventCapture.findEventByType(MCPAnalyticsEventType.mcpFeedback)).toBeUndefined()
      } finally {
        await cleanup()
      }
    })

    it('a real owner on a later page is shadowed, with a warning when its page is served', async () => {
      const { server, client, connect, cleanup } = await setupPaginatedServer({
        secondPage: { tools: [REAL_FEEDBACK_TOOL] },
      })
      const warnings: string[] = []
      try {
        instrument(server, fakePostHog(), {
          reportMissing: false,
          collectFeedback: true,
          logger: (message: string) => warnings.push(message),
        })
        await connect()

        // The first page cannot see page two, so the virtual tool is injected
        // and the concatenated list carries the name twice.
        const [pageOne, pageTwo] = await listBothPages(client)
        expect(pageOne).toEqual(['page_one_tool', SEND_FEEDBACK_TOOL_NAME])
        expect(pageTwo).toEqual([SEND_FEEDBACK_TOOL_NAME])
        expect(warnings.some((message) => message.includes('is shadowed by the SDK'))).toBe(true)

        // Calls to the name go to the SDK, not the real tool.
        const result = await client.request(
          { method: 'tools/call', params: { name: SEND_FEEDBACK_TOOL_NAME, arguments: { summary: 'shadowed' } } },
          CallToolResultSchema
        )
        expect((result.content as { text: string }[])[0].text).toContain('recorded')
        expect(eventCapture.findEventByType(MCPAnalyticsEventType.mcpFeedback)).toBeDefined()
      } finally {
        await cleanup()
      }
    })
  })
})
