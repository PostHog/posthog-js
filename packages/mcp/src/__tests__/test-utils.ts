import type { CallToolResult, JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { Event, McpEvent } from '../types'
import { McpEventSink, type McpCaptureOptions, processMcpEvent } from '../extensions/sink'
import type { PostHogCaptureEvent } from '../extensions/posthog-events'

/** A value the tests probe into freely (`event.response.content[0].text`) without narrowing each step. */
export type Dynamic = { [key: string]: Dynamic }

/** `Event` whose `unknown` payloads are probe-able. */
export type LooseEvent = Event & { response: Dynamic; parameters: Dynamic }

/** `McpEvent` whose `unknown` payloads are probe-able. */
export type LooseMcpEvent = McpEvent & { response: Dynamic; parameters: Dynamic }

/** `PostHogCaptureEvent` whose captured payload properties are probe-able. */
export type LooseCaptureEvent = Omit<PostHogCaptureEvent, 'properties'> & {
  properties: PostHogCaptureEvent['properties'] & { $mcp_parameters: Dynamic; $mcp_response: Dynamic }
}

/**
 * Intercepts events at the sink boundary so tests can assert on what actually
 * reaches `posthog.capture()` without an HTTP call.
 *
 * It runs the SAME pipeline production runs — `processMcpEvent` is the single
 * source of truth shared with `McpEventSink.capture` — so there's no risk of the
 * harness and the sink drifting. Two views are exposed:
 *
 *  - `getEvents()` — the post-pipeline `McpEvent` (redacted/sanitized/
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
  private capturedEvents: McpEvent[] = []
  private capturedPayloads: PostHogCaptureEvent[] = []
  private original?: (event: McpEvent, options: McpCaptureOptions) => Promise<void>

  async start(): Promise<void> {
    if (this.original) {
      return
    }
    this.original = McpEventSink.prototype.capture
    const capture = this
    McpEventSink.prototype.capture = async function (
      this: McpEventSink,
      event: McpEvent,
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
  getEvents(): LooseMcpEvent[] {
    return [...this.capturedEvents] as LooseMcpEvent[]
  }

  /** PostHog payloads as handed to `posthog.capture()` (after fan-out). */
  getCaptures(): LooseCaptureEvent[] {
    return [...this.capturedPayloads] as LooseCaptureEvent[]
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
  findCapturesByEvent(eventName: string): LooseCaptureEvent[] {
    return this.capturedPayloads.filter((c) => c.event === eventName) as LooseCaptureEvent[]
  }
}

/** The text of a tool result's `index`th content block, which must be a text block. */
export function textOf(result: Pick<CallToolResult, 'content'>, index = 0): string {
  const block = result.content[index]
  if (block?.type !== 'text') {
    throw new Error(`expected a text block at content[${index}], got ${block?.type}`)
  }
  return block.text
}

/**
 * Minimal stand-in for a `posthog-node` client. `instrument()` only needs a
 * truthy `posthog` to build a sink, and `EventCapture` intercepts the sink
 * before it ever calls `posthog.capture`, so a no-op `capture` is enough for
 * tests that assert on captured MCP events.
 */
export function fakePostHog(): any {
  return {
    capture: () => undefined,
    captureException: () => undefined,
    flush: async () => undefined,
    shutdown: async () => undefined,
  }
}

interface SentMessage {
  message: { id?: unknown; result?: unknown; error?: unknown }
  /** The transport's session id when the message was sent: what an HTTP transport puts in the `Mcp-Session-Id` response header. */
  sessionId: string | undefined
}

/**
 * An in-process MCP transport that a real SDK server connects to, recording the
 * session id each message went out with. `request` delivers one client request
 * the way an HTTP transport does and resolves with its response.
 */
export class RecordingTransport {
  sessionId?: string
  onmessage?: (message: unknown, extra?: unknown) => void
  onclose?: () => void
  onerror?: (error: Error) => void
  private readonly waiting = new Map<unknown, (sent: SentMessage) => void>()

  async start(): Promise<void> {}

  async close(): Promise<void> {}

  async send(message: JSONRPCMessage & SentMessage['message']): Promise<void> {
    const sent = { message, sessionId: this.sessionId }
    this.waiting.get(message.id)?.(sent)
    this.waiting.delete(message.id)
  }

  request(
    message: { id: number; method: string; params?: Record<string, unknown> },
    /** `null` delivers it the way stdio does: no HTTP request info. */
    requestInfo: { headers: Record<string, string> } | null = { headers: {} }
  ): Promise<SentMessage> {
    return new Promise((resolve) => {
      this.waiting.set(message.id, resolve)
      this.onmessage?.({ jsonrpc: '2.0', ...message }, requestInfo ? { requestInfo } : undefined)
    })
  }
}
