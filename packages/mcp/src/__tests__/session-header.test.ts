import { MCP_SESSION_HEADER, decodeSessionId, withMcpSessionHeader } from '../index'

const URL = 'https://example.test/mcp'
const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Claude', version: '1.2.3' } },
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** A fetch handler that answers with what it was handed, so the test sees the request it got. */
function echoHandler(status = 200) {
  return vi.fn(async (request: Request) => {
    const body = request.method === 'POST' ? await request.text() : ''
    return Response.json({ body, sessionHeader: request.headers.get(MCP_SESSION_HEADER) }, { status })
  })
}

describe('withMcpSessionHeader', () => {
  it('mints a token for a 2025-era initialize and hands the same one to the handler', async () => {
    const handler = echoHandler()
    const response = await withMcpSessionHeader(handler)(post(INITIALIZE))

    const token = response.headers.get(MCP_SESSION_HEADER)
    const seen = (await response.json()) as { body: string; sessionHeader: string | null }
    expect(decodeSessionId(token)).toEqual({
      sessionId: expect.stringMatching(/^ses_/),
      clientName: 'Claude',
      clientVersion: '1.2.3',
      protocolVersion: '2025-11-25',
    })
    expect(seen.sessionHeader).toBe(token)
    expect(JSON.parse(seen.body)).toEqual(INITIALIZE)
  })

  it.each([
    ['a request that replays a session', () => post(INITIALIZE, { [MCP_SESSION_HEADER]: 'existing' })],
    ['a body over the size cap', () => post({ ...INITIALIZE, padding: 'x'.repeat(70_000) })],
    ['a request declaring a body over the size cap', () => post(INITIALIZE, { 'content-length': '70000' })],
    ['a 2026-era request', () => post({ ...INITIALIZE, method: 'tools/list' }, { 'mcp-method': 'tools/list' })],
    ['a request that is not initialize', () => post({ ...INITIALIZE, method: 'tools/list' })],
    ['a body that is not JSON', () => post('not json')],
    ...['2026-07-28', 'draft'].map(
      (protocolVersion) =>
        [
          `an initialize asking for ${protocolVersion}`,
          () => post({ ...INITIALIZE, params: { ...INITIALIZE.params, protocolVersion } }),
        ] as [string, () => Request]
    ),
    ['a GET', () => new Request(URL)],
  ])('passes %s through untouched', async (_case, request) => {
    const original = request()
    const sentHeader = original.headers.get(MCP_SESSION_HEADER)
    const sentBody = original.method === 'POST' ? await original.clone().text() : ''
    const handler = echoHandler()

    const response = await withMcpSessionHeader(handler)(original)

    expect(await response.json()).toEqual({ body: sentBody, sessionHeader: sentHeader })
    expect(response.headers.get(MCP_SESSION_HEADER)).toBeNull()
  })

  it('mints a token for an initialize that already declares its protocol version', async () => {
    const response = await withMcpSessionHeader(echoHandler())(
      post(INITIALIZE, { 'mcp-protocol-version': '2025-11-25' })
    )

    expect(decodeSessionId(response.headers.get(MCP_SESSION_HEADER))?.clientName).toBe('Claude')
  })

  it('keeps a session id the handler issued itself', async () => {
    const handler = vi.fn(async () => new Response('{}', { headers: { [MCP_SESSION_HEADER]: 'stateful-1' } }))

    const response = await withMcpSessionHeader(handler)(post(INITIALIZE))

    expect(response.headers.get(MCP_SESSION_HEADER)).toBe('stateful-1')
  })

  it.each([
    [
      'while the body is read',
      (controller: AbortController, run: () => Response | Promise<Response>) => {
        const pending = Promise.resolve(run())
        controller.abort()
        return pending
      },
    ],
    [
      'before the wrapper runs',
      (controller: AbortController, run: () => Response | Promise<Response>) => {
        controller.abort()
        return Promise.resolve(run())
      },
    ],
  ])('stops reading a stalled body when the client aborts %s', async (_case, abortAnd) => {
    const aborted = new AbortController()
    const stalled = new ReadableStream<Uint8Array>({
      start: (controller) => controller.enqueue(new TextEncoder().encode('{"method":"initia')),
    })
    const request = new Request(URL, {
      method: 'POST',
      body: stalled,
      signal: aborted.signal,
      duplex: 'half',
    } as RequestInit)
    const handler = vi.fn(async () => new Response('aborted'))

    const response = await abortAnd(aborted, () => withMcpSessionHeader(handler)(request))

    expect(await response.text()).toBe('aborted')
  })

  it('leaves a failed initialize without a token', async () => {
    const response = await withMcpSessionHeader(echoHandler(400))(post(INITIALIZE))

    expect(response.status).toBe(400)
    expect(response.headers.get(MCP_SESSION_HEADER)).toBeNull()
  })

  it.each([
    ['mutable', (request: Request) => request, 'stale'],
    [
      'immutable',
      (request: Request) => {
        const headers = new Headers(request.headers)
        Object.defineProperty(headers, 'set', {
          value: () => {
            throw new TypeError('immutable')
          },
        })
        return Object.defineProperty(request, 'headers', { value: headers, enumerable: false })
      },
      undefined,
    ],
  ])('keeps what an auth wrapper set on a request with %s headers', async (_case, seal, keptInternal) => {
    const internal = Symbol('request internals')
    const handler = vi.fn(async (request: Request & { auth?: unknown }) =>
      Response.json({
        auth: request.auth,
        sessionHeader: request.headers.get(MCP_SESSION_HEADER),
        body: JSON.parse(await request.text()),
        internal: (request as unknown as Record<symbol, unknown>)[internal],
      })
    )
    const request = seal(Object.assign(post(INITIALIZE), { auth: { token: 'abc' }, [internal]: 'stale' }))

    const response = await withMcpSessionHeader(handler)(request)

    expect(await response.json()).toEqual({
      auth: { token: 'abc' },
      sessionHeader: response.headers.get(MCP_SESSION_HEADER),
      body: INITIALIZE,
      internal: keptInternal,
    })
  })

  it('forwards the extra arguments a framework passes the handler', async () => {
    const handler = vi.fn(async (_request: Request, context: { params: string }) => Response.json(context))

    const response = await withMcpSessionHeader(handler)(post(INITIALIZE), { params: 'route' })

    expect(await response.json()).toEqual({ params: 'route' })
  })
})
