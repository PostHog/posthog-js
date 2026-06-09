import { createMcpAnalytics } from '../index'
import { PostHogMCPAnalyticsEvent, PostHogMCPAnalyticsProperty } from '../extensions/constants'
import type { PostHogCaptureEvent } from '../extensions/posthog-events'
import { EventCapture, fakePostHog } from './test-utils'

describe('createMcpAnalytics (server-agnostic capture API)', () => {
  let capture: EventCapture

  beforeEach(async () => {
    capture = new EventCapture()
    await capture.start()
  })

  afterEach(async () => {
    await capture.stop()
  })

  function onlyCapture(eventName: string): PostHogCaptureEvent {
    const matches = capture.findCapturesByEvent(eventName)
    expect(matches).toHaveLength(1)
    return matches[0]
  }

  describe('captureToolCall', () => {
    it('emits $mcp_tool_call with canonical properties, identity, and groups', async () => {
      const analytics = createMcpAnalytics(fakePostHog())

      await analytics.captureToolCall({
        toolName: 'execute-sql',
        toolDescription: 'Run a HogQL/SQL query against PostHog.',
        durationMs: 42,
        isError: false,
        distinctId: 'user-123',
        sessionId: 'session-abc',
        groups: { organization: 'org-1', project: 'proj-1' },
        properties: { $mcp_client_name: 'claude-code', custom_flag: true },
      })

      const payload = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall)
      expect(payload.distinct_id).toBe('user-123')
      const p = payload.properties
      expect(p[PostHogMCPAnalyticsProperty.ToolName]).toBe('execute-sql')
      expect(p[PostHogMCPAnalyticsProperty.ResourceName]).toBe('execute-sql')
      expect(p[PostHogMCPAnalyticsProperty.ToolDescription]).toBe('Run a HogQL/SQL query against PostHog.')
      expect(p[PostHogMCPAnalyticsProperty.DurationMs]).toBe(42)
      expect(p[PostHogMCPAnalyticsProperty.IsError]).toBe(false)
      expect(p[PostHogMCPAnalyticsProperty.SessionId]).toBe('session-abc')
      expect(p[PostHogMCPAnalyticsProperty.Source]).toBe('posthog_mcp_analytics')
      expect(p.$groups).toEqual({ organization: 'org-1', project: 'proj-1' })
      expect(p.$mcp_client_name).toBe('claude-code')
      expect(p.custom_flag).toBe(true)
      // A resolved identity keeps person processing on.
      expect(p.$process_person_profile).toBeUndefined()
    })

    it('captures parameters and response (sanitized + truncated by the pipeline)', async () => {
      const analytics = createMcpAnalytics(fakePostHog())

      await analytics.captureToolCall({
        toolName: 'execute-sql',
        distinctId: 'user-123',
        parameters: { query: 'select 1' },
        response: { rows: 1 },
        isError: false,
      })

      const p = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall).properties
      expect(p[PostHogMCPAnalyticsProperty.Parameters]).toEqual({ query: 'select 1' })
      expect(p[PostHogMCPAnalyticsProperty.Response]).toEqual({ rows: 1 })
    })

    it('fans out an $exception sibling on error, carrying the error message', async () => {
      const analytics = createMcpAnalytics(fakePostHog())

      await analytics.captureToolCall({
        toolName: 'execute-sql',
        distinctId: 'user-123',
        isError: true,
        error: new Error('query failed'),
      })

      const toolCall = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall)
      expect(toolCall.properties[PostHogMCPAnalyticsProperty.IsError]).toBe(true)

      const exception = onlyCapture(PostHogMCPAnalyticsEvent.Exception)
      expect(exception.distinct_id).toBe('user-123')
      expect(JSON.stringify(exception.properties.$exception_list)).toContain('query failed')
    })

    it('synthesizes an exception from the tool name when isError is set without an error', async () => {
      const analytics = createMcpAnalytics(fakePostHog())

      await analytics.captureToolCall({ toolName: 'execute-sql', distinctId: 'user-123', isError: true })

      const exception = onlyCapture(PostHogMCPAnalyticsEvent.Exception)
      expect(JSON.stringify(exception.properties.$exception_list)).toContain('execute-sql')
    })

    it('suppresses the $exception sibling when enableExceptionAutocapture is false', async () => {
      const analytics = createMcpAnalytics(fakePostHog(), { enableExceptionAutocapture: false })

      await analytics.captureToolCall({
        toolName: 'execute-sql',
        distinctId: 'user-123',
        isError: true,
        error: new Error('boom'),
      })

      expect(capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.ToolCall)).toHaveLength(1)
      expect(capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Exception)).toHaveLength(0)
    })
  })

  describe('captureInitialize', () => {
    it('emits $mcp_initialize with client metadata', async () => {
      const analytics = createMcpAnalytics(fakePostHog())

      await analytics.captureInitialize({
        clientName: 'claude-code',
        clientVersion: '1.2.3',
        distinctId: 'user-123',
        durationMs: 7,
      })

      const p = onlyCapture(PostHogMCPAnalyticsEvent.Initialize).properties
      expect(p[PostHogMCPAnalyticsProperty.ClientName]).toBe('claude-code')
      expect(p[PostHogMCPAnalyticsProperty.ClientVersion]).toBe('1.2.3')
      expect(p[PostHogMCPAnalyticsProperty.DurationMs]).toBe(7)
    })
  })

  describe('captureToolsList', () => {
    it('emits $mcp_tools_list with the advertised tool names', async () => {
      const analytics = createMcpAnalytics(fakePostHog())

      await analytics.captureToolsList({
        toolNames: ['execute-sql', 'feature-flag-get-all'],
        distinctId: 'user-123',
      })

      const p = onlyCapture(PostHogMCPAnalyticsEvent.ToolsList).properties
      expect(p[PostHogMCPAnalyticsProperty.ListedToolNames]).toEqual(['execute-sql', 'feature-flag-get-all'])
    })
  })

  describe('capture (custom)', () => {
    it('emits the verbatim event name with identity', async () => {
      const analytics = createMcpAnalytics(fakePostHog())

      await analytics.capture({ event: 'feedback_submitted', distinctId: 'user-123', properties: { rating: 5 } })

      const payload = onlyCapture('feedback_submitted')
      expect(payload.distinct_id).toBe('user-123')
      expect(payload.properties.rating).toBe(5)
    })

    it('requires an event name', async () => {
      const analytics = createMcpAnalytics(fakePostHog())
      await expect(analytics.capture({} as never)).rejects.toThrow('requires an `event` name')
      await expect(analytics.capture({ event: '' })).rejects.toThrow('requires an `event` name')
    })
  })

  describe('identity + session handling', () => {
    it('writes setProperties to $set', async () => {
      const analytics = createMcpAnalytics(fakePostHog())

      await analytics.captureToolCall({
        toolName: 'execute-sql',
        distinctId: 'user-123',
        setProperties: { email: 'a@b.com', plan: 'pro' },
        isError: false,
      })

      const p = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall).properties
      expect(p.$set).toEqual({ email: 'a@b.com', plan: 'pro' })
    })

    it('marks anonymous and skips person processing when no distinctId is given', async () => {
      const analytics = createMcpAnalytics(fakePostHog())

      await analytics.captureToolCall({ toolName: 'execute-sql', isError: false })

      const payload = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall)
      expect(payload.distinct_id).toBe('anonymous')
      expect(payload.properties.$process_person_profile).toBe(false)
    })

    it('omits $session_id entirely when no session is supplied', async () => {
      const analytics = createMcpAnalytics(fakePostHog())

      await analytics.captureToolCall({ toolName: 'execute-sql', distinctId: 'user-123', isError: false })

      const payload = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall)
      expect(payload.properties).not.toHaveProperty(PostHogMCPAnalyticsProperty.SessionId)
    })
  })

  describe('beforeSend', () => {
    it('can mutate the payload before capture', async () => {
      const analytics = createMcpAnalytics(fakePostHog(), {
        beforeSend: (event) => ({ ...event, properties: { ...event.properties, redacted: true } }),
      })

      await analytics.captureToolCall({ toolName: 'execute-sql', distinctId: 'user-123', isError: false })

      expect(onlyCapture(PostHogMCPAnalyticsEvent.ToolCall).properties.redacted).toBe(true)
    })

    it('can drop a payload by returning null', async () => {
      const analytics = createMcpAnalytics(fakePostHog(), { beforeSend: () => null })

      await analytics.captureToolCall({ toolName: 'execute-sql', distinctId: 'user-123', isError: false })

      expect(capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.ToolCall)).toHaveLength(0)
    })
  })
})
