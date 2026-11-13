import { McpServer as V1McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Server as V1Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { McpServer as V2McpServer } from '@modelcontextprotocol/server'
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

function v1HighLevelRegisteredAfterInstrument(): Setup {
  const server = new V1McpServer({ name: 'v1 high-level', version: '1.0.0' })
  return {
    server,
    dispatcher: server.server as unknown as MCPServerLike,
    afterInstrument: () => server.registerTool('search_docs', { description: 'Search the docs' }, ok),
  }
}

/**
 * @rekog/mcp-nest binds its own dispatcher to a McpServer and never fills its tool
 * registry. On v2 it replaces the dispatcher the McpServer constructor installed.
 */
function highLevelWithOwnDispatcher(major: 'v1' | 'v2', fails: 'throw' | 'result' = 'throw'): Setup {
  const server =
    major === 'v1'
      ? new V1McpServer({ name: 'mcp-nest shape', version: '1.0.0' })
      : new V2McpServer({ name: 'mcp-nest shape', version: '1.0.0' }, { capabilities: { tools: {} } })
  const dispatcher = server.server as unknown as MCPServerLike
  const dispatch = async (request: { params: { name: string } }) => {
    if (fails === 'result') {
      return { isError: true, content: [{ type: 'text' as const, text: `${request.params.name} failed` }] }
    }
    throw new Error(`${request.params.name} failed`)
  }
  return {
    server,
    dispatcher,
    afterInstrument: () => {
      if (server instanceof V1McpServer) {
        server.server.registerCapabilities({ tools: {} })
        server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [SEARCH_DOCS] }))
        server.server.setRequestHandler(CallToolRequestSchema, dispatch)
      } else {
        server.server.setRequestHandler('tools/list', async () => ({ tools: [SEARCH_DOCS] }))
        server.server.setRequestHandler('tools/call', dispatch)
      }
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

  it.each([
    ['MCP SDK v1 McpServer', () => v1HighLevel(false), /^result: .*Tool no_such_tool not found/],
    ['MCP SDK v2 McpServer', () => v2HighLevel(false), /^thrown: Tool no_such_tool not found/],
    [
      'MCP SDK v1 McpServer with tools registered after instrument()',
      v1HighLevelRegisteredAfterInstrument,
      /^result: .*Tool no_such_tool not found/,
    ],
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
    ...(['v1', 'v2'] as const).flatMap((major) =>
      (['throw', 'result'] as const).flatMap((fails) =>
        ['search_docs', 'no_such_tool'].map(
          (name) =>
            [
              `${name} (${fails}) on an MCP SDK ${major} McpServer with its own dispatcher`,
              () => highLevelWithOwnDispatcher(major, fails),
              name,
            ] as const
        )
      )
    ),
    [
      'an unknown name on a low-level Server with no registry',
      () => lowLevel({ dispatcher: true, registry: false }),
      'no_such_tool',
    ],
  ])('records %s as a failed tool call', async (_, setup, name) => {
    await callTool(setup(), name)

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

    expect(eventCapture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(0)
    expect(eventCapture.findCapturesByEvent('$mcp_unknown_tool')).toHaveLength(1)
  })

  it('redacts personal data from the requested name, which is free text', async () => {
    await callTool(lowLevel({ dispatcher: false, registry: false }), 'mail jane@example.com')

    const [unknown] = eventCapture.findCapturesByEvent('$mcp_unknown_tool')
    expect(unknown.properties.$mcp_tool_name).not.toContain('jane@example.com')
  })
})
