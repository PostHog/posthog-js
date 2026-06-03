import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import type { PostHogCaptureEvent } from '../extensions/posthog-events'
import { EventCapture, fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

const callAddTodo = (client: any, context = 'test context') =>
  client.request(
    { method: 'tools/call', params: { name: 'add_todo', arguments: { text: 'secret-value', context } } },
    CallToolResultSchema
  )

const callMissingTodo = (client: any) =>
  client.request(
    { method: 'tools/call', params: { name: 'complete_todo', arguments: { id: 'nope', context: 'x' } } },
    CallToolResultSchema
  )

describe('beforeSend option', () => {
  let client: any
  let server: any
  let cleanup: () => Promise<void>
  let capture: EventCapture

  beforeEach(async () => {
    resetTodos()
    const setup = await setupTestServerAndClient()
    server = setup.server
    client = setup.client
    cleanup = setup.cleanup
    capture = new EventCapture()
    await capture.start()
  })

  afterEach(async () => {
    await capture.stop()
    await cleanup()
  })

  it('receives the built payload (event name, distinct_id, properties)', async () => {
    const seen: PostHogCaptureEvent[] = []
    instrument(server, {
      posthog: fakePostHog(),
      beforeSend: (event) => {
        seen.push(event)
        return event
      },
    })

    await callAddTodo(client)
    await new Promise((r) => setTimeout(r, 50))

    const toolCall = seen.find((e) => e.event === '$mcp_tool_call')
    expect(toolCall).toBeDefined()
    expect(toolCall?.distinct_id).toBeTruthy()
    expect(toolCall?.properties.$mcp_tool_name).toBe('add_todo')
  })

  it('can mutate properties before capture', async () => {
    instrument(server, {
      posthog: fakePostHog(),
      beforeSend: (event) => {
        if (event.properties.$mcp_parameters) {
          event.properties.$mcp_parameters = '[redacted]'
        }
        return event
      },
    })

    await callAddTodo(client)
    await new Promise((r) => setTimeout(r, 50))

    const toolCall = capture.findCapturesByEvent('$mcp_tool_call')[0]
    expect(toolCall.properties.$mcp_parameters).toBe('[redacted]')
  })

  it('drops an event when beforeSend returns null', async () => {
    instrument(server, {
      posthog: fakePostHog(),
      beforeSend: () => null,
    })

    await callAddTodo(client)
    await new Promise((r) => setTimeout(r, 50))

    expect(capture.getCaptures()).toHaveLength(0)
  })

  it('runs per fanned-out payload, so it can drop the $exception but keep the tool call', async () => {
    instrument(server, {
      posthog: fakePostHog(),
      beforeSend: (event) => (event.event === '$exception' ? null : event),
    })

    await callMissingTodo(client).catch(() => undefined)
    await new Promise((r) => setTimeout(r, 50))

    expect(capture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(1)
    expect(capture.findCapturesByEvent('$exception')).toHaveLength(0)
  })

  it('drops only the throwing payload and still sends the rest', async () => {
    instrument(server, {
      posthog: fakePostHog(),
      beforeSend: (event) => {
        if (event.event === '$exception') {
          throw new Error('beforeSend boom')
        }
        return event
      },
    })

    await callMissingTodo(client).catch(() => undefined)
    await new Promise((r) => setTimeout(r, 50))

    expect(capture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(1)
    expect(capture.findCapturesByEvent('$exception')).toHaveLength(0)
  })

  it('supports async beforeSend', async () => {
    instrument(server, {
      posthog: fakePostHog(),
      beforeSend: async (event) => {
        await new Promise((r) => setTimeout(r, 5))
        event.properties.redacted = true
        return event
      },
    })

    await callAddTodo(client)
    await new Promise((r) => setTimeout(r, 50))

    const toolCall = capture.findCapturesByEvent('$mcp_tool_call')[0]
    expect(toolCall.properties.redacted).toBe(true)
  })
})
