import type { PostHog } from 'posthog-node'

import { MCPAnalyticsEventType } from '../extensions/event-types'
import { McpOtelRecorder, normalizeClient, normalizeModel } from '../extensions/otel'
import { McpEventSink } from '../extensions/sink'
import type { McpEvent } from '../types'

function fakeClient() {
  const calls = {
    events: [] as unknown[],
    logs: [] as any[],
    histograms: [] as [string, number, any][],
    counts: [] as [string, number, any][],
  }
  let distinctId: string | undefined
  const posthog = {
    capture: (m: unknown) => calls.events.push(m),
    withContext: (ctx: { distinctId?: string }, fn: () => unknown) => {
      distinctId = ctx.distinctId
      try {
        return fn()
      } finally {
        distinctId = undefined
      }
    },
    captureLog: (o: object) => calls.logs.push({ ...o, distinctId }),
    metrics: {
      histogram: (name: string, value: number, o: unknown) => calls.histograms.push([name, value, o]),
      count: (name: string, value: number, o: unknown) => calls.counts.push([name, value, o]),
    },
  } as unknown as PostHog
  return { posthog, calls }
}

const toolCall = (over: Partial<McpEvent> = {}): McpEvent => ({
  eventType: MCPAnalyticsEventType.mcpToolsCall,
  sessionId: 'session-1',
  identifyActorGivenId: 'user-1',
  resourceName: 'query-run',
  duration: 250,
  protocolVersion: '2025-11-25',
  clientName: 'claude-code',
  llmModel: 'claude-opus-4-1-20250805',
  timestamp: new Date(),
  ...over,
})

describe('signals', () => {
  it('events (default) sends events only', async () => {
    const { posthog, calls } = fakeClient()
    await new McpEventSink(posthog).capture(toolCall(), { enableExceptionAutocapture: false })
    expect(calls.events).toHaveLength(1)
    expect(calls.logs).toHaveLength(0)
    expect(calls.histograms).toHaveLength(0)
  })

  it('otel sends metrics and a log record, and no events', async () => {
    const { posthog, calls } = fakeClient()
    await new McpEventSink(posthog, () => {}, 'otel').capture(toolCall(), { enableExceptionAutocapture: false })
    expect(calls.events).toHaveLength(0)

    expect(calls.histograms).toEqual([
      [
        'mcp.server.operation.duration',
        0.25,
        expect.objectContaining({
          unit: 's',
          attributes: {
            'mcp.method.name': 'tools/call',
            'gen_ai.tool.name': 'query-run',
            'mcp.protocol.version': '2025-11-25',
          },
        }),
      ],
    ])
    expect(calls.counts).toEqual([
      [
        'mcp.client.calls',
        1,
        {
          attributes: {
            'mcp.method.name': 'tools/call',
            'mcp.client.name': 'claude-code',
            'gen_ai.request.model': 'claude-opus-4-1',
            outcome: 'ok',
          },
        },
      ],
    ])

    expect(calls.logs).toHaveLength(1)
    const log = calls.logs[0]
    expect(log.body).toBe('tools/call query-run')
    expect(log.level).toBe('info')
    expect(log.distinctId).toBe('user-1')
    expect(log.attributes).toMatchObject({
      'mcp.session.id': 'session-1',
      'gen_ai.tool.name': 'query-run',
      $mcp_tool_name: 'query-run',
      $mcp_duration_ms: 250,
    })
  })

  it('both sends events and otel', async () => {
    const { posthog, calls } = fakeClient()
    await new McpEventSink(posthog, () => {}, 'both').capture(toolCall(), { enableExceptionAutocapture: false })
    expect(calls.events).toHaveLength(1)
    expect(calls.logs).toHaveLength(1)
    expect(calls.histograms).toHaveLength(1)
  })

  it('an error carries error.type on the histogram and log, and an error outcome', async () => {
    const { posthog, calls } = fakeClient()
    await new McpEventSink(posthog, () => {}, 'otel').capture(toolCall({ isError: true, errorType: 'validation' }), {
      enableExceptionAutocapture: false,
    })
    expect(calls.histograms[0][2].attributes['error.type']).toBe('validation')
    expect(calls.counts[0][2].attributes.outcome).toBe('error')
    expect(calls.logs[0].level).toBe('error')
  })

  it('feedback is a log record only', async () => {
    const { posthog, calls } = fakeClient()
    await new McpEventSink(posthog, () => {}, 'otel').capture(
      { eventType: MCPAnalyticsEventType.mcpFeedback, sessionId: 's', timestamp: new Date() },
      { enableExceptionAutocapture: false }
    )
    expect(calls.histograms).toHaveLength(0)
    expect(calls.counts).toHaveLength(0)
    expect(calls.logs).toHaveLength(1)
  })
})

describe('McpOtelRecorder', () => {
  it('records client models past 50 distinct values as other', () => {
    const { posthog, calls } = fakeClient()
    const recorder = new McpOtelRecorder(posthog, () => {})
    const primary = { distinct_id: 'u', event: '$mcp_tool_call', properties: {}, timestamp: '', type: 'capture' as const }
    for (let i = 0; i < 51; i++) recorder.record(toolCall({ llmModel: `model-${i}` }), primary)
    recorder.record(toolCall({ llmModel: 'model-0' }), primary)
    const models = calls.counts.map(([, , o]) => o.attributes['gen_ai.request.model'])
    expect(models[49]).toBe('model-49')
    expect(models[50]).toBe('other')
    expect(models[51]).toBe('model-0')
  })
})

describe('normalization', () => {
  it.each([
    ['us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'claude-sonnet-4-5'],
    ['llama3.1:8b', 'llama3.1:8b'],
    ['anthropic/claude-opus-4-1-20250805', 'claude-opus-4-1'],
    ['claude-opus-4-1[1m]', 'claude-opus-4-1'],
    ['GPT-5', 'gpt-5'],
    [undefined, 'unknown'],
  ])('normalizeModel(%s) → %s', (input, expected) => {
    expect(normalizeModel(input)).toBe(expected)
  })

  it('normalizeClient prefers the vendor id and drops the mcp-remote suffix', () => {
    expect(normalizeClient({ vendorClient: 'ClaudeCode', clientName: 'claude' })).toBe('claudecode')
    expect(normalizeClient({ clientName: 'Cursor (via mcp-remote 0.1.0)' })).toBe('cursor')
    expect(normalizeClient({})).toBe('unknown')
  })
})
