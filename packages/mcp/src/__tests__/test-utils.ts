import type { Event, UnredactedEvent } from '../types'
import { PostHogMCP } from '../modules/client'
import { redactEvent } from '../modules/redaction'
import { sanitizeEvent } from '../modules/sanitization'
import { truncateEvent } from '../modules/truncation'

/**
 * Intercepts events on the `PostHogMCP.ingest` boundary so tests can assert on the
 * post-pipeline event without making an HTTP call. Runs the same
 * redact → sanitize → truncate pipeline the real `ingest` runs, so tests that
 * exercise redaction/sanitization/truncation see the transformed event.
 *
 * Patches the prototype so every `PostHogMCP` instance created by `track()`
 * during the test is intercepted.
 */
export class EventCapture {
  private capturedEvents: UnredactedEvent[] = []
  private original?: (event: UnredactedEvent, enableAITracing: boolean) => Promise<void>

  async start(): Promise<void> {
    if (this.original) {
      return
    }
    this.original = PostHogMCP.prototype.ingest
    const capture = this
    PostHogMCP.prototype.ingest = async function (
      this: PostHogMCP,
      event: UnredactedEvent,
      _enableAITracing: boolean
    ): Promise<void> {
      let processed: UnredactedEvent = event
      if (event.redactionFn) {
        try {
          processed = (await redactEvent(event, event.redactionFn)) as UnredactedEvent
          processed.redactionFn = undefined
        } catch {
          // mirror client.ingest: drop event on redact failure
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
    } as typeof PostHogMCP.prototype.ingest
  }

  async stop(): Promise<void> {
    if (this.original) {
      PostHogMCP.prototype.ingest = this.original
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
