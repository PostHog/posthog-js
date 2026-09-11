import { type CallToolResult, CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult as V2CallToolResult } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { sendFeedbackResult, instrument, PostHogMCP } from '../index'
import {
  DEFAULT_CONTEXT_PARAMETER_DESCRIPTION,
  PostHogMCPAnalyticsEvent,
  PostHogMCPAnalyticsProperty,
} from '../extensions/constants'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { getServerTrackingData } from '../extensions/internal'
import type { FeedbackReport } from '../types'
import { EventCapture, fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

const SEND_FEEDBACK = 'send_feedback'

function registerRealTool(server: any, name: string): any {
  return server.tool(
    name,
    'A legitimate application tool',
    { value: z.string() },
    async ({ value }: { value: string }) => ({
      content: [{ type: 'text' as const, text: `real handler: ${value}` }],
    })
  )
}

async function callTool(client: any, name: string, args: Record<string, unknown>) {
  return client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema)
}

describe('collectFeedback (send_feedback virtual tool)', () => {
  let server: any
  let client: any
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    resetTodos()
    const setup = await setupTestServerAndClient()
    server = setup.server
    client = setup.client
    cleanup = setup.cleanup
  })

  afterEach(async () => {
    await cleanup()
  })

  describe('tools/list injection', () => {
    it('adds send_feedback with required feedback_type and summary when collectFeedback is true', async () => {
      instrument(server, fakePostHog(), { collectFeedback: true })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const tool = tools.find((t: any) => t.name === SEND_FEEDBACK)

      expect(tool).toBeDefined()
      expect(tool.description).toContain('missing capability')
      expect(tool.inputSchema.required).toEqual(expect.arrayContaining(['feedback_type', 'summary']))
      expect(tool.inputSchema.properties.feedback_type.enum).toEqual(['missing_capability', 'issue', 'praise', 'other'])
      expect(tool.annotations.readOnlyHint).toBe(true)
    })

    it('omits send_feedback when collectFeedback is off', async () => {
      instrument(server, fakePostHog(), {})

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.find((t: any) => t.name === SEND_FEEDBACK)).toBeUndefined()
    })

    it('advertises both virtual tools when reportMissing and collectFeedback are both on', async () => {
      instrument(server, fakePostHog(), { reportMissing: true, collectFeedback: true })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.find((t: any) => t.name === 'get_more_tools')).toBeDefined()
      expect(tools.find((t: any) => t.name === SEND_FEEDBACK)).toBeDefined()
    })

    it('merges declared extraProperties into the schema and appends extraRequired', async () => {
      instrument(server, fakePostHog(), {
        collectFeedback: {
          extraProperties: {
            product_area: { type: 'string', description: 'The product the feedback is about.' },
            category: { type: 'string', enum: ['tooling', 'docs'] },
          },
          extraRequired: ['product_area'],
        },
      })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const tool = tools.find((t: any) => t.name === SEND_FEEDBACK)

      expect(tool.inputSchema.properties.product_area.description).toBe('The product the feedback is about.')
      expect(tool.inputSchema.properties.category.enum).toEqual(['tooling', 'docs'])
      expect(tool.inputSchema.required).toEqual(expect.arrayContaining(['feedback_type', 'summary', 'product_area']))
      expect(tool.inputSchema.required).not.toContain('category')
    })

    it('does not inject the global context param, but does inject llm_model and conversation_id', async () => {
      instrument(server, fakePostHog(), {
        collectFeedback: true,
        context: true,
        captureModel: true,
        enableConversationId: true,
      })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const feedback = tools.find((t: any) => t.name === SEND_FEEDBACK)
      const addTodo = tools.find((t: any) => t.name === 'add_todo')

      expect(feedback.inputSchema.properties.context).toBeUndefined()
      expect(feedback.inputSchema.properties.llm_model).toBeDefined()
      expect(feedback.inputSchema.properties.conversation_id).toBeDefined()
      expect(addTodo.inputSchema.properties.context.description).toBe(DEFAULT_CONTEXT_PARAMETER_DESCRIPTION)
    })

    it('replaces the description and name via the object form', async () => {
      instrument(server, fakePostHog(), {
        collectFeedback: { toolName: 'agent-feedback', description: 'Tell the team.' },
      })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const tool = tools.find((t: any) => t.name === 'agent-feedback')
      expect(tool).toBeDefined()
      expect(tool.description).toBe('Tell the team.')
      expect(tools.find((t: any) => t.name === SEND_FEEDBACK)).toBeUndefined()
    })
  })

  describe('config validation', () => {
    it('throws out of instrument() on a config error instead of silently disabling all analytics', () => {
      expect(() =>
        instrument(server, fakePostHog(), { collectFeedback: { extraProperties: { summary: { type: 'string' } } } })
      ).toThrow(/collides/)
      expect(() => instrument(server, fakePostHog(), { collectFeedback: { extraRequired: ['nope'] } })).toThrow(
        /not declared/
      )
    })

    it('leaves the server un-instrumented after a config throw (no half-applied wrapping)', async () => {
      expect(() => instrument(server, fakePostHog(), { collectFeedback: { extraRequired: ['nope'] } })).toThrow()

      // A corrected second call still instruments cleanly.
      instrument(server, fakePostHog(), { collectFeedback: true })
      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.find((t: any) => t.name === SEND_FEEDBACK)).toBeDefined()
    })
  })

  describe('tools/call', () => {
    it('captures $mcp_feedback with the report properties on a fresh instance', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { collectFeedback: true })

      const result = await callTool(client, SEND_FEEDBACK, {
        feedback_type: 'missing_capability',
        summary: 'No tool to delete multiple todos in one call.',
        details: 'Deleted 20 todos one by one.',
        suggested_improvement: 'Add a bulk delete tool.',
        sentiment: 'negative',
        task_completed: true,
      })

      expect(result.content[0].text).toContain('recorded')

      await new Promise((r) => setTimeout(r, 50))
      const event = capture
        .getEvents()
        .find((e) => e.eventType === MCPAnalyticsEventType.mcpFeedback && e.resourceName === SEND_FEEDBACK)
      expect(event?.userIntent).toBe('No tool to delete multiple todos in one call.\n\nDeleted 20 todos one by one.')
      expect(event?.userIntentSource).toBe('context_parameter')

      const payloads = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)
      expect(payloads).toHaveLength(1)
      const p = payloads[0].properties
      expect(p[PostHogMCPAnalyticsProperty.FeedbackType]).toBe('missing_capability')
      expect(p[PostHogMCPAnalyticsProperty.FeedbackSummary]).toBe('No tool to delete multiple todos in one call.')
      expect(p[PostHogMCPAnalyticsProperty.FeedbackDetails]).toBe('Deleted 20 todos one by one.')
      expect(p[PostHogMCPAnalyticsProperty.FeedbackSuggestedImprovement]).toBe('Add a bulk delete tool.')
      expect(p[PostHogMCPAnalyticsProperty.FeedbackSentiment]).toBe('negative')
      expect(p[PostHogMCPAnalyticsProperty.FeedbackTaskCompleted]).toBe(true)
      expect(p[PostHogMCPAnalyticsProperty.ResourceName]).toBe(SEND_FEEDBACK)
      // No raw arguments: the redacted $mcp_feedback_* properties are the captured surface.
      expect(p[PostHogMCPAnalyticsProperty.Parameters]).toBeUndefined()

      // It's a feedback report, not a tool invocation or a capability gap.
      expect(capture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(0)
      expect(capture.findCapturesByEvent('$mcp_missing_capability')).toHaveLength(0)

      await capture.stop()
    })

    it('captures a call that violates the required fields (nothing validates the virtual tool server-side)', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { collectFeedback: true })

      // No feedback_type, no summary: the tool is not registered with the MCP
      // SDK, so no schema validation runs — the SDK must still capture and reply.
      const result = await callTool(client, SEND_FEEDBACK, { details: 'Only details.' })
      expect(result.content[0].text).toContain('recorded')

      await new Promise((r) => setTimeout(r, 50))
      const p = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)[0].properties
      expect(p[PostHogMCPAnalyticsProperty.FeedbackType]).toBe('other')
      expect(p[PostHogMCPAnalyticsProperty.FeedbackSummary]).toBeUndefined()
      expect(p[PostHogMCPAnalyticsProperty.FeedbackDetails]).toBe('Only details.')
      // Intent falls back to the details when the summary is missing.
      expect(p[PostHogMCPAnalyticsProperty.Intent]).toBe('Only details.')

      await capture.stop()
    })

    it('treats a non-string summary as missing', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { collectFeedback: true })

      await callTool(client, SEND_FEEDBACK, { feedback_type: 'praise', summary: 42 })

      await new Promise((r) => setTimeout(r, 50))
      const p = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)[0].properties
      expect(p[PostHogMCPAnalyticsProperty.FeedbackType]).toBe('praise')
      expect(p[PostHogMCPAnalyticsProperty.FeedbackSummary]).toBeUndefined()

      await capture.stop()
    })

    it('captures a call that omits a required extra, without the property', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), {
        collectFeedback: {
          extraProperties: { product_area: { type: 'string' } },
          extraRequired: ['product_area'],
        },
      })

      const result = await callTool(client, SEND_FEEDBACK, { feedback_type: 'issue', summary: 'A tool failed.' })
      expect(result.content[0].text).toContain('recorded')

      await new Promise((r) => setTimeout(r, 50))
      const p = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)[0].properties
      expect(p.$mcp_feedback_product_area).toBeUndefined()

      await capture.stop()
    })

    it('captures non-string scalar extras as-is and bounds over-long text fields', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), {
        collectFeedback: {
          extraProperties: { retry_count: { type: 'number' }, from_cache: { type: 'boolean' } },
        },
      })

      const longSummary = 'a'.repeat(5000)
      await callTool(client, SEND_FEEDBACK, {
        feedback_type: 'issue',
        summary: longSummary,
        retry_count: 3,
        from_cache: false,
      })

      await new Promise((r) => setTimeout(r, 50))
      const p = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)[0].properties
      expect(p.$mcp_feedback_retry_count).toBe(3)
      expect(p.$mcp_feedback_from_cache).toBe(false)
      const summary = p[PostHogMCPAnalyticsProperty.FeedbackSummary] as string
      expect(summary.length).toBe(2048 + '...'.length)
      expect(summary.endsWith('...')).toBe(true)

      await capture.stop()
    })

    it('falls back to feedback_type "other" on an invalid value', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { collectFeedback: true })

      await callTool(client, SEND_FEEDBACK, { feedback_type: 'rant', summary: 'Something else.' })

      await new Promise((r) => setTimeout(r, 50))
      const p = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)[0].properties
      expect(p[PostHogMCPAnalyticsProperty.FeedbackType]).toBe('other')

      await capture.stop()
    })

    it('captures declared extras as $mcp_feedback_<key> and drops undeclared arguments', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), {
        collectFeedback: { extraProperties: { product_area: { type: 'string' } } },
      })

      await callTool(client, SEND_FEEDBACK, {
        feedback_type: 'issue',
        summary: 'query tool rejects relative dates.',
        tool_name: 'query_todos',
        product_area: 'analytics',
        invented_field: 'never captured',
      })

      await new Promise((r) => setTimeout(r, 50))
      const p = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)[0].properties
      expect(p.$mcp_feedback_product_area).toBe('analytics')
      expect(p[PostHogMCPAnalyticsProperty.FeedbackTool]).toBe('query_todos')
      expect(p.$mcp_feedback_invented_field).toBeUndefined()

      await capture.stop()
    })

    it('redacts PII in the captured free-text fields', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { collectFeedback: true })

      await callTool(client, SEND_FEEDBACK, {
        feedback_type: 'issue',
        summary: 'The tool failed for jane@example.com repeatedly.',
      })

      await new Promise((r) => setTimeout(r, 50))
      const p = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)[0].properties
      expect(p[PostHogMCPAnalyticsProperty.FeedbackSummary]).not.toContain('jane@example.com')
      expect(p[PostHogMCPAnalyticsProperty.FeedbackSummary]).toContain('[redacted]')

      await capture.stop()
    })

    it('redacts PII inside URLs (PII pass runs before the URL rewrite percent-encodes it)', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), {
        collectFeedback: { extraProperties: { context_url: { type: 'string' }, meta: { type: 'object' } } },
      })

      const url = 'https://example.com/?email=jane@example.com&token=secret123'
      await callTool(client, SEND_FEEDBACK, {
        feedback_type: 'issue',
        summary: `The tool failed for ${url} repeatedly.`,
        tool_name: `lookup via ${url}`,
        context_url: url,
        meta: { link: url },
      })

      await new Promise((r) => setTimeout(r, 50))
      const p = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)[0].properties
      for (const captured of [
        p[PostHogMCPAnalyticsProperty.FeedbackSummary],
        p[PostHogMCPAnalyticsProperty.FeedbackTool],
        p.$mcp_feedback_context_url,
        p.$mcp_feedback_meta,
      ]) {
        // Neither the raw email nor its percent-encoded form may survive.
        expect(captured).not.toContain('jane@example.com')
        expect(captured).not.toContain('jane%40example.com')
      }

      await capture.stop()
    })

    it('redacts PII in tool_name like the other free-text fields', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { collectFeedback: true })

      await callTool(client, SEND_FEEDBACK, {
        feedback_type: 'issue',
        summary: 'A tool failed.',
        tool_name: 'lookup_user for jane@example.com',
      })

      await new Promise((r) => setTimeout(r, 50))
      const p = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)[0].properties
      expect(p[PostHogMCPAnalyticsProperty.FeedbackTool]).not.toContain('jane@example.com')
      expect(p[PostHogMCPAnalyticsProperty.FeedbackTool]).toContain('[redacted]')

      await capture.stop()
    })

    it('drops declared extras whose value violates the declared type or enum', async () => {
      const capture = new EventCapture()
      await capture.start()
      const onFeedback = vi.fn()
      instrument(server, fakePostHog(), {
        collectFeedback: {
          extraProperties: {
            account_id: { type: 'string' },
            severity: { type: 'string', enum: ['low', 'high'] },
            retry_count: { type: 'number' },
          },
          onFeedback,
        },
      })

      await callTool(client, SEND_FEEDBACK, {
        feedback_type: 'issue',
        summary: 'A tool failed.',
        account_id: { $ne: null }, // object where a string was declared
        severity: 'catastrophic', // not in the enum
        retry_count: 3, // conforms
      })

      await new Promise((r) => setTimeout(r, 50))
      const p = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)[0].properties
      expect(p.$mcp_feedback_account_id).toBeUndefined()
      expect(p.$mcp_feedback_severity).toBeUndefined()
      expect(p.$mcp_feedback_retry_count).toBe(3)

      // The handler's extras hold only conforming values; raw still has everything.
      const report = onFeedback.mock.calls[0][0]
      expect(report.extras).toEqual({ retry_count: 3 })
      expect(report.raw.account_id).toEqual({ $ne: null })
      expect(report.raw.severity).toBe('catastrophic')

      await capture.stop()
    })

    it('rejects a fractional number for a declared integer extra, accepting whole values', async () => {
      const capture = new EventCapture()
      await capture.start()
      const onFeedback = vi.fn()
      instrument(server, fakePostHog(), {
        collectFeedback: { extraProperties: { score: { type: 'integer' } }, onFeedback },
      })

      await callTool(client, SEND_FEEDBACK, {
        feedback_type: 'praise',
        summary: 'Great tools.',
        score: 3.5, // fractional — a JSON Schema `integer` does not accept it
      })
      await callTool(client, SEND_FEEDBACK, {
        feedback_type: 'praise',
        summary: 'Great tools again.',
        score: 3, // whole — conforms
      })

      await new Promise((r) => setTimeout(r, 50))
      const events = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)
      expect(events[0].properties.$mcp_feedback_score).toBeUndefined()
      expect(events[1].properties.$mcp_feedback_score).toBe(3)
      expect(onFeedback.mock.calls[0][0].extras).toEqual({})
      expect(onFeedback.mock.calls[0][0].raw.score).toBe(3.5)
      expect(onFeedback.mock.calls[1][0].extras).toEqual({ score: 3 })

      await capture.stop()
    })

    it('redacts credential-named keys inside nested extras', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), {
        collectFeedback: { extraProperties: { meta: { type: 'object' } } },
      })

      // The values match no PII pattern — only the key-name check catches them.
      await callTool(client, SEND_FEEDBACK, {
        feedback_type: 'issue',
        summary: 'A tool failed.',
        meta: { password: 'hunter2', api_key: 'ak-12345', note: 'retry failed' },
      })

      await new Promise((r) => setTimeout(r, 50))
      const p = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)[0].properties
      expect(p.$mcp_feedback_meta).not.toContain('hunter2')
      expect(p.$mcp_feedback_meta).not.toContain('ak-12345')
      expect(p.$mcp_feedback_meta).toContain('[redacted]')
      expect(p.$mcp_feedback_meta).toContain('retry failed')

      await capture.stop()
    })

    it('redacts PII in declared extras, scalar and stringified', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), {
        collectFeedback: {
          extraProperties: { reporter: { type: 'string' }, meta: { type: 'object' } },
        },
      })

      await callTool(client, SEND_FEEDBACK, {
        feedback_type: 'issue',
        summary: 'A tool failed.',
        reporter: 'jane@example.com',
        meta: { contact: 'john@example.com' },
      })

      await new Promise((r) => setTimeout(r, 50))
      const p = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)[0].properties
      expect(p.$mcp_feedback_reporter).toBe('[redacted]')
      expect(p.$mcp_feedback_meta).not.toContain('john@example.com')
      expect(p.$mcp_feedback_meta).toContain('[redacted]')

      await capture.stop()
    })

    it('does not log the agent-supplied summary', async () => {
      const logger = vi.fn()
      instrument(server, fakePostHog(), { collectFeedback: true, logger })

      await callTool(client, SEND_FEEDBACK, {
        feedback_type: 'issue',
        summary: 'secret-narrated-content',
      })

      expect(logger.mock.calls.flat().join('\n')).not.toContain('secret-narrated-content')
    })

    it('invokes onFeedback with the parsed report and uses its returned reply', async () => {
      const onFeedback = vi.fn(async (report: FeedbackReport) => `Thanks for the ${report.feedbackType} report!`)
      instrument(server, fakePostHog(), {
        collectFeedback: { extraProperties: { product_area: { type: 'string' } }, onFeedback },
      })

      const result = await callTool(client, SEND_FEEDBACK, {
        feedback_type: 'praise',
        summary: 'The todo tools are great.',
        product_area: 'todos',
      })

      expect(result.content[0].text).toBe('Thanks for the praise report!')
      expect(onFeedback).toHaveBeenCalledTimes(1)
      const report = onFeedback.mock.calls[0][0]
      expect(report.feedbackType).toBe('praise')
      expect(report.summary).toBe('The todo tools are great.')
      expect(report.extras).toEqual({ product_area: 'todos' })
      expect(report.raw.product_area).toBe('todos')
    })

    it('falls back to the default reply when onFeedback throws, and still captures the event', async () => {
      const capture = new EventCapture()
      await capture.start()
      const logged: string[] = []
      instrument(server, fakePostHog(), {
        logger: (message: string) => logged.push(message),
        collectFeedback: {
          onFeedback: async () => {
            throw new Error('backend down for jane@example.com')
          },
        },
      })

      const result = await callTool(client, SEND_FEEDBACK, { feedback_type: 'issue', summary: 'A tool failed.' })

      expect(result.content[0].text).toContain('recorded')

      // Only the exception's type reaches the log — an error message can echo
      // agent-controlled report text (PII, log-forging newlines).
      const warning = logged.find((line) => line.includes('onFeedback handler threw'))
      expect(warning).toContain('Error')
      expect(warning).not.toContain('backend down')
      expect(warning).not.toContain('jane@example.com')

      await new Promise((r) => setTimeout(r, 50))
      expect(capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)).toHaveLength(1)

      await capture.stop()
    })

    it('shares one session across send_feedback and the surrounding tool calls', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { collectFeedback: true })

      await callTool(client, 'add_todo', { text: 'First', context: 'Adding first todo' })
      await callTool(client, SEND_FEEDBACK, { feedback_type: 'other', summary: 'General note.' })
      await callTool(client, 'list_todos', { context: 'Reviewing' })

      await new Promise((r) => setTimeout(r, 50))
      const captured = capture
        .getEvents()
        .filter(
          (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall || e.eventType === MCPAnalyticsEventType.mcpFeedback
        )
      expect(captured.map((e) => e.resourceName)).toEqual(['add_todo', SEND_FEEDBACK, 'list_todos'])
      expect(new Set(captured.map((e) => e.sessionId)).size).toBe(1)

      await capture.stop()
    })

    it('triggers identify on the first send_feedback call when identify is configured', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), {
        collectFeedback: true,
        identify: async () => ({ distinctId: 'user-1', properties: { role: 'developer' } }),
      })

      await callTool(client, SEND_FEEDBACK, { feedback_type: 'other', summary: 'Hello.' })

      await new Promise((r) => setTimeout(r, 50))
      const identifyEvent = capture.getEvents().find((e) => e.eventType === MCPAnalyticsEventType.identify)
      expect(identifyEvent?.resourceName).toBe(SEND_FEEDBACK)

      const data = getServerTrackingData(server.server)
      expect(data?.identifiedSessions.get(data.sessionId)).toEqual({
        distinctId: 'user-1',
        properties: { role: 'developer' },
      })

      await capture.stop()
    })
  })

  describe('real tool name collisions', () => {
    it('warns and runs a colliding real tool normally when collectFeedback is enabled', async () => {
      const logger = vi.fn()
      registerRealTool(server, SEND_FEEDBACK)
      instrument(server, fakePostHog(), { collectFeedback: true, logger })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.filter((tool: any) => tool.name === SEND_FEEDBACK)).toHaveLength(1)
      expect(logger).toHaveBeenCalledWith(expect.stringContaining('real tool already uses that name'))

      const result = await callTool(client, SEND_FEEDBACK, { value: 'enabled', context: 'Call the real tool' })
      expect(result.content[0].text).toBe('real handler: enabled')
    })
  })

  describe('custom tool name', () => {
    it('advertises and handles the virtual tool under the custom name', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { collectFeedback: { toolName: 'agent-feedback' } })

      // Detected + captured on a fresh instance before any tools/list request.
      const result = await callTool(client, 'agent-feedback', { feedback_type: 'other', summary: 'A note.' })
      expect(result.content[0].text).toContain('recorded')

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.find((t: any) => t.name === 'agent-feedback')).toBeDefined()
      expect(tools.find((t: any) => t.name === SEND_FEEDBACK)).toBeUndefined()

      await new Promise((r) => setTimeout(r, 50))
      const event = capture
        .getEvents()
        .find((e) => e.eventType === MCPAnalyticsEventType.mcpFeedback && e.resourceName === 'agent-feedback')
      expect(event?.userIntent).toBe('A note.')

      await capture.stop()
    })
  })
})

