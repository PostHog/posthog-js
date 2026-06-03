/**
 * Integration tests for the SDK's error-capture plumbing on the tool-call path.
 *
 * Pure error-capture-function behavior (stack parsing, cause chains, path
 * normalization, non-Error throwables) is covered in `exceptions.test.ts`.
 * These tests only check that the tracing wrapper carries those captured
 * errors onto the published event, plus a few integration-only behaviors
 * the unit tests can't reach.
 */
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { instrument } from '../index'
import { EventCapture, fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

let capture: EventCapture
let cleanup: () => Promise<void>
let server: any
let client: any

beforeEach(async () => {
  resetTodos()
  capture = new EventCapture()
  await capture.start()
  const setup = await setupTestServerAndClient()
  server = setup.server
  client = setup.client
  cleanup = setup.cleanup
})

afterEach(async () => {
  await capture.stop()
  await cleanup()
})

describe('error capture on the tool-call path', () => {
  it('captures errors thrown inside the tool callback (with stack + frames)', async () => {
    instrument(server, { posthog: fakePostHog() })

    const result = await client.request(
      {
        method: 'tools/call',
        params: { name: 'complete_todo', arguments: { id: 'nonexistent-id', context: 'test' } },
      },
      CallToolResultSchema
    )

    expect(result.isError).toBe(true)
    await new Promise((r) => setTimeout(r, 50))

    const event = capture.findEventsByResourceName('complete_todo').find((e) => e.isError)
    const exception = event?.error?.$exception_list?.[0]
    expect(exception?.value).toContain('not found')
    expect(exception?.type).toBe('Error')
    expect(exception?.stacktrace?.frames?.length).toBeGreaterThan(0)
  })

  it('still propagates the error result to the MCP client (does not swallow it)', async () => {
    instrument(server, { posthog: fakePostHog() })

    const result = await client.request(
      {
        method: 'tools/call',
        params: { name: 'complete_todo', arguments: { id: 'invalid', context: 'test' } },
      },
      CallToolResultSchema
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('not found')
  })

  it('publishes a single (non-error) event for a successful tool call', async () => {
    instrument(server, { posthog: fakePostHog() })

    await client.request(
      { method: 'tools/call', params: { name: 'add_todo', arguments: { text: 'ok', context: 'test' } } },
      CallToolResultSchema
    )
    await new Promise((r) => setTimeout(r, 50))

    const events = capture.findEventsByResourceName('add_todo')
    expect(events).toHaveLength(1)
    expect(events[0].isError).toBe(false)
    expect(events[0].error).toBeUndefined()
    expect(events[0].duration).toEqual(expect.any(Number))
  })

  it.each([
    [
      'invalid enum value',
      () => {
        server.tool!(
          'calculate',
          'calc',
          { op: z.enum(['add', 'sub']), a: z.number(), b: z.number() },
          async (args: any) => ({ content: [{ type: 'text', text: String(args.a) }] })
        )
      },
      'calculate',
      { op: 'modulo', a: 10, b: 3, context: 'test' },
    ],
    [
      'missing required parameter',
      () => {
        // add_todo already requires `text`
      },
      'add_todo',
      { context: 'test' },
    ],
  ])('captures Zod validation failures (%s) as $exception events', async (_, register, toolName, args) => {
    register()
    instrument(server, { posthog: fakePostHog() })

    // MCP SDK <1.21 throws; ≥1.21 returns CallToolResult with isError: true.
    await client
      .request({ method: 'tools/call', params: { name: toolName, arguments: args } }, CallToolResultSchema)
      .catch(() => undefined)

    await new Promise((r) => setTimeout(r, 50))
    const event = capture.findEventsByResourceName(toolName).find((e) => e.isError)
    const exception = event?.error?.$exception_list?.[0]
    expect(exception?.value).toMatch(/Invalid|required/i)
    expect(['McpError', 'Error', undefined]).toContain(exception?.type)
  })

  it('captures errors for unknown tool names', async () => {
    instrument(server, { posthog: fakePostHog() })

    await client
      .request(
        { method: 'tools/call', params: { name: 'nonexistent_tool', arguments: { context: 'x' } } },
        CallToolResultSchema
      )
      .catch(() => undefined)

    await new Promise((r) => setTimeout(r, 50))
    const event = capture.findEventsByResourceName('nonexistent_tool').find((e) => e.isError)
    expect(event?.error?.$exception_list?.[0]?.value).toContain('not found')
  })
})
