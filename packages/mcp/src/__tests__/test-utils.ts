import type { Event, UnredactedEvent } from '../types'
import { McpEventSink, type McpCaptureOptions, processMcpEvent } from '../extensions/sink'
import type { PostHogCaptureEvent } from '../extensions/posthog-events'

/**
 * Intercepts events at the sink boundary so tests can assert on what actually
 * reaches `posthog.capture()` without an HTTP call.
 *
 * It runs the SAME pipeline production runs — `processMcpEvent` is the single
 * source of truth shared with `McpEventSink.capture` — so there's no risk of the
 * harness and the sink drifting. Two views are exposed:
 *
 *  - `getEvents()` — the post-pipeline `UnredactedEvent` (redacted/sanitized/
 *    truncated), one per `capture()` call. Convenient for asserting on the
 *    SDK's internal event shape.
 *  - `getCaptures()` — the fanned-out PostHog payloads (`$mcp_tool_call`,
 *    `$exception`, …) exactly as handed to `posthog.capture()`: event name,
 *    `distinct_id`, and `properties`. Use this to assert on event names,
 *    `$set`, `$process_person_profile`, exception siblings, etc.
 *
 * Patches the prototype so every `McpEventSink` created by `instrument()` during
 * the test is intercepted.
 */
export class EventCapture {
  private capturedEvents: UnredactedEvent[] = []
  private capturedPayloads: PostHogCaptureEvent[] = []
  private original?: (event: UnredactedEvent, options: McpCaptureOptions) => Promise<void>

  async start(): Promise<void> {
    if (this.original) {
      return
    }
    this.original = McpEventSink.prototype.capture
    const capture = this
    McpEventSink.prototype.capture = async function (
      this: McpEventSink,
      event: UnredactedEvent,
      options: McpCaptureOptions
    ): Promise<void> {
      const result = await processMcpEvent(event, options)
      if (!result) {
        return
      }
      capture.capturedEvents.push(result.event)
      capture.capturedPayloads.push(...result.captures)
    } as typeof McpEventSink.prototype.capture
  }

  async stop(): Promise<void> {
    if (this.original) {
      McpEventSink.prototype.capture = this.original
      this.original = undefined
    }
  }

  /** Post-pipeline SDK events, one per `capture()` call. */
  getEvents(): UnredactedEvent[] {
    return [...this.capturedEvents]
  }

  /** PostHog payloads as handed to `posthog.capture()` (after fan-out). */
  getCaptures(): PostHogCaptureEvent[] {
    return [...this.capturedPayloads]
  }

  clear(): void {
    this.capturedEvents = []
    this.capturedPayloads = []
  }

  findEventByType(eventType: string): Event | undefined {
    return this.capturedEvents.find((e) => e.eventType === eventType) as Event | undefined
  }

  findEventsByResourceName(resourceName: string): Event[] {
    return this.capturedEvents.filter((e) => e.resourceName === resourceName) as Event[]
  }

  /** PostHog payloads filtered by event name, e.g. `$mcp_tool_call`. */
  findCapturesByEvent(eventName: string): PostHogCaptureEvent[] {
    return this.capturedPayloads.filter((c) => c.event === eventName)
  }
}

/**
 * Minimal stand-in for a `posthog-node` client. `instrument()` only needs a
 * truthy `posthog` to build a sink, and `EventCapture` intercepts the sink
 * before it ever calls `posthog.capture`, so a no-op `capture` is enough for
 * tests that assert on captured MCP events.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fakePostHog(): any {
  return {
    capture: () => undefined,
    captureException: () => undefined,
    flush: async () => undefined,
    shutdown: async () => undefined,
  }
}
