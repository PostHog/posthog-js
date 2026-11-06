import { McpServer as V1McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Server as V1Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { McpServer as V2McpServer } from '@modelcontextprotocol/server'
import { PostHog } from 'posthog-node'
import { instrument } from '../index'
import type { MCPAnalyticsOptions, MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'

const SEARCH_DOCS = {
  name: 'search_docs',
  description: 'Search the docs',
  inputSchema: { type: 'object' as const, properties: {} },
}

const V2_REQUEST_CONTEXT = { mcpReq: { requestState: () => undefined } } as never

const ok = async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })

interface Setup {
  server: object
  dispatcher: MCPServerLike
  options?: MCPAnalyticsOptions
  afterInstrument?: () => void
}

function v1HighLevel(disabled: boolean): Setup {
  const server = new V1McpServer({ name: 'v1 high-level', version: '1.0.0' })
  const tool = server.registerTool('search_docs', { description: 'Search the docs' }, ok)
  if (disabled) tool.disable()
  return { server, dispatcher: server.server as unknown as MCPServerLike }
}

function v2HighLevel(disabled: boolean): Setup {
  const server = new V2McpServer({ name: 'v2 high-level', version: '1.0.0' })
  const tool = server.registerTool('search_docs', { description: 'Search the docs' }, ok)
  if (disabled) tool.disable()
  return { server, dispatcher: server.server as unknown as MCPServerLike }
}

/** @rekog/mcp-nest binds its own dispatcher to a McpServer and never fills its tool registry. */
function highLevelWithOwnDispatcher({
  paginated = false,
  listing = Promise.resolve(),
  fails = 'throw',
}: { paginated?: boolean; listing?: Promise<void>; fails?: 'throw' | 'result' } = {}): Setup {
  const server = new V1McpServer({ name: 'mcp-nest shape', version: '1.0.0' })
  const dispatcher = server.server as unknown as MCPServerLike
  return {
    server,
    dispatcher,
    afterInstrument: () => {
      server.server.registerCapabilities({ tools: {} })
      server.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
        await listing
        return !paginated
          ? { tools: [SEARCH_DOCS] }
          : request.params?.cursor
            ? { tools: [{ ...SEARCH_DOCS, name: 'page2_tool' }] }
            : { tools: [SEARCH_DOCS], nextCursor: 'page2' }
      })
      server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (fails === 'result') {
          return { isError: true, content: [{ type: 'text' as const, text: `${request.params.name} failed` }] }
        }
        throw new Error(`${request.params.name} failed`)
      })
    },
  }
}

function lowLevel({ dispatcher, registry }: { dispatcher: boolean; registry: boolean }): Setup {
  const server = new V1Server({ name: 'low-level', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [SEARCH_DOCS] }))
  if (dispatcher) {
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== SEARCH_DOCS.name) throw new Error(`No tool named ${request.params.name}`)
      return ok()
    })
  }
  return {
    server,
    dispatcher: server as unknown as MCPServerLike,
    options: registry
      ? { resolveOriginalTool: (name) => (name === SEARCH_DOCS.name ? SEARCH_DOCS : undefined) }
      : undefined,
  }
}

async function callTool(
  { server, dispatcher, options, afterInstrument }: Setup,
  name: string,
  posthog = fakePostHog()
): Promise<string> {
  instrument(server as MCPServerLike, posthog, options)
  afterInstrument?.()
  const handler = dispatcher._requestHandlers.get('tools/call')
  try {
    const request = { method: 'tools/call', params: { name, arguments: {} } }
    const result = (await handler?.(request, V2_REQUEST_CONTEXT)) as { content: { text: string }[] }
    return `result: ${result.content[0].text}`
  } catch (error) {
    return `thrown: ${(error as Error).message}`
  }
}

