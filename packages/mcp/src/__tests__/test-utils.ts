import type { Event, UnredactedEvent } from '../types'
import { McpEventSink, McpCaptureOptions } from '../extensions/sink'
import { redactEvent } from '../extensions/redaction'
import { sanitizeEvent } from '../extensions/sanitization'
import { truncateEvent } from '../extensions/truncation'

/**
 * Intercepts events on the `PostHogMCP.capture` boundary so tests can assert on the
 * post-pipeline event without making an HTTP call. Runs the same
 * redact → sanitize → truncate pipeline the real `capture` runs, so tests that
 * exercise redaction/sanitization/truncation see the transformed event.
 *
 * Patches the prototype so every `PostHogMCP` instance created by `instrument()`
 * during the test is intercepted.
 */
export class EventCapture {
  private capturedEvents: UnredactedEvent[] = []
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
      _options: McpCaptureOptions
    ): Promise<void> {
      let processed: UnredactedEvent = event
      if (event.redactionFn) {
        try {
          processed = (await redactEvent(event, event.redactionFn)) as UnredactedEvent
          processed.redactionFn = undefined
        } catch {
          // mirror client.capture: drop event on redact failure
          return
        }
      }
      try {
        processed = sanitizeEvent(processed)
      } catch {
        return
      }
      try {
        processed = truncateEvent(processed)
      } catch {
        return
      }
      capture.capturedEvents.push(processed)
    } as typeof McpEventSink.prototype.capture
  }

  async stop(): Promise<void> {
    if (this.original) {
      McpEventSink.prototype.capture = this.original
      this.original = undefined
    }
  }

  getEvents(): UnredactedEvent[] {
    return [...this.capturedEvents]
  }

  clear(): void {
    this.capturedEvents = []
  }

  findEventByType(eventType: string): Event | undefined {
    return this.capturedEvents.find((e) => e.eventType === eventType) as Event | undefined
  }

  findEventsByResourceName(resourceName: string): Event[] {
    return this.capturedEvents.filter((e) => e.resourceName === resourceName) as Event[]
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
