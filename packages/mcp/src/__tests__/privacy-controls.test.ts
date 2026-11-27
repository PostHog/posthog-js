import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument, PostHogMCP } from '../index'
import type { PostHogCaptureEvent } from '../extensions/posthog-events'
import type { MCPAnalyticsOptions } from '../types'
import { EventCapture, fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

const PRIVATE_INPUT = 'private-customer@example.test'

async function captureToolCalls(options: MCPAnalyticsOptions) {
  resetTodos()
  const capture = new EventCapture()
  await capture.start()
  const { server, client, cleanup } = await setupTestServerAndClient()
  instrument(server, fakePostHog(), options)

  try {
    const successful = await client.request(
      { method: 'tools/call', params: { name: 'add_todo', arguments: { text: PRIVATE_INPUT } } },
      CallToolResultSchema
    )
    expect(successful.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining(PRIVATE_INPUT) })

    const failed = await client.request(
      { method: 'tools/call', params: { name: 'complete_todo', arguments: { id: PRIVATE_INPUT } } },
      CallToolResultSchema
    )
    expect(failed.isError).toBe(true)
    expect(failed.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining(PRIVATE_INPUT) })

    await vi.waitFor(() => {
      expect(capture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(2)
    })

    return {
      events: capture.getEvents(),
      captures: capture.getCaptures(),
      toolCalls: capture.findCapturesByEvent('$mcp_tool_call'),
      exceptions: capture.findCapturesByEvent('$exception'),
    }
  } finally {
    await cleanup()
    await capture.stop()
  }
}

describe('MCP content capture privacy controls', () => {
  it('preserves the existing capture defaults', async () => {
    const { toolCalls, exceptions } = await captureToolCalls({})
    const success = toolCalls.find((c) => c.properties.$mcp_tool_name === 'add_todo')
    const failure = toolCalls.find((c) => c.properties.$mcp_tool_name === 'complete_todo')
    expect(JSON.stringify(success?.properties.$mcp_parameters)).toContain(PRIVATE_INPUT)
    expect(JSON.stringify(success?.properties.$mcp_response)).toContain(PRIVATE_INPUT)
    expect(failure?.properties.$mcp_error_message).toContain(PRIVATE_INPUT)
    expect(exceptions).toHaveLength(1)
  })

  it('omits all three forms of content before the analytics pipeline, retaining metadata', async () => {
    const beforeSend = vi.fn((event: PostHogCaptureEvent) => event)
    const { events, captures, toolCalls, exceptions } = await captureToolCalls({
      captureParameters: false,
      captureResponse: false,
      captureErrorMessages: false,
      beforeSend,
    })

    expect(toolCalls).toHaveLength(2)
    expect(exceptions).toHaveLength(0)
    for (const toolCall of toolCalls) {
      expect(toolCall.properties.$mcp_parameters).toBeUndefined()
      expect(toolCall.properties.$mcp_response).toBeUndefined()
      expect(toolCall.properties.$mcp_error_message).toBeUndefined()
      expect(toolCall.properties.$mcp_duration_ms).toEqual(expect.any(Number))
      expect(toolCall.properties.$mcp_tool_name).toBeDefined()
    }
    const failure = toolCalls.find((c) => c.properties.$mcp_tool_name === 'complete_todo')
    expect(failure?.properties.$mcp_is_error).toBe(true)
    expect(failure?.properties.$mcp_error_type).toBeDefined()
    expect(JSON.stringify(events)).not.toContain(PRIVATE_INPUT)
    expect(JSON.stringify(captures)).not.toContain(PRIVATE_INPUT)
    expect(JSON.stringify(beforeSend.mock.calls)).not.toContain(PRIVATE_INPUT)
  })

  it.each([
    [{ captureParameters: false }, '$mcp_parameters', '$mcp_response'],
    [{ captureResponse: false }, '$mcp_response', '$mcp_parameters'],
  ] as const)('allows independent opt-out for %s', async (options, removed, retained) => {
    const { toolCalls } = await captureToolCalls(options)
    const success = toolCalls.find((c) => c.properties.$mcp_tool_name === 'add_todo')
    expect(success?.properties[removed]).toBeUndefined()
    expect(JSON.stringify(success?.properties[retained])).toContain(PRIVATE_INPUT)
  })

  it('disables exception-message capture without losing tool arguments or results', async () => {
    const { toolCalls, exceptions } = await captureToolCalls({ captureErrorMessages: false })
    const success = toolCalls.find((c) => c.properties.$mcp_tool_name === 'add_todo')
    const failure = toolCalls.find((c) => c.properties.$mcp_tool_name === 'complete_todo')
    expect(JSON.stringify(success?.properties.$mcp_parameters)).toContain(PRIVATE_INPUT)
    expect(JSON.stringify(success?.properties.$mcp_response)).toContain(PRIVATE_INPUT)
    expect(failure?.properties.$mcp_error_message).toBeUndefined()
    expect(failure?.properties.$mcp_response).toBeUndefined()
    expect(failure?.properties.$mcp_is_error).toBe(true)
    expect(exceptions).toHaveLength(0)
  })
})

