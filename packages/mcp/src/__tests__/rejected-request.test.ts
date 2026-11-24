import type { EventMessage, PostHog } from 'posthog-node'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { captureRejectedRequest, PostHog as PostHogClient, PostHogMCP, PostHogMCPAnalyticsEvent } from '../index'
import { McpEventSink } from '../extensions/sink'
import { version } from '../version'
import { EventCapture } from './test-utils'

/**
 * Requests an HTTP layer rejects before the MCP server runs (401/403/429/400) are recorded in
 * the MCP Analytics schema (https://github.com/PostHog/posthog-js/issues/5662).
 */

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('PostHogMCP.captureRejectedRequest', () => {
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

  const rejected = (): { properties: Record<string, unknown>; distinct_id: string; options?: unknown } => {
    const captures = capture.getCaptures()
    expect(captures.map((c) => c.event)).toEqual([PostHogMCPAnalyticsEvent.RequestRejected])
    return captures[0] as any
  }

  it('records a rejected tools/call with the MCP properties the views read', async () => {
    posthog.captureRejectedRequest({
      status: 401,
      reason: 'token_expired',
      method: 'tools/call',
      toolName: 'search_docs',
      serverName: 'docs-mcp',
      serverVersion: '2.1.0',
      clientName: 'claude-code',
      clientVersion: '2.0.0',
      distinctId: 'user-123',
    })
    await tick()

    const event = rejected()
    expect(event.distinct_id).toBe('user-123')
    expect(event.properties).toMatchObject({
      $mcp_interface: 'mcp',
      $mcp_is_error: true,
      $mcp_error_type: 'auth',
      $mcp_error_status: 401,
      $mcp_error_message: 'token_expired',
      $mcp_method: 'tools/call',
      $mcp_tool_name: 'search_docs',
      $mcp_server_name: 'docs-mcp',
      $mcp_server_version: '2.1.0',
      $mcp_client_name: 'claude-code',
      $mcp_client_version: '2.0.0',
    })
  })

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limited'],
    [400, 'protocol'],
    [406, 'protocol'],
    [503, undefined],
  ])('derives $mcp_error_type from status %s', async (status, errorType) => {
    posthog.captureRejectedRequest({ status })
    await tick()

    const { properties } = rejected()
    expect(properties.$mcp_error_status).toBe(status)
    expect(properties.$mcp_error_type).toBe(errorType)
  })

  it('keeps an explicit errorType', async () => {
    posthog.captureRejectedRequest({ status: 403, errorType: 'origin' })
    await tick()

    expect(rejected().properties.$mcp_error_type).toBe('origin')
  })

  it('sends no $exception and mints no session for an anonymous rejection', async () => {
    posthog.captureRejectedRequest({ status: 429, reason: 'rate_limited' })
    await tick()

    const event = rejected()
    expect(capture.findCapturesByEvent('$exception')).toHaveLength(0)
    expect(event.properties).not.toHaveProperty('$session_id')
    expect(event.options).toMatchObject({ process_person_profile: false })
  })

  it('keeps a session the host knows and custom properties', async () => {
    posthog.captureRejectedRequest({ status: 401, sessionId: 'session-1', properties: { region: 'eu' } })
    await tick()

    expect(rejected().properties).toMatchObject({ $session_id: 'session-1', region: 'eu' })
  })

  it('bounds long values', async () => {
    const long = 'x '.repeat(5_000)
    posthog.captureRejectedRequest({
      status: 400,
      reason: long,
      method: long,
      toolName: long,
      errorType: long,
      protocolVersion: long,
    })
    await tick()

    const { properties } = rejected()
    expect(properties.$mcp_error_message).toHaveLength(2048)
    expect(properties.$mcp_error_message).toMatch(/\.\.\.$/)
    for (const key of ['$mcp_method', '$mcp_tool_name', '$mcp_error_type', '$mcp_protocol_version']) {
      expect(properties[key]).toHaveLength(256)
      expect(properties[key]).toMatch(/\.\.\.$/)
    }
  })

  it('redacts credentials, and personal data the client could have sent', async () => {
    posthog.captureRejectedRequest({
      status: 401,
      reason: 'invalid phx_123456789012345678901234567890 at https://svc:hunter2@auth.test/?token=abc',
      method: 'call https://u:p4ss@evil.test/?token=xyz for alice@example.com',
      toolName: 'mail jane@example.com',
    })
    await tick()

    const sent = JSON.stringify(rejected())
    for (const secret of [
      'phx_123456789012345678901234567890',
      'hunter2',
      'token=abc',
      'p4ss',
      'token=xyz',
      'alice@example.com',
      'jane@example.com',
    ]) {
      expect(sent).not.toContain(secret)
    }
  })

  it.each([
    ['a number', 123],
    ['an object', { bad: true }],
    ['an array', ['tools/call']],
    ['a long array', Array(300).fill('x')],
    ['null', null],
    ['a blank string', '  '],
  ])('leaves out %s where a string belongs', async (_, value) => {
    const bad = value as any
    posthog.captureRejectedRequest({
      status: 400,
      reason: bad,
      method: bad,
      toolName: bad,
      clientName: bad,
      clientVersion: bad,
      serverName: bad,
      serverVersion: bad,
      errorType: bad,
    })
    await tick()

    const { properties } = rejected()
    expect(properties).toMatchObject({ $mcp_is_error: true, $mcp_error_status: 400, $mcp_error_type: 'protocol' })
    for (const key of [
      '$mcp_error_message',
      '$mcp_method',
      '$mcp_tool_name',
      '$mcp_resource_name',
      '$mcp_client_name',
      '$mcp_client_version',
      '$mcp_server_name',
      '$mcp_server_version',
    ]) {
      expect(properties[key]).toBeUndefined()
    }
  })

  it.each([
    ['a number', 123],
    ['an object', { bad: true }],
    ['an array', ['ses_1', 'ses_2']],
    ['null', null],
    ['a blank string', '  '],
  ])('leaves out %s where an id or a protocol version belongs', async (_, value) => {
    const bad = value as any
    posthog.captureRejectedRequest({
      status: 400,
      protocolVersion: bad,
      sessionId: bad,
      conversationId: bad,
      distinctId: bad,
    })
    await tick()

    const event = rejected()
    expect(event.distinct_id).toBe('anonymous')
    expect(event.options).toMatchObject({ process_person_profile: false })
    for (const key of ['$mcp_protocol_version', '$session_id', '$mcp_conversation_id']) {
      expect(event.properties).not.toHaveProperty(key)
    }
  })

  it('keeps ids as they are', async () => {
    posthog.captureRejectedRequest({ status: 401, distinctId: ' user ', sessionId: ' ses ', conversationId: ' con ' })
    await tick()

    const event = rejected()
    expect(event.distinct_id).toBe(' user ')
    expect(event.properties).toMatchObject({ $session_id: ' ses ', $mcp_conversation_id: ' con ' })
  })

  it.each([NaN, 401.5, 0, 999, '401'])('leaves out the invalid status %s', async (status) => {
    posthog.captureRejectedRequest({ status: status as number, reason: 'bad status' })
    await tick()

    const { properties } = rejected()
    expect(properties).toMatchObject({ $mcp_is_error: true, $mcp_error_message: 'bad status' })
    expect(properties).not.toHaveProperty('$mcp_error_status')
    expect(properties).not.toHaveProperty('$mcp_error_type')
  })

  it('keeps the common capture fields', async () => {
    posthog.captureRejectedRequest({
      status: 401,
      distinctId: 'user-123',
      clientUserAgent: ' claude-code/2.0 (cli) ',
      vendorClient: 'claude-code',
      protocolVersion: '2025-06-18',
      groups: { company: 'acme' },
      setProperties: { plan: 'pro' },
      eventOptions: { process_person_profile: true },
    })
    await tick()

    const event = rejected()
    expect(event.properties).toMatchObject({
      $mcp_client_user_agent: 'claude-code/2.0 (cli)',
      $mcp_vendor_client: 'claude-code',
      $mcp_protocol_version: '2025-06-18',
      $groups: { company: 'acme' },
      $set: { plan: 'pro' },
    })
    expect(event.options).toMatchObject({ process_person_profile: true })
  })

  it('resolves only once the sink is done', async () => {
    let finish = () => {}
    const spy = vi
      .spyOn(McpEventSink.prototype, 'capture')
      .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    try {
      let resolved = false
      const captured = posthog.captureRejectedRequest({ status: 401 }).then(() => (resolved = true))
      await tick()
      expect(resolved).toBe(false)

      finish()
      await captured
      expect(resolved).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it('never rejects when the sink fails', async () => {
    const spy = vi.spyOn(McpEventSink.prototype, 'capture').mockRejectedValueOnce(new Error('sink failed'))
    try {
      await expect(posthog.captureRejectedRequest({ status: 401 })).resolves.toBeUndefined()
    } finally {
      spy.mockRestore()
    }
    await expect(posthog.captureRejectedRequest(undefined as any)).resolves.toBeUndefined()
  })

  it("sends the client's serverBuild", async () => {
    const built = new PostHogMCP('phc_test', { host: 'http://localhost', serverBuild: 'build-7' })
    try {
      built.captureRejectedRequest({ status: 401 })
      await tick()

      expect(rejected().properties.$mcp_server_build).toBe('build-7')
    } finally {
      await built.shutdown()
    }
  })
})

describe('captureRejectedRequest(posthog, data)', () => {
  it('hands the event to any posthog-node client', async () => {
    const calls: EventMessage[] = []
    const posthog = {
      capture: (message: EventMessage): void => {
        calls.push(message)
      },
    } as unknown as PostHog

    await captureRejectedRequest(posthog, { status: 429, method: 'tools/call', serverName: 'my-mcp' })

    expect(calls).toHaveLength(1)
    expect(calls[0].event).toBe('$mcp_request_rejected')
    expect(calls[0].properties).toMatchObject({
      $mcp_is_error: true,
      $mcp_error_type: 'rate_limited',
      $mcp_error_status: 429,
      $mcp_method: 'tools/call',
      $mcp_server_name: 'my-mcp',
    })
  })

  it('labels a client that was never instrumented, before its first capture', async () => {
    const fetch = vi.fn(async (_url: string, _init: any) => ({
      status: 200,
      text: async () => JSON.stringify({ results: {} }),
      json: async () => ({ results: {} }),
      headers: { get: () => null },
    }))
    const posthog = new PostHogClient('phc_test', {
      host: 'http://localhost',
      flushAt: 1,
      fetchRetryCount: 0,
      captureCompression: 'none',
      fetch: fetch as any,
    })
    try {
      await captureRejectedRequest(posthog, { status: 401, reason: 'token_expired' })
      await posthog.flush()

      const captureCalls = fetch.mock.calls.filter(([url]) => String(url).endsWith('/i/v1/analytics/events'))
      expect(captureCalls).toHaveLength(1)
      expect(captureCalls[0][1].headers['PostHog-Sdk-Info']).toBe(`posthog-node-mcp/${version}`)
      const [event] = JSON.parse(captureCalls[0][1].body).batch
      expect(event.properties).toMatchObject({ $lib: 'posthog-node-mcp', $lib_version: version })
      expect(event.options).toMatchObject({ process_person_profile: false })
    } finally {
      await posthog.shutdown()
    }
  })

  it('is delivered when awaited before a flush, also on a PostHogMCP client', async () => {
    const fetch = vi.fn(async (_url: string, _init: any) => ({
      status: 200,
      text: async () => JSON.stringify({ results: {} }),
      json: async () => ({ results: {} }),
      headers: { get: () => null },
    }))
    const options = {
      host: 'http://localhost',
      flushAt: 1000,
      fetchRetryCount: 0,
      captureCompression: 'none',
      fetch: fetch as any,
    } as const
    const plain = new PostHogClient('phc_test', options)
    const mcp = new PostHogMCP('phc_test', options)
    try {
      await captureRejectedRequest(plain, { status: 401 })
      await plain.flush()
      await mcp.captureRejectedRequest({ status: 403 })
      await mcp.flush()

      const statuses = fetch.mock.calls
        .filter(([url]) => String(url).endsWith('/i/v1/analytics/events'))
        .flatMap(([, init]) => JSON.parse(init.body).batch.map((event: any) => event.properties.$mcp_error_status))
      expect(statuses).toEqual([401, 403])
    } finally {
      await plain.shutdown()
      await mcp.shutdown()
    }
  })

  it('never rejects without a client', async () => {
    await expect(captureRejectedRequest(undefined as any, { status: 401 })).resolves.toBeUndefined()
  })

  it('never rejects when the client throws', async () => {
    const posthog = {
      capture: (): void => {
        throw new Error('client closed')
      },
    } as unknown as PostHog

    await expect(captureRejectedRequest(posthog, { status: 401 })).resolves.toBeUndefined()
  })
})
