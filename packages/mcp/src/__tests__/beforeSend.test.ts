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
    instrument(server, fakePostHog(), {
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
    instrument(server, fakePostHog(), {
      beforeSend: (event) => {
        if (event.properties.$mcp_parameters) {
          event.properties.$mcp_parameters = '[redacted]'
          delete event.properties.$mcp_input_keys
        }
        return event
      },
    })

    await callAddTodo(client)
    await new Promise((r) => setTimeout(r, 50))

    const toolCall = capture.findCapturesByEvent('$mcp_tool_call')[0]
    expect(toolCall.properties.$mcp_parameters).toBe('[redacted]')
    expect(toolCall.properties).not.toHaveProperty('$mcp_input_keys')
  })

  it('lets shouldRecordInputKey record undeclared argument names', async () => {
    instrument(server, fakePostHog(), {
      shouldRecordInputKey: (key, { declared }) => declared || /^[A-Za-z_]+$/.test(key),
    })

    await client.request(
      {
        method: 'tools/call',
        params: { name: 'add_todo', arguments: { text: 'secret-value', todoText: 'x', 'person@example.com': 1 } },
      },
      CallToolResultSchema
    )
    await new Promise((r) => setTimeout(r, 50))

    const toolCall = capture.findCapturesByEvent('$mcp_tool_call')[0]
    expect(toolCall.properties.$mcp_input_keys).toEqual(['text', 'todoText', '[redacted]'])
  })

  it('drops an event when beforeSend returns null', async () => {
    instrument(server, fakePostHog(), {
      beforeSend: () => null,
    })

    await callAddTodo(client)
    await new Promise((r) => setTimeout(r, 50))

    expect(capture.getCaptures()).toHaveLength(0)
  })

  it('runs per fanned-out payload, so it can drop the $exception but keep the tool call', async () => {
    instrument(server, fakePostHog(), {
      beforeSend: (event) => (event.event === '$exception' ? null : event),
    })

    await callMissingTodo(client).catch(() => undefined)
    await new Promise((r) => setTimeout(r, 50))

    expect(capture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(1)
    expect(capture.findCapturesByEvent('$exception')).toHaveLength(0)
  })

  it('drops only the throwing payload and still sends the rest', async () => {
    instrument(server, fakePostHog(), {
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
    instrument(server, fakePostHog(), {
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

  describe('event options', () => {
    it('sees the anonymous default and the eventOptions callback as options on every payload', async () => {
      const seen: PostHogCaptureEvent[] = []
      instrument(server, fakePostHog(), {
        eventOptions: () => ({ cookieless_mode: true }),
        beforeSend: (event) => {
          seen.push(structuredClone(event))
          return event
        },
      })

      await callMissingTodo(client).catch(() => undefined)
      await new Promise((r) => setTimeout(r, 50))

      expect(seen.map((event) => event.event)).toEqual(['$mcp_tool_call', '$exception'])
      for (const event of seen) {
        expect(event.options).toEqual({ cookieless_mode: true, process_person_profile: false })
      }
    })

    it('sends the options the hook returns', async () => {
      instrument(server, fakePostHog(), {
        beforeSend: (event) => {
          event.options = { ...event.options, product_tour_id: 'tour-1' }
          return event
        },
      })

      await callAddTodo(client)
      await new Promise((r) => setTimeout(r, 50))

      expect(capture.findCapturesByEvent('$mcp_tool_call')[0].options).toEqual({
        product_tour_id: 'tour-1',
        process_person_profile: false,
      })
    })

    it.each([
      {
        name: 'deleting the property turns person processing on',
        hook: (event: PostHogCaptureEvent) => {
          delete event.properties.$process_person_profile
        },
        expected: undefined,
      },
      {
        name: 'flipping the property turns person processing on',
        hook: (event: PostHogCaptureEvent) => {
          event.properties.$process_person_profile = true
        },
        expected: { process_person_profile: true },
      },
      {
        name: 'setting the option turns person processing on',
        hook: (event: PostHogCaptureEvent) => {
          event.options = { process_person_profile: true }
        },
        expected: { process_person_profile: true },
      },
      {
        name: 'the option wins when the hook sets both',
        hook: (event: PostHogCaptureEvent) => {
          event.options = { process_person_profile: true }
          event.properties.$process_person_profile = false
        },
        expected: { process_person_profile: true },
      },
    ])('on an anonymous call, $name', async ({ hook, expected }) => {
      instrument(server, fakePostHog(), {
        beforeSend: (event) => {
          hook(event)
          return event
        },
      })

      await callAddTodo(client)
      await new Promise((r) => setTimeout(r, 50))

      const toolCall = capture.findCapturesByEvent('$mcp_tool_call')[0]
      expect(toolCall.options).toEqual(expected)
      expect(toolCall.properties).not.toHaveProperty('$process_person_profile')
    })

    it('honors a hook that sets the property to make an identified call personless', async () => {
      instrument(server, fakePostHog(), {
        identify: async () => ({ distinctId: 'user-1' }),
        beforeSend: (event) => {
          event.properties.$process_person_profile = false
          return event
        },
      })

      await callAddTodo(client)
      await new Promise((r) => setTimeout(r, 50))

      const toolCall = capture.findCapturesByEvent('$mcp_tool_call')[0]
      expect(toolCall.distinct_id).toBe('user-1')
      expect(toolCall.options).toEqual({ process_person_profile: false })
    })

    it('lets an eventOptions process_person_profile beat a hook-set property', async () => {
      instrument(server, fakePostHog(), {
        eventOptions: () => ({ process_person_profile: true }),
        beforeSend: (event) => {
          event.properties.$process_person_profile = false
          return event
        },
      })

      await callAddTodo(client)
      await new Promise((r) => setTimeout(r, 50))

      expect(capture.findCapturesByEvent('$mcp_tool_call')[0].options).toEqual({ process_person_profile: true })
    })
  })
})