describe('PostHogMCP custom dispatcher privacy controls', () => {
  it('applies the content opt-outs to the direct captureToolCall path', async () => {
    const capture = new EventCapture()
    await capture.start()
    const posthog = new PostHogMCP('phc_test', {
      host: 'http://localhost',
      flushAt: 1,
      fetchRetryCount: 0,
      captureParameters: false,
      captureResponse: false,
      captureErrorMessages: false,
    })
    try {
      posthog.captureToolCall({
        toolName: 'search_contacts',
        parameters: { contact: PRIVATE_INPUT },
        response: { content: [{ type: 'text', text: PRIVATE_INPUT }] },
        isError: true,
        error: new Error(`Lookup failed for ${PRIVATE_INPUT}`),
        errorType: 'validation',
      })
      await vi.waitFor(() => expect(capture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(1))
      const payload = capture.findCapturesByEvent('$mcp_tool_call')[0]
      expect(payload.properties.$mcp_tool_name).toBe('search_contacts')
      expect(payload.properties.$mcp_is_error).toBe(true)
      expect(payload.properties.$mcp_error_type).toBe('validation')
      expect(payload.properties.$mcp_parameters).toBeUndefined()
      expect(payload.properties.$mcp_response).toBeUndefined()
      expect(payload.properties.$mcp_error_message).toBeUndefined()
      expect(capture.findCapturesByEvent('$exception')).toHaveLength(0)
      expect(JSON.stringify(capture.getCaptures())).not.toContain(PRIVATE_INPUT)
      expect(JSON.stringify(capture.getEvents())).not.toContain(PRIVATE_INPUT)
    } finally {
      await capture.stop()
      await posthog.shutdown()
    }
  })

  it('applies the same content exclusions to initialize and tools/list', async () => {
    const capture = new EventCapture()
    await capture.start()
    const posthog = new PostHogMCP('phc_test', {
      host: 'http://localhost',
      flushAt: 1,
      fetchRetryCount: 0,
      captureParameters: false,
      captureResponse: false,
    })
    try {
      posthog.captureInitialize({
        parameters: { token: PRIVATE_INPUT },
        response: { echoed: PRIVATE_INPUT },
        durationMs: 1,
      })
      posthog.captureToolsList({
        toolNames: ['safe_tool'],
        parameters: { search: PRIVATE_INPUT },
        response: { results: PRIVATE_INPUT },
        isError: false,
      })
      await vi.waitFor(() => expect(capture.getCaptures()).toHaveLength(2))
      for (const event of capture.getCaptures()) {
        expect(event.properties.$mcp_parameters).toBeUndefined()
        expect(event.properties.$mcp_response).toBeUndefined()
      }
      expect(capture.findCapturesByEvent('$mcp_tools_list')[0].properties.$mcp_listed_tool_names).toEqual(['safe_tool'])
      expect(JSON.stringify(capture.getCaptures())).not.toContain(PRIVATE_INPUT)
    } finally {
      await capture.stop()
      await posthog.shutdown()
    }
  })

  it.each([`Contact lookup failed for ${PRIVATE_INPUT}`, 'customerSecretAccount_918273645'])(
    'does not treat a free-form exception type as safe error metadata: %s',
    async (errorType) => {
      const capture = new EventCapture()
      await capture.start()
      const posthog = new PostHogMCP('phc_test', {
        host: 'http://localhost',
        flushAt: 1,
        fetchRetryCount: 0,
        captureErrorMessages: false,
      })
      try {
        posthog.captureToolCall({
          toolName: 'lookup',
          isError: true,
          error: new Error('Sensitive failure'),
          errorType,
        })
        await vi.waitFor(() => expect(capture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(1))
        const props = capture.findCapturesByEvent('$mcp_tool_call')[0].properties
        expect(props.$mcp_error_type).toBe('Error')
        expect(JSON.stringify(capture.getCaptures())).not.toContain(PRIVATE_INPUT)
        expect(JSON.stringify(capture.getCaptures())).not.toContain(errorType)
      } finally {
        await capture.stop()
        await posthog.shutdown()
      }
    }
  )

  it('preserves successful result capture while omitting a failed result carrying an error message', async () => {
    const capture = new EventCapture()
    await capture.start()
    const posthog = new PostHogMCP('phc_test', {
      host: 'http://localhost',
      flushAt: 1,
      fetchRetryCount: 0,
      captureErrorMessages: false,
    })
    try {
      posthog.captureToolCall({
        toolName: 'search_contacts',
        response: { content: [{ type: 'text', text: PRIVATE_INPUT }] },
        isError: false,
      })
      posthog.captureToolCall({
        toolName: 'search_contacts',
        response: { isError: true, content: [{ type: 'text', text: `Failed: ${PRIVATE_INPUT}` }] },
        error: new Error(`Failed: ${PRIVATE_INPUT}`),
        isError: true,
      })
      await vi.waitFor(() => expect(capture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(2))
      const calls = capture.findCapturesByEvent('$mcp_tool_call')
      expect(JSON.stringify(calls[0].properties.$mcp_response)).toContain(PRIVATE_INPUT)
      expect(calls[1].properties.$mcp_response).toBeUndefined()
      expect(calls[1].properties.$mcp_error_message).toBeUndefined()
      expect(calls[1].properties.$mcp_is_error).toBe(true)
      expect(capture.findCapturesByEvent('$exception')).toHaveLength(0)
    } finally {
      await capture.stop()
      await posthog.shutdown()
    }
  })
})
