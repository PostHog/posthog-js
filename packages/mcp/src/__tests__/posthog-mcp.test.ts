import { PostHogMCP } from '../index'
import { PostHogMCPAnalyticsEvent, PostHogMCPAnalyticsProperty } from '../extensions/constants'
import type { PostHogCaptureEvent } from '../extensions/posthog-events'
import { EventCapture } from './test-utils'

// The capture methods are fire-and-forget (mirroring posthog-node's `capture()`),
// so let the microtask/timer queue drain before asserting on what the sink saw.
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('PostHogMCP', () => {
  let capture: EventCapture
  let posthog: PostHogMCP

  beforeEach(async () => {
    capture = new EventCapture()
    await capture.start()
    posthog = new PostHogMCP('phc_test', { host: 'http://localhost', flushAt: 1, fetchRetryCount: 0 })
  })

  afterEach(async () => {
    await capture.stop()
    await posthog.shutdown()
  })

  function newClient(options?: ConstructorParameters<typeof PostHogMCP>[1]): PostHogMCP {
    return new PostHogMCP('phc_test', { host: 'http://localhost', flushAt: 1, fetchRetryCount: 0, ...options })
  }

  function onlyCapture(eventName: string): PostHogCaptureEvent {
    const matches = capture.findCapturesByEvent(eventName)
    expect(matches).toHaveLength(1)
    return matches[0]
  }

  it('is a drop-in PostHog client (inherits capture/identify/etc.)', () => {
    expect(typeof posthog.capture).toBe('function')
    expect(typeof posthog.identify).toBe('function')
    expect(typeof posthog.shutdown).toBe('function')
  })

  describe('captureToolCall', () => {
    it('emits $mcp_tool_call with canonical properties, identity, and groups', async () => {
      posthog.captureToolCall({
        toolName: 'execute-sql',
        toolDescription: 'Run a HogQL/SQL query against PostHog.',
        durationMs: 42,
        isError: false,
        distinctId: 'user-123',
        sessionId: 'session-abc',
        groups: { organization: 'org-1', project: 'proj-1' },
        properties: { $mcp_client_name: 'claude-code', custom_flag: true },
      })
      await tick()

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
      posthog.captureToolCall({
        toolName: 'execute-sql',
        distinctId: 'user-123',
        parameters: { query: 'select 1' },
        response: { rows: 1 },
        isError: false,
      })
      await tick()

      const p = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall).properties
      expect(p[PostHogMCPAnalyticsProperty.Parameters]).toEqual({ query: 'select 1' })
      expect(p[PostHogMCPAnalyticsProperty.Response]).toEqual({ rows: 1 })
    })

    it('fans out an $exception sibling on error, carrying the error message', async () => {
      posthog.captureToolCall({
        toolName: 'execute-sql',
        distinctId: 'user-123',
        isError: true,
        error: new Error('query failed'),
      })
      await tick()

      const toolCall = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall)
      expect(toolCall.properties[PostHogMCPAnalyticsProperty.IsError]).toBe(true)

      const exception = onlyCapture(PostHogMCPAnalyticsEvent.Exception)
      expect(exception.distinct_id).toBe('user-123')
      expect(JSON.stringify(exception.properties.$exception_list)).toContain('query failed')
    })

    it('synthesizes an exception from the tool name when isError is set without an error', async () => {
      posthog.captureToolCall({ toolName: 'execute-sql', distinctId: 'user-123', isError: true })
      await tick()

      const exception = onlyCapture(PostHogMCPAnalyticsEvent.Exception)
      expect(JSON.stringify(exception.properties.$exception_list)).toContain('execute-sql')
    })

    it('suppresses the $exception sibling when enableExceptionAutocapture is false', async () => {
      const client = newClient({ enableExceptionAutocapture: false })
      try {
        client.captureToolCall({
          toolName: 'execute-sql',
          distinctId: 'user-123',
          isError: true,
          error: new Error('boom'),
        })
        await tick()

        expect(capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.ToolCall)).toHaveLength(1)
        expect(capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Exception)).toHaveLength(0)
      } finally {
        await client.shutdown()
      }
    })
  })

  describe('captureInitialize', () => {
    it('emits $mcp_initialize with client metadata', async () => {
      posthog.captureInitialize({
        clientName: 'claude-code',
        clientVersion: '1.2.3',
        distinctId: 'user-123',
        durationMs: 7,
      })
      await tick()

      const p = onlyCapture(PostHogMCPAnalyticsEvent.Initialize).properties
      expect(p[PostHogMCPAnalyticsProperty.ClientName]).toBe('claude-code')
      expect(p[PostHogMCPAnalyticsProperty.ClientVersion]).toBe('1.2.3')
      expect(p[PostHogMCPAnalyticsProperty.DurationMs]).toBe(7)
    })
  })

  describe('identity + session handling', () => {
    it('writes setProperties to $set', async () => {
      posthog.captureToolCall({
        toolName: 'execute-sql',
        distinctId: 'user-123',
        setProperties: { email: 'a@b.com', plan: 'pro' },
        isError: false,
      })
      await tick()

      const p = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall).properties
      expect(p.$set).toEqual({ email: 'a@b.com', plan: 'pro' })
    })

    it('marks anonymous and skips person processing when no distinctId is given', async () => {
      posthog.captureToolCall({ toolName: 'execute-sql', isError: false })
      await tick()

      const payload = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall)
      expect(payload.distinct_id).toBe('anonymous')
      expect(payload.properties.$process_person_profile).toBe(false)
    })

    it('omits $session_id entirely when no session is supplied', async () => {
      posthog.captureToolCall({ toolName: 'execute-sql', distinctId: 'user-123', isError: false })
      await tick()

      const payload = onlyCapture(PostHogMCPAnalyticsEvent.ToolCall)
      expect(payload.properties).not.toHaveProperty(PostHogMCPAnalyticsProperty.SessionId)
    })
  })
})
