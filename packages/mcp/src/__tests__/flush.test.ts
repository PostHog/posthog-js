import { PostHog, type EventMessage } from 'posthog-node'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it, vi } from 'vitest'

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

  it('is not held open by a capture that starts while it is waiting', async () => {
    const { posthog, log } = recordingClient()
    const sink = new McpEventSink(posthog)
    const first = gatedBeforeSend()
    const second = gatedBeforeSend()

    void sink.capture(toolCall(), { enableExceptionAutocapture: false, beforeSend: first.beforeSend })
    const firstFlush = sink.flush()
    void sink.capture(toolCall(), { enableExceptionAutocapture: false, beforeSend: second.beforeSend })

    first.release()
    const outcome = await Promise.race([
      firstFlush.then(() => 'flushed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timed out'), 50)),
    ])

    expect(outcome).toBe('flushed')
    expect(log).toEqual(['capture $mcp_tool_call', 'flush'])

    second.release()
    await sink.flush()

    expect(log).toEqual(['capture $mcp_tool_call', 'flush', 'capture $mcp_tool_call', 'flush'])
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

  it('sends a failed tool call through a real client before it resolves', async () => {
    const fetch = vi.fn(async (_url: string, _init: any) => ({
      status: 200,
      text: async () => JSON.stringify({ results: {} }),
      json: async () => ({ results: {} }),
      headers: { get: () => null },
    }))
    const posthog = new PostHog('phc_test', {
      host: 'http://localhost',
      flushAt: 1000,
      fetchRetryCount: 0,
      captureCompression: 'none',
      fetch: fetch as any,
    })
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      const analytics = instrument(server, posthog, { sendInitializeEvent: false })
      await client.request(
        { method: 'tools/call', params: { name: 'complete_todo', arguments: { id: 'missing' } } },
        CallToolResultSchema
      )
      await analytics.flush()

      const sent = fetch.mock.calls
        .filter(([url]) => String(url).endsWith('/i/v1/analytics/events'))
        .flatMap(([, init]) => JSON.parse(init.body).batch.map((event: any) => event.event))
      expect(sent).toEqual(expect.arrayContaining(['$mcp_tool_call', '$exception']))
    } finally {
      await cleanup()
      await posthog.shutdown()
    }
  })

  it('resolves on the no-op handle of a server it could not instrument', async () => {
    const { posthog, log } = recordingClient()

    await expect(instrument({ notAServer: true }, posthog).flush()).resolves.toBeUndefined()
    expect(log).toEqual([])
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
