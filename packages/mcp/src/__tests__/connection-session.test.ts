import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { MCP_SESSION_HEADER, encodeSessionId } from '../extensions/session-token'
import type { CompatibleRequestHandlerExtra, MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'

/**
 * Rule 3 of the spec's "Session identity" for a one-client connection (stdio): the
 * generated id rotates on the first tool call that arrives 30 minutes or more
 * after the previous tool call on that connection ended.
 */

type Step = { call: number } | { wait: number } | { list: true } | { custom: true }

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))

let release: () => void = () => {}
let gate: Promise<void> = Promise.resolve()

function createStdioServer(): { server: MCPServerLike; capture: (event: string) => Promise<void> } {
  const server = new Server({ name: 'stdio', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'work', inputSchema: { type: 'object', properties: { minutes: { type: 'number' } } } }],
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.arguments?.block) {
      await gate
    }
    vi.advanceTimersByTime(Number(request.params.arguments?.minutes ?? 0) * 60_000)
    return { content: [{ type: 'text', text: 'done' }] }
  })
  const analytics = instrument(server, fakePostHog(), { enableConversationId: false })
  return {
    server: server as unknown as MCPServerLike,
    capture: (event) => analytics.capture({ event }),
  }
}

describe('one-client connection session rotation', () => {
  let events: EventCapture

  beforeEach(async () => {
    events = new EventCapture()
    await events.start()
    vi.useFakeTimers({ toFake: ['Date'] })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await events.stop()
  })

  const sessions = (): unknown[] =>
    events
      .getCaptures()
      .filter((event) => event.event === '$mcp_tool_call' || event.event === 'mark')
      .map((event) => event.properties.$session_id)

  async function run(steps: Step[]): Promise<void> {
    const { server, capture } = createStdioServer()
    const callTool = server._requestHandlers.get('tools/call')!
    for (const step of steps) {
      if ('call' in step) {
        await callTool({ method: 'tools/call', params: { name: 'work', arguments: { minutes: step.call } } })
      } else if ('wait' in step) {
        vi.advanceTimersByTime(step.wait * 60_000)
      } else if ('list' in step) {
        await server._requestHandlers.get('tools/list')!({ method: 'tools/list', params: {} })
      } else {
        await capture('mark')
      }
      await settle()
    }
  }

  /** Each letter is one recorded event; equal letters must share a session. */
  function expectGroups(groups: string): void {
    const recorded = sessions()
    expect(recorded).toHaveLength(groups.length)
    const byLetter = new Map<string, unknown>()
    for (const [index, letter] of [...groups].entries()) {
      if (!byLetter.has(letter)) {
        expect([...byLetter.values()]).not.toContain(recorded[index])
        byLetter.set(letter, recorded[index])
      }
      expect(recorded[index]).toBe(byLetter.get(letter))
    }
  }

  it.each<{ name: string; steps: Step[]; groups: string }>([
    {
      name: 'keeps the session 29 minutes after a call',
      steps: [{ call: 0 }, { wait: 29 }, { call: 0 }],
      groups: 'aa',
    },
    { name: 'rotates at exactly 30 minutes', steps: [{ call: 0 }, { wait: 30 }, { call: 0 }], groups: 'ab' },
    {
      name: 'measures the gap from when the previous call ended',
      steps: [{ call: 20 }, { wait: 15 }, { call: 0 }],
      groups: 'aa',
    },
    {
      name: 'does not let a listing keep the session alive',
      steps: [{ call: 0 }, { wait: 20 }, { list: true }, { wait: 20 }, { call: 0 }],
      groups: 'ab',
    },
    {
      name: 'does not rotate on a listing after the gap',
      steps: [{ call: 0 }, { wait: 40 }, { list: true }, { custom: true }, { call: 0 }],
      groups: 'aab',
    },
    {
      name: 'keeps the startup session for the first call however late',
      steps: [{ custom: true }, { wait: 120 }, { call: 0 }],
      groups: 'aa',
    },
  ])('$name', async ({ steps, groups }) => {
    await run(steps)
    expectGroups(groups)
  })

  it('does not rotate while an earlier call is still running', async () => {
    gate = new Promise((resolve) => (release = resolve))
    const { server } = createStdioServer()
    const call = (args: Record<string, unknown>): Promise<unknown> =>
      server._requestHandlers.get('tools/call')!({ method: 'tools/call', params: { name: 'work', arguments: args } })

    await call({})
    vi.advanceTimersByTime(60_000)
    const running = call({ block: true })
    vi.advanceTimersByTime(40 * 60_000)
    await call({})
    release()
    await running
    await settle()

    expectGroups('aaa')
  })

  it('restarts the idle clock when an earlier call ends after a later one', async () => {
    gate = new Promise((resolve) => (release = resolve))
    const { server } = createStdioServer()
    const call = (args: Record<string, unknown>): Promise<unknown> =>
      server._requestHandlers.get('tools/call')!({ method: 'tools/call', params: { name: 'work', arguments: args } })

    const earlier = call({ block: true })
    await call({})
    vi.advanceTimersByTime(40 * 60_000)
    release()
    await earlier
    await call({})
    await settle()

    expectGroups('aaa')
  })

  it('rotates when an earlier call never settles but the latest call ended', async () => {
    gate = new Promise(() => {})
    const { server } = createStdioServer()
    const call = (args: Record<string, unknown>): Promise<unknown> =>
      server._requestHandlers.get('tools/call')!({ method: 'tools/call', params: { name: 'work', arguments: args } })

    void call({ block: true })
    await call({})
    vi.advanceTimersByTime(40 * 60_000)
    await call({})
    await settle()

    expectGroups('ab')
  })

  it.each<{ name: string; extra: CompatibleRequestHandlerExtra }>([
    { name: 'a transport session', extra: { sessionId: 'transport-session' } },
    {
      name: 'a replayed session token',
      extra: { requestInfo: { headers: { [MCP_SESSION_HEADER]: encodeSessionId({ sessionId: 'ses_carried' }) } } },
    },
  ])('never rotates $name', async ({ extra }) => {
    const { server } = createStdioServer()
    const call = (): Promise<unknown> =>
      server._requestHandlers.get('tools/call')!(
        { method: 'tools/call', params: { name: 'work', arguments: {} } },
        extra
      )

    await call()
    vi.advanceTimersByTime(40 * 60_000)
    await call()
    await settle()

    expectGroups('aa')
  })
})