describe('PostHogMCP (custom dispatcher path)', () => {
  let capture: EventCapture

  beforeEach(async () => {
    capture = new EventCapture()
    await capture.start()
  })

  afterEach(async () => {
    await capture.stop()
  })

  function newClient(options?: ConstructorParameters<typeof PostHogMCP>[1]): PostHogMCP {
    return new PostHogMCP('phc_test', { host: 'http://localhost', flushAt: 1, fetchRetryCount: 0, ...options })
  }

  it('throws at construction on a collectFeedback config error', () => {
    expect(() => newClient({ collectFeedback: { extraRequired: ['nope'] } })).toThrow(/not declared/)
    // Every reserved key: core fields, prefixed-property collisions, SDK-injected arguments.
    for (const reserved of [
      'feedback_type',
      'summary',
      'details',
      'friction_points',
      'suggested_improvement',
      'tool_name',
      'sentiment',
      'task_completed',
      'type',
      'tool',
      'context',
      'conversation_id',
      'llm_model',
    ]) {
      expect(() => newClient({ collectFeedback: { extraProperties: { [reserved]: { type: 'string' } } } })).toThrow(
        /collides/
      )
    }
  })

  it('prepareToolList appends send_feedback only when the collectFeedback toggle is on', async () => {
    const posthog = newClient({ collectFeedback: { extraProperties: { product_area: { type: 'string' } } } })
    const myTools = [{ name: 'my_tool', inputSchema: { type: 'object', properties: {} } }]

    const withoutToggle = posthog.prepareToolList(myTools)
    expect(withoutToggle.find((t) => t.name === SEND_FEEDBACK)).toBeUndefined()

    const prepared = posthog.prepareToolList(myTools, { collectFeedback: true, reportMissing: true })
    const feedback = prepared.find((t) => t.name === SEND_FEEDBACK) as any
    expect(feedback).toBeDefined()
    expect(feedback.inputSchema.properties.product_area).toBeDefined()
    expect(prepared.find((t) => t.name === 'get_more_tools')).toBeDefined()

    await posthog.shutdown()
  })

  it('prepareToolCall flags send_feedback and returns the parsed report', async () => {
    const posthog = newClient({ collectFeedback: { extraProperties: { product_area: { type: 'string' } } } })

    const prepared = posthog.prepareToolCall(SEND_FEEDBACK, {
      feedback_type: 'missing_capability',
      summary: 'No bulk export.',
      product_area: 'exports',
    })

    expect(prepared.isFeedback).toBe(true)
    expect(prepared.isMissingCapability).toBe(false)
    expect(prepared.feedbackReport?.feedbackType).toBe('missing_capability')
    expect(prepared.feedbackReport?.summary).toBe('No bulk export.')
    expect(prepared.feedbackReport?.extras).toEqual({ product_area: 'exports' })

    const regular = posthog.prepareToolCall('my_tool', { value: 1 })
    expect(regular.isFeedback).toBe(false)
    expect(regular.feedbackReport).toBeUndefined()

    await posthog.shutdown()
  })

  it('never flags feedback calls without the constructor opt-in, so a real tool is not shadowed', async () => {
    const posthog = newClient()

    const prepared = posthog.prepareToolCall(SEND_FEEDBACK, { feedback_type: 'other', summary: 'A note.' })
    expect(prepared.isFeedback).toBe(false)
    expect(prepared.feedbackReport).toBeUndefined()

    const myTools = [{ name: 'my_tool', inputSchema: { type: 'object', properties: {} } }]
    expect(posthog.prepareToolList(myTools, { collectFeedback: true }).find((t) => t.name === SEND_FEEDBACK)).toBe(
      undefined
    )

    await posthog.shutdown()
  })

  it('a supplied originalTool wins a feedback-name collision', async () => {
    const posthog = newClient({ collectFeedback: true })

    // The host holds a real tool by the feedback name and passes it through —
    // stateless proof of ownership, so the call dispatches as a real tool.
    const realTool = { inputSchema: { type: 'object', properties: { note: { type: 'string' } } } }
    const collided = posthog.prepareToolCall(SEND_FEEDBACK, { note: 'hi' }, { originalTool: realTool })
    expect(collided.isFeedback).toBe(false)
    expect(collided.feedbackReport).toBeUndefined()

    // Without originalTool the name match stands.
    const virtual = posthog.prepareToolCall(SEND_FEEDBACK, { feedback_type: 'other', summary: 'A note.' })
    expect(virtual.isFeedback).toBe(true)
    expect(virtual.feedbackReport).toBeDefined()

    await posthog.shutdown()
  })

  it('captureFeedback emits $mcp_feedback with the report properties and intent', async () => {
    const posthog = newClient({
      collectFeedback: { toolName: 'agent-feedback', extraProperties: { product_area: { type: 'string' } } },
    })

    const prepared = posthog.prepareToolCall('agent-feedback', {
      feedback_type: 'issue',
      summary: 'Tool X misleads.',
      details: 'The schema hides a required field.',
      product_area: 'analytics',
      invented_field: 'never captured',
    })
    posthog.captureFeedback({
      report: prepared.feedbackReport!,
      distinctId: 'user-123',
      sessionId: 'session-abc',
      properties: { custom_flag: true },
    })
    await new Promise((r) => setTimeout(r, 0))

    const payloads = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Feedback)
    expect(payloads).toHaveLength(1)
    const p = payloads[0].properties
    expect(payloads[0].distinct_id).toBe('user-123')
    expect(p[PostHogMCPAnalyticsProperty.FeedbackType]).toBe('issue')
    expect(p[PostHogMCPAnalyticsProperty.FeedbackSummary]).toBe('Tool X misleads.')
    expect(p[PostHogMCPAnalyticsProperty.FeedbackDetails]).toBe('The schema hides a required field.')
    expect(p[PostHogMCPAnalyticsProperty.ResourceName]).toBe('agent-feedback')
    expect(p[PostHogMCPAnalyticsProperty.Intent]).toBe('Tool X misleads.\n\nThe schema hides a required field.')
    expect(p[PostHogMCPAnalyticsProperty.SessionId]).toBe('session-abc')
    expect(p.custom_flag).toBe(true)
    expect(p.$mcp_feedback_product_area).toBe('analytics')
    expect(p.$mcp_feedback_invented_field).toBeUndefined()
    expect(p[PostHogMCPAnalyticsProperty.Parameters]).toBeUndefined()

    await posthog.shutdown()
  })
})

/**
 * Same compile-time assertion report-missing.test.ts makes for
 * `getMoreToolsResult()`: what we hand back must stay assignable to both SDK
 * majors' `CallToolResult`.
 */
describe('results we hand back stay assignable to the SDK types', () => {
  it('sendFeedbackResult() satisfies v1 CallToolResult', () => {
    const result: CallToolResult = sendFeedbackResult()
    expect(result.content).toHaveLength(1)
  })

  it('sendFeedbackResult() satisfies v2 CallToolResult', () => {
    const result: V2CallToolResult = sendFeedbackResult()
    expect(result.content).toHaveLength(1)
  })
})
