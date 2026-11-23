/**
 * Integration tests for the SDK's error-capture plumbing on the tool-call path.
 *
 * Pure error-capture-function behavior (stack parsing, cause chains, path
 * normalization, non-Error throwables) is covered in `exceptions.test.ts`.
 * These tests only check that the tracing wrapper carries those captured
 * errors onto the published event, plus a few integration-only behaviors
 * the unit tests can't reach.
 */
import { runInNewContext } from 'node:vm'

import { CallToolResultSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
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
    instrument(server, fakePostHog())

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

  it('redacts PostHog tokens from the emitted error message and type', async () => {
    instrument(server, fakePostHog())
    const projectToken = 'phc_123456789012345678901234567890'
    const personalToken = 'phx_abcdefghijklmnopqrstuvwxyz1234'

    server.tool!('secret_error', 'throws a sensitive error', {}, async () => {
      throw Object.assign(new Error(`Project token ${projectToken} and personal token ${personalToken}`), {
        name: `UpstreamError ${projectToken}`,
      })
    })

    const result = await client.request(
      {
        method: 'tools/call',
        params: { name: 'secret_error', arguments: {} },
      },
      CallToolResultSchema
    )

    // Sanitization applies only to analytics and must not alter the MCP result.
    expect(result.content[0].text).toContain(projectToken)
    await new Promise((r) => setTimeout(r, 50))

    const toolCall = capture
      .findCapturesByEvent('$mcp_tool_call')
      .find((event) => event.properties.$mcp_tool_name === 'secret_error')
    const exception = capture
      .findCapturesByEvent('$exception')
      .find((event) => event.properties.$mcp_tool_name === 'secret_error')
    const expected = 'Project token [redacted] and personal token [redacted]'
    const exceptionList = exception?.properties.$exception_list as Array<{ type: string; value: string }> | undefined

    expect(toolCall?.properties.$mcp_error_message).toBe(expected)
    expect(exceptionList?.[0].value).toBe(expected)
    expect(toolCall?.properties.$mcp_error_type).toBe('UpstreamError [redacted]')
    expect(exceptionList?.[0].type).toBe('UpstreamError [redacted]')
  })

  it.each([
    [
      'an error wrapping a failed fetch',
      () =>
        new Error('invoice lookup failed', {
          cause: Object.assign(new Error('503 from upstream'), { response: new Response(null, { status: 503 }) }),
        }),
      'Error',
    ],
    [
      'an error from another realm',
      () =>
        runInNewContext(
          'class UpstreamError extends Error { name = "UpstreamError" }; Object.assign(new UpstreamError("down"), { status: 503 })'
        ),
      'UpstreamError',
    ],
    ['a fetch Response', () => new Response(null, { status: 503 }), 'Error'],
    ['a plain object', () => ({ name: 'UpstreamError', message: 'down', status: 503 }), 'UpstreamError'],
    [
      'an object whose message getter throws',
      () => ({
        status: 503,
        get message() {
          throw new Error('not loaded')
        },
      }),
      'Error',
    ],
  ])('carries the HTTP status and type when the tool throws %s', async (_case, thrown, errorType) => {
    instrument(server, fakePostHog())

    server.tool!('fetch_invoice', 'fetches an invoice', {}, async () => {
      throw thrown()
    })

    await client.request(
      { method: 'tools/call', params: { name: 'fetch_invoice', arguments: {} } },
      CallToolResultSchema
    )
    await new Promise((r) => setTimeout(r, 50))

    const toolCall = capture
      .findCapturesByEvent('$mcp_tool_call')
      .find((event) => event.properties.$mcp_tool_name === 'fetch_invoice')
    expect(toolCall?.properties.$mcp_error_status).toBe(503)
    expect(toolCall?.properties.$mcp_error_type).toBe(errorType)
  })

  it('still publishes the call when the thrown value has a throwing getter', async () => {
    instrument(server, fakePostHog())
    server.tool!('odd_failure', 'throws an odd value', {}, async () => {
      throw Object.defineProperty({ isError: true }, 'content', {
        enumerable: true,
        get() {
          throw new Error('not loaded')
        },
      })
    })

    await client
      .request({ method: 'tools/call', params: { name: 'odd_failure', arguments: {} } }, CallToolResultSchema)
      .catch(() => undefined)
    await new Promise((r) => setTimeout(r, 50))

    const [toolCall] = capture
      .findCapturesByEvent('$mcp_tool_call')
      .filter((event) => event.properties.$mcp_tool_name === 'odd_failure')
    expect(toolCall?.properties.$mcp_is_error).toBe(true)
  })

  it('keeps the message the tool result carries when reading the error name throws', async () => {
    instrument(server, fakePostHog())

    server.tool!('fetch_invoice', 'fetches an invoice', {}, async () => {
      const error = Object.assign(new Error('invoice service down'), { status: 503 })
      Object.defineProperty(error, 'name', {
        get() {
          throw new Error('not loaded')
        },
      })
      throw error
    })

    await client.request(
      { method: 'tools/call', params: { name: 'fetch_invoice', arguments: {} } },
      CallToolResultSchema
    )
    await new Promise((r) => setTimeout(r, 50))

    const toolCall = capture
      .findCapturesByEvent('$mcp_tool_call')
      .find((event) => event.properties.$mcp_tool_name === 'fetch_invoice')
    expect(toolCall?.properties.$mcp_error_message).toBe('invoice service down')
    expect(toolCall?.properties.$mcp_error_status).toBe(503)
  })

  it('carries the HTTP status on every server that registers the same tool function', async () => {
    const failing = async () => {
      throw Object.assign(new Error('down'), { status: 503 })
    }
    const second = await setupTestServerAndClient()
    try {
      for (const target of [server, second.server]) {
        instrument(target, fakePostHog())
        target.tool('fetch_invoice', 'fetches an invoice', {}, failing)
      }

      await second.client.request(
        { method: 'tools/call', params: { name: 'fetch_invoice', arguments: {} } },
        CallToolResultSchema
      )
      await new Promise((r) => setTimeout(r, 50))

      const toolCall = capture
        .findCapturesByEvent('$mcp_tool_call')
        .find((event) => event.properties.$mcp_tool_name === 'fetch_invoice')
      expect(toolCall?.properties.$mcp_error_status).toBe(503)
    } finally {
      await second.cleanup()
    }
  })

  it('still propagates the error result to the MCP client (does not swallow it)', async () => {
    instrument(server, fakePostHog())

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
    instrument(server, fakePostHog())

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

  const registerCalculate = () =>
    server.tool!(
      'calculate',
      'calc',
      { op: z.enum(['add', 'sub']), a: z.number(), b: z.number() },
      async (args: any) => ({ content: [{ type: 'text', text: String(args.a) }] })
    )

  it.each([
    ['invalid enum value', registerCalculate, 'calculate', { op: 'modulo', a: 10, b: 3 }, 'validation'],
    ['missing required parameter', () => {}, 'add_todo', {}, 'validation'],
    [
      'an invalid value that quotes a server-side message',
      registerCalculate,
      'calculate',
      { op: 'Output validation error', a: 1, b: 2 },
      'validation',
    ],
    [
      'tool rejecting its own arguments',
      () =>
        server.tool!('lookup', 'lookup', {}, async () => {
          throw new McpError(ErrorCode.InvalidParams, 'id must be a uuid')
        }),
      'lookup',
      {},
      'validation',
    ],
    [
      'output failing its own schema',
      () =>
        server.registerTool!('report', { description: 'report', outputSchema: { total: z.number() } }, async () => ({
          content: [{ type: 'text', text: 'no structured content' }],
        })),
      'report',
      {},
      'Error',
    ],
    [
      'a call to a disabled tool',
      () => server.registerTool!('retired', { description: 'retired' }, async () => ({ content: [] })).disable(),
      'retired',
      {},
      'validation',
    ],
    [
      'a result the server built in the wrong shape',
      () => server.tool!('malformed', 'malformed', {}, async () => ({ content: [{ type: 'bogus' }] }) as any),
      'malformed',
      {},
      'McpError',
    ],
    ['tool throwing', () => {}, 'complete_todo', { id: 'nonexistent-id' }, 'Error'],
  ])('classifies %s, keeping its $exception', async (_case, register, toolName, args, errorType) => {
    register()
    instrument(server, fakePostHog())

    // A malformed result is rejected on the client side too.
    await client
      .request({ method: 'tools/call', params: { name: toolName, arguments: args } }, CallToolResultSchema)
      .catch(() => undefined)
    await new Promise((r) => setTimeout(r, 50))

    const ofTool = (event: string) =>
      capture.findCapturesByEvent(event).filter((e) => e.properties.$mcp_tool_name === toolName)
    const [toolCall] = ofTool('$mcp_tool_call')
    expect(toolCall?.properties.$mcp_is_error).toBe(true)
    expect(toolCall?.properties.$mcp_error_type).toBe(errorType)
    expect(ofTool('$exception')).toHaveLength(1)
  })
})
