import type { EventMessage, PostHog } from 'posthog-node'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'

import { instrument } from '../index'
import { McpEventSink } from '../extensions/sink'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import type { BeforeSendFn, McpEvent } from '../types'
import { setupTestServerAndClient } from './test-utils/client-server-factory'

/**
 * `analytics.flush()` lets a per-request runtime wait for auto-captured events, which reach
 * `posthog.capture()` asynchronously after the handler's response is built
 * (https://github.com/PostHog/posthog-js/issues/5659).
 */

function recordingClient(): { posthog: PostHog; log: string[]; captured: EventMessage[] } {
  const log: string[] = []
  const captured: EventMessage[] = []
  const posthog = {
    capture: (message: EventMessage): void => {
      captured.push(message)
      log.push(`capture ${message.event}`)
    },
    flush: async (): Promise<void> => {
      log.push('flush')
    },
  } as unknown as PostHog
  return { posthog, log, captured }
}

/** Holds every payload until the test releases it, like an async `beforeSend` that awaits I/O. */
function gatedBeforeSend(): { beforeSend: BeforeSendFn; release: () => void } {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    beforeSend: async (event) => {
      await gate
      return event
    },
    release,
  }
}

const toolCall = (): McpEvent => ({
  eventType: MCPAnalyticsEventType.mcpToolsCall,
  sessionId: 'session-1',
  timestamp: new Date(),
})

describe('McpEventSink.flush', () => {
  it('waits for a capture still in the pipeline before flushing posthog-node', async () => {
    const { posthog, log } = recordingClient()
    const sink = new McpEventSink(posthog)
    const { beforeSend, release } = gatedBeforeSend()

    void sink.capture(toolCall(), { enableExceptionAutocapture: false, beforeSend })
    const flushed = sink.flush()
    // Let the pipeline run up to the gate: nothing may be flushed yet.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(log).toEqual([])

    release()
    await flushed

    expect(log).toEqual(['capture $mcp_tool_call', 'flush'])
  })

  it('also waits for a capture that starts while it is waiting', async () => {
    const { posthog, log } = recordingClient()
    const sink = new McpEventSink(posthog)
    const first = gatedBeforeSend()
    const second = gatedBeforeSend()

    void sink.capture(toolCall(), { enableExceptionAutocapture: false, beforeSend: first.beforeSend })
    const flushed = sink.flush()
    void sink.capture(toolCall(), { enableExceptionAutocapture: false, beforeSend: second.beforeSend })

    first.release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(log).toEqual(['capture $mcp_tool_call'])

    second.release()
    await flushed

    expect(log).toEqual(['capture $mcp_tool_call', 'capture $mcp_tool_call', 'flush'])
  })

  it('flushes at once when nothing is pending', async () => {
    const { posthog, log } = recordingClient()

    await new McpEventSink(posthog).flush()

    expect(log).toEqual(['flush'])
  })

  it('does not reject when a capture or the posthog-node flush fails', async () => {
    const messages: string[] = []
    const posthog = {
      capture: (): void => {
        throw new Error('capture failed')
      },
      flush: async (): Promise<void> => {
        throw new Error('network down')
      },
    } as unknown as PostHog
    const sink = new McpEventSink(posthog, (message) => messages.push(message))

    void sink.capture(toolCall(), { enableExceptionAutocapture: false })

    await expect(sink.flush()).resolves.toBeUndefined()
    expect(messages.some((message) => message.includes('network down'))).toBe(true)
  })
})

describe('analytics.flush()', () => {
  it('hands an auto-captured tool call to posthog-node before flushing it', async () => {
    const { posthog, log, captured } = recordingClient()
    const { beforeSend, release } = gatedBeforeSend()
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      const analytics = instrument(server, posthog, { beforeSend, sendInitializeEvent: false })
      await client.request(
        { method: 'tools/call', params: { name: 'add_todo', arguments: { text: 'Flush me' } } },
        CallToolResultSchema
      )
      // The response is back, but the tool call event is still waiting in `beforeSend`.
      expect(captured.some((message) => message.event === '$mcp_tool_call')).toBe(false)

      const flushed = analytics.flush()
      release()
      await flushed

      expect(captured.some((message) => message.event === '$mcp_tool_call')).toBe(true)
      expect(log.at(-1)).toBe('flush')
      expect(log.indexOf('flush')).toBeGreaterThan(log.indexOf('capture $mcp_tool_call'))
    } finally {
      await cleanup()
    }
  })

  it('resolves when instrument() got no PostHog client', async () => {
    const { server, cleanup } = await setupTestServerAndClient()

    try {
      const analytics = instrument(server, undefined as unknown as PostHog)

      await expect(analytics.flush()).resolves.toBeUndefined()
    } finally {
      await cleanup()
    }
  })
})
