import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { CompatibleRequestHandlerExtra, MCPRequestLike, MCPServerLike } from '../types'

type Runtime = 'async context' | 'no async context'
type Method = 'tools/call' | 'tools/list' | 'resources/read'

/** Loads the SDK fresh, as a runtime without `process.getBuiltinModule` (Workers without Node compatibility) would. */
async function loadSdk(runtime: Runtime) {
  vi.resetModules()
  const original = process.getBuiltinModule
  if (runtime === 'no async context') {
    ;(process as { getBuiltinModule?: unknown }).getBuiltinModule = undefined
  }
  try {
    const sdk = await import('../index')
    const utils = await import('./test-utils')
    const capture = new utils.EventCapture()
    await capture.start()
    return { sdk, utils, capture }
  } finally {
    process.getBuiltinModule = original
  }
}

type Sdk = Awaited<ReturnType<typeof loadSdk>>

const caller = (name: string, token?: string): CompatibleRequestHandlerExtra =>
  ({ requestInfo: { headers: { 'x-caller': name, ...(token ? { 'mcp-session-id': token } : {}) } } }) as never

const callerOf = (extra?: CompatibleRequestHandlerExtra): string => String(extra?.requestInfo?.headers?.['x-caller'])

const requests: Record<Method, MCPRequestLike> = {
  'tools/call': { method: 'tools/call', params: { name: 'search', arguments: {} } },
  'tools/list': { method: 'tools/list', params: {} },
  'resources/read': { method: 'resources/read', params: { uri: 'file:///doc' } },
}

/** A server whose every handler captures a custom event, after waiting at `pause` for its caller. */
function createServer({ sdk, utils }: Sdk, pause: (name: string) => Promise<void> = async () => {}) {
  const server = new Server({ name: 'request-scope', version: '1.0.0' }, { capabilities: { tools: {}, resources: {} } })
  const lowLevel = server as unknown as MCPServerLike
  const handle = async (extra: unknown): Promise<void> => {
    await pause(callerOf(extra as CompatibleRequestHandlerExtra))
    await analytics.capture({ event: 'domain_action' })
  }
  server.setRequestHandler(CallToolRequestSchema, async (_request, extra) => {
    await handle(extra)
    return { content: [{ type: 'text' as const, text: 'ok' }] }
  })
  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    await handle(extra)
    return { tools: [{ name: 'search', inputSchema: { type: 'object' as const } }] }
  })
  server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
    await handle(extra)
    return { contents: [{ uri: request.params.uri, text: 'ok' }] }
  })
  const analytics = sdk.instrument(lowLevel, utils.fakePostHog(), {
    enableConversationId: false,
    identify: async (_request, extra) => ({
      distinctId: callerOf(extra),
      groups: { org: `${callerOf(extra)}-org` },
    }),
  })
  return (method: Method, extra: CompatibleRequestHandlerExtra) =>
    lowLevel._requestHandlers.get(method)!(requests[method], extra)
}

const runtimes: Runtime[] = ['async context', 'no async context']
const methods: Method[] = ['tools/call', 'tools/list', 'resources/read']
const cases = runtimes.flatMap((runtime) => methods.map((method) => [runtime, method] as const))

/**
 * With async context a custom event carries the request it was captured in. Without
 * it nothing tells the requests apart, so the event carries no caller at all.
 */
function expectCustomEventsAttributed(loaded: Sdk, runtime: Runtime, callers: string[]): void {
  const calls = loaded.capture.findCapturesByEvent('$mcp_tool_call')
  const customs = loaded.capture.findCapturesByEvent('domain_action')
  if (runtime === 'async context') {
    for (const name of callers) {
      const own = customs.filter((e) => e.distinct_id === name)
      expect(own).toHaveLength(1)
      expect(own[0].properties.$groups).toEqual({ org: `${name}-org` })
    }
    return
  }
  const callSessions = calls.map((e) => e.properties.$session_id)
  for (const custom of customs) {
    expect(callers).not.toContain(custom.distinct_id)
    expect(custom.properties.$groups).toBeUndefined()
    expect(callSessions).not.toContain(custom.properties.$session_id)
    expect(custom.properties.$mcp_server_name).toBe('request-scope')
    expect(custom.properties.$mcp_client_name).toBeUndefined()
  }
}

describe('a custom event captured while a request is handled', () => {
  let loaded: Sdk | undefined

  afterEach(async () => {
    await loaded?.capture.stop()
    loaded = undefined
  })

  it.each(cases)('never takes the caller before it (%s, %s)', async (runtime, method) => {
    loaded = await loadSdk(runtime)
    const send = createServer(loaded)

    await send(
      'tools/call',
      caller('alice', loaded.sdk.encodeSessionId({ sessionId: 'ses_alice', clientName: 'alice-client' }))
    )
    await send(method, caller('bob'))
    await new Promise((r) => setTimeout(r, 50))

    expectCustomEventsAttributed(loaded, runtime, ['alice', 'bob'])
  })

  it.each(runtimes)('never takes another caller when calls overlap (%s)', async (runtime) => {
    loaded = await loadSdk(runtime)
    const gates = new Map<string, () => void>()
    const send = createServer(loaded, (name) => new Promise<void>((resolve) => gates.set(name, resolve)))
    const until = async (name: string): Promise<void> => {
      while (!gates.has(name)) await new Promise((r) => setTimeout(r, 5))
    }

    const alice = send(
      'tools/call',
      caller('alice', loaded.sdk.encodeSessionId({ sessionId: 'ses_alice', clientName: 'alice-client' }))
    )
    await until('alice')
    const bob = send('tools/call', caller('bob'))
    await until('bob')
    gates.get('alice')!()
    await alice
    gates.get('bob')!()
    await bob
    await new Promise((r) => setTimeout(r, 50))

    expectCustomEventsAttributed(loaded, runtime, ['alice', 'bob'])
  })
})