describe('a tools/call for a tool the server does not have', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

  it.each([
    ['MCP SDK v1 McpServer', () => v1HighLevel(false), /^result: .*Tool no_such_tool not found/],
    ['MCP SDK v2 McpServer', () => v2HighLevel(false), /^thrown: Tool no_such_tool not found/],
    ['McpServer with its own dispatcher', () => highLevelWithOwnDispatcher(), /^thrown: no_such_tool failed/],
    [
      'low-level Server with no tools/call handler',
      () => lowLevel({ dispatcher: false, registry: false }),
      /^thrown: Unknown tool: no_such_tool/,
    ],
    [
      'low-level Server whose resolveOriginalTool has no such tool',
      () => lowLevel({ dispatcher: true, registry: true }),
      /^thrown: No tool named no_such_tool/,
    ],
  ])('on a %s, emits $mcp_unknown_tool and no tool call', async (_, setup, clientSees) => {
    const outcome = await callTool(setup(), 'no_such_tool')
    await settle()

    expect(outcome).toMatch(clientSees)
    expect(eventCapture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(0)
    expect(eventCapture.findCapturesByEvent('$exception')).toHaveLength(0)
    const unknown = eventCapture.findCapturesByEvent('$mcp_unknown_tool')
    expect(unknown).toHaveLength(1)
    expect(unknown[0].properties).toMatchObject({
      $mcp_tool_name: 'no_such_tool',
      $mcp_server_name: expect.any(String),
      $session_id: expect.stringMatching(/.+/),
    })
  })

  it.each([
    ['a disabled tool on MCP SDK v1 McpServer', () => v1HighLevel(true), 'search_docs'],
    ['a disabled tool on MCP SDK v2 McpServer', () => v2HighLevel(true), 'search_docs'],
    ['a listed tool served by its own dispatcher on McpServer', () => highLevelWithOwnDispatcher(), 'search_docs'],
    [
      'a tool on a later listing page served by its own dispatcher on McpServer',
      () => highLevelWithOwnDispatcher({ paginated: true }),
      'page2_tool',
    ],
    [
      'an unknown name on a low-level Server with no registry',
      () => lowLevel({ dispatcher: true, registry: false }),
      'no_such_tool',
    ],
  ])('records %s as a failed tool call', async (_, setup, name) => {
    await callTool(setup(), name)
    await settle()

    expect(eventCapture.findCapturesByEvent('$mcp_unknown_tool')).toHaveLength(0)
    const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].properties).toMatchObject({ $mcp_tool_name: name, $mcp_is_error: true })
  })

  it.each([
    ['constructor', 'v1', () => v1HighLevel(false)],
    ['toString', 'v1', () => v1HighLevel(false)],
    ['__proto__', 'v1', () => v1HighLevel(false)],
    ['constructor', 'v2', () => v2HighLevel(false)],
    ['hasOwnProperty', 'v2', () => v2HighLevel(false)],
  ])('treats %s, inherited by every object, as unknown on MCP SDK %s McpServer', async (name, _, setup) => {
    await callTool(setup(), name)
    await settle()

    expect(eventCapture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(0)
    expect(eventCapture.findCapturesByEvent('$mcp_unknown_tool')).toHaveLength(1)
  })

  it('redacts personal data from the requested name, which is free text', async () => {
    await callTool(lowLevel({ dispatcher: false, registry: false }), 'mail jane@example.com')
    await settle()

    const [unknown] = eventCapture.findCapturesByEvent('$mcp_unknown_tool')
    expect(unknown.properties.$mcp_tool_name).not.toContain('jane@example.com')
  })

  describe('while the listing that classifies a failed call is slow', () => {
    let releaseListing: () => void
    let listing: Promise<void>
    let posthog: PostHog

    beforeEach(() => {
      listing = new Promise((resolve) => (releaseListing = resolve))
      posthog = new PostHog('phc_test', { host: 'http://localhost', fetchRetryCount: 0 })
    })

    afterEach(async () => {
      vi.useRealTimers()
      releaseListing()
      await posthog.shutdown()
    })

    const stalled = () => new Promise<string>((resolve) => setTimeout(() => resolve('stalled'), 50))

    it.each([
      ['thrown error', 'search_docs', ['$mcp_tool_call', '$exception'], 'throw', /^thrown: search_docs failed/],
      ['thrown error', 'no_such_tool', ['$mcp_unknown_tool'], 'throw', /^thrown: no_such_tool failed/],
      ['error result', 'search_docs', ['$mcp_tool_call', '$exception'], 'result', /^result: search_docs failed/],
      ['error result', 'no_such_tool', ['$mcp_unknown_tool'], 'result', /^result: no_such_tool failed/],
    ] as const)(
      'delivers the %s for %s at once, then flush waits to publish %j',
      async (_, name, published, fails, clientSees) => {
        const setup = highLevelWithOwnDispatcher({ listing, fails })

        const outcome = await Promise.race([callTool(setup, name, posthog), stalled()])
        expect(outcome).toMatch(clientSees)

        let flushed = false
        const flush = posthog.flush().then(() => (flushed = true))
        await settle()
        expect(flushed).toBe(false)
        expect(eventCapture.getCaptures()).toHaveLength(0)

        releaseListing()
        await flush
        expect(eventCapture.getCaptures().map((c) => c.event)).toEqual(published)
      }
    )

    it.each(['throw', 'result'] as const)(
      'reports a call that fails in 0 ms (%s) as 0 ms, not the listing time',
      async (fails) => {
        vi.useFakeTimers({ toFake: ['Date'] })
        await callTool(highLevelWithOwnDispatcher({ listing, fails }), 'search_docs', posthog)

        vi.setSystemTime(Date.now() + 500)
        releaseListing()
        await posthog.flush()

        const [toolCall] = eventCapture.findCapturesByEvent('$mcp_tool_call')
        expect(toolCall.properties.$mcp_duration_ms).toBe(0)
      }
    )

    it('publishes a failed tool call once a listing that never settles misses its one-second deadline', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const neverSettles = new Promise<void>(() => {})

      const outcome = await callTool(highLevelWithOwnDispatcher({ listing: neverSettles }), 'no_such_tool', posthog)
      expect(outcome).toMatch(/^thrown: no_such_tool failed/)

      let flushed = false
      const flush = posthog.flush().then(() => (flushed = true))
      await vi.advanceTimersByTimeAsync(999)
      expect(flushed).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await flush
      expect(eventCapture.getCaptures().map((c) => c.event)).toEqual(['$mcp_tool_call', '$exception'])
    })
  })
})
