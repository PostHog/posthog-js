import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { cacheToolListing } from '../extensions/instrumentation'
import { getServerTrackingData } from '../extensions/internal'
import type { CompatibleRequestHandlerExtra, MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'

const tenant = (name: string, chat?: string): CompatibleRequestHandlerExtra =>
  ({ requestInfo: { headers: { 'x-tenant': name, ...(chat ? { 'x-chat': chat } : {}) } } }) as never

const header = (extra: CompatibleRequestHandlerExtra | undefined, name: string): string | undefined =>
  extra?.requestInfo?.headers?.[name] as string | undefined

interface Catalogue {
  sessionId?: (extra?: CompatibleRequestHandlerExtra) => string | undefined
  tools: (tenant: string) => Array<{ name: string; argument: string }>
}

function createServer(catalogue: Catalogue) {
  const server = new Server({ name: 'schema-cache', version: '1.0.0' }, { capabilities: { tools: {} } })
  const lowLevel = server as unknown as MCPServerLike
  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => ({
    tools: catalogue.tools(String(header(extra as CompatibleRequestHandlerExtra, 'x-tenant'))).map((tool) => ({
      name: tool.name,
      inputSchema: { type: 'object' as const, properties: { [tool.argument]: { type: 'string' } } },
    })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }))
  instrument(lowLevel, fakePostHog(), {
    enableConversationId: false,
    ...(catalogue.sessionId ? { sessionId: (_request, extra) => catalogue.sessionId!(extra) } : {}),
  })
  return {
    lowLevel,
    list: (extra: CompatibleRequestHandlerExtra) =>
      lowLevel._requestHandlers.get('tools/list')!({ method: 'tools/list', params: {} }, extra),
    call: (extra: CompatibleRequestHandlerExtra, name: string, args: Record<string, unknown>) =>
      lowLevel._requestHandlers.get('tools/call')!({ method: 'tools/call', params: { name, arguments: args } }, extra),
  }
}

function retainedSchemaCount(lowLevel: MCPServerLike): number {
  const cache = (
    getServerTrackingData(lowLevel)!.toolInputSchemas as unknown as { _cache: Map<string, Map<string, unknown>> }
  )._cache
  return [...cache.values()].reduce((total, schemas) => total + schemas.size, 0)
}

describe('the schemas a listing advertises', () => {
  let capture: EventCapture

  beforeEach(async () => {
    capture = new EventCapture()
    await capture.start()
  })

  afterEach(async () => {
    await capture.stop()
  })

  const inputKeys = async (): Promise<unknown[]> => {
    await new Promise((r) => setTimeout(r, 50))
    return capture.findCapturesByEvent('$mcp_tool_call').map((e) => e.properties.$mcp_input_keys)
  }

  it("stay with the host session that listed them, so one tenant's listing never decides another's input keys", async () => {
    const { list, call } = createServer({
      sessionId: (extra) => header(extra, 'x-tenant'),
      tools: (t) => [{ name: 'search', argument: `${t}_field` }],
    })

    await list(tenant('a'))
    await list(tenant('b'))
    await call(tenant('a'), 'search', { a_field: 'x' })
    await call(tenant('b'), 'search', { b_field: 'x' })

    expect(await inputKeys()).toEqual([['a_field'], ['b_field']])
  })

  it.each([
    ['answers for the call but not its listing', undefined, 'chat-1'],
    ['answers for the listing but not its call', 'chat-1', undefined],
    ['gives the listing and its call different answers', 'chat-1', 'chat-2'],
  ])('reach a call when the host session callback %s', async (_case, listChat, callChat) => {
    const { list, call } = createServer({
      sessionId: (extra) => header(extra, 'x-chat'),
      tools: () => [{ name: 'search', argument: 'query' }],
    })

    await list(tenant('a', listChat))
    await call(tenant('a', callChat), 'search', { query: 'x', other: 'y' })

    expect(await inputKeys()).toEqual([['query', '[redacted]']])
  })

  it('all reach their calls from one large catalogue', async () => {
    const tools = Array.from({ length: 1200 }, (_, i) => ({ name: `tool_${i}`, argument: 'query' }))
    const { list, call } = createServer({ tools: () => tools })

    await list(tenant('a'))
    await call(tenant('a'), 'tool_0', { query: 'x' })
    await call(tenant('a'), 'tool_1199', { query: 'x' })

    expect(await inputKeys()).toEqual([['query'], ['query']])
  })

  it('fall back to a seeded listing that other sessions never evict', async () => {
    const { lowLevel, list, call } = createServer({
      sessionId: (extra) => header(extra, 'x-tenant'),
      tools: (t) => [{ name: `search_${t}`, argument: 'query' }],
    })
    cacheToolListing(lowLevel, [
      { name: 'seeded', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
    ])

    for (let i = 0; i < 1100; i++) {
      await list(tenant(`tenant_${i}`))
    }
    await call(tenant('tenant_1099'), 'seeded', { query: 'x' })

    expect(await inputKeys()).toEqual([['query']])
  })

  it.each([
    ['host sessions, an entry each plus the shared one', true, 11_100, 1000 + 10_000],
    ['sessionless requests, one shared entry', false, 10_100, 10_000],
  ])('stay bounded across many listings from %s', async (_case, hostSessions, listings, bound) => {
    const { lowLevel, list } = createServer({
      ...(hostSessions ? { sessionId: (extra) => header(extra, 'x-tenant') } : {}),
      tools: (t) => [{ name: `search_${t}`, argument: 'query' }],
    })

    for (let i = 0; i < listings; i++) {
      await list(tenant(`tenant_${i}`))
    }

    expect(retainedSchemaCount(lowLevel)).toBeLessThanOrEqual(bound)
  })
})
