import type { EventMessage, PostHog } from 'posthog-node'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { captureRejectedRequest, PostHogMCP, PostHogMCPAnalyticsEvent } from '../index'
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

  it('bounds a long reason', async () => {
    posthog.captureRejectedRequest({ status: 400, reason: 'x'.repeat(10_000) })
    await tick()

    expect((rejected().properties.$mcp_error_message as string).length).toBeLessThan(10_000)
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

  it('never rejects when the client throws', async () => {
    const posthog = {
      capture: (): void => {
        throw new Error('client closed')
      },
    } as unknown as PostHog

    await expect(captureRejectedRequest(posthog, { status: 401 })).resolves.toBeUndefined()
  })
})
