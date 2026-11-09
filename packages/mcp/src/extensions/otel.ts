import type { PostHog } from 'posthog-node'

import type { Event } from '../types'
import { MCPAnalyticsEventType } from './event-types'
import type { LoggerFn } from './logger'
import type { PostHogCaptureEvent } from './posthog-events'

/**
 * Which signals the SDK sends for each MCP operation (experimental):
 * - `events` (default): `$mcp_*` events, as before.
 * - `otel`: OpenTelemetry metrics and log records, sent through the posthog-node client's `metrics` and `captureLog`.
 * - `both`: events and OpenTelemetry.
 */
export type McpSignals = 'events' | 'otel' | 'both'

// Names follow the OpenTelemetry MCP semantic conventions (Development status), so they may change:
// https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/
const DURATION_METRIC = 'mcp.server.operation.duration'
// Not in the conventions: who called, on which model. Kept off the histogram so these labels don't multiply its buckets.
const CALLS_METRIC = 'mcp.client.calls'
// The conventions' buckets for this histogram, plus 1, 2 and 5 ms for fast tools.
const DURATION_BOUNDS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300]
// Client names and models come from the client and are unverified: past this many distinct values per process, the
// rest are recorded as `other`, so a misbehaving client can't fill the metrics client's series limit.
const MAX_LABEL_VALUES = 50
const MAX_LABEL_LENGTH = 64

/** The MCP method of an operation, or undefined for events that aren't one (feedback, custom events). */
export function mcpMethod(eventType: Event['eventType']): string | undefined {
  switch (eventType) {
    case MCPAnalyticsEventType.custom:
    case MCPAnalyticsEventType.mcpFeedback:
    case MCPAnalyticsEventType.mcpMissingCapability:
      return undefined
    case MCPAnalyticsEventType.mcpUnknownTool:
      return 'tools/call'
    default:
      return eventType.slice('mcp:'.length)
  }
}

/**
 * A model id as a label: lowercase, without a cloud or provider prefix (`us.anthropic.`, `openai/`), a Bedrock
 * version suffix (`-v1:0`), a context tag (`[1m]`) or a date suffix.
 */
export function normalizeModel(model: string | undefined): string {
  let m = (model ?? '').trim().toLowerCase()
  if (!m) return 'unknown'
  m = m.replace(/^(us|eu|apac|global)\.anthropic\./, '')
  m = m.replace(/^[a-z0-9.-]+\//, '')
  m = m.replace(/\[[^\]]*\]$/, '')
  m = m.replace(/-v\d+(:\d+)?$/, '')
  m = m.replace(/-20\d{6}$/, '')
  return m.slice(0, MAX_LABEL_LENGTH) || 'unknown'
}

/** The client as a label: the vendor's id when the client sent one, else its name, without an `mcp-remote` suffix. */
export function normalizeClient(event: Pick<Event, 'vendorClient' | 'clientName'>): string {
  const raw = (event.vendorClient || event.clientName || '').trim().toLowerCase()
  const name = raw.replace(/\s*\(via mcp-remote.*$/, '').trim()
  return name.slice(0, MAX_LABEL_LENGTH) || 'unknown'
}

/**
 * Records an MCP operation as OpenTelemetry metrics and a log record on a posthog-node client. Both are batched by the
 * client: metrics aggregate per 10s window, log records queue. `shutdown()` sends both, so a serverless handler that
 * ends each invocation with `await posthog.shutdown()` loses neither.
 */
export class McpOtelRecorder {
  readonly #labels = { client: new Set<string>(), model: new Set<string>(), error: new Set<string>() }
  readonly #metrics: boolean
  readonly #logs: boolean

  constructor(
    private readonly posthog: PostHog,
    logger: LoggerFn
  ) {
    const client = posthog as Partial<Pick<PostHog, 'metrics' | 'captureLog'>>
    this.#logs = typeof client.captureLog === 'function'
    this.#metrics = 'metrics' in posthog
    if (!this.#logs) logger('signals: this posthog-node version has no captureLog; upgrade it to send log records')
    if (!this.#metrics) logger('signals: this posthog-node version has no metrics client; upgrade it to send metrics')
  }

  /** `primary` is the operation's `$mcp_*` capture payload: its properties become the log record's attributes. */
  record(event: Event, primary: PostHogCaptureEvent | undefined): void {
    if (event.eventType === MCPAnalyticsEventType.custom || !primary) return
    const method = mcpMethod(event.eventType)
    const tool = method === 'tools/call' ? event.resourceName : undefined
    const errorType = event.isError
      ? this.#bounded('error', String(primary.properties.$mcp_error_type ?? 'tool_error'))
      : undefined

    const semconv: Record<string, string> = {
      ...(method ? { 'mcp.method.name': method } : {}),
      ...(tool ? { 'gen_ai.tool.name': tool } : {}),
      ...(errorType ? { 'error.type': errorType } : {}),
      ...(event.protocolVersion ? { 'mcp.protocol.version': event.protocolVersion } : {}),
    }

    if (this.#metrics && method) {
      if (typeof event.duration === 'number') {
        this.posthog.metrics.histogram(DURATION_METRIC, event.duration / 1000, {
          unit: 's',
          bounds: DURATION_BOUNDS,
          attributes: semconv,
        })
      }
      this.posthog.metrics.count(CALLS_METRIC, 1, {
        attributes: {
          'mcp.method.name': method,
          'mcp.client.name': this.#bounded('client', normalizeClient(event)),
          'gen_ai.request.model': this.#bounded('model', normalizeModel(event.llmModel)),
          outcome: event.isError ? 'error' : 'ok',
        },
      })
    }

    if (this.#logs) {
      // The person comes from the context, as for any posthog-node log, so the record joins to the same person.
      this.posthog.withContext({ distinctId: primary.distinct_id }, () =>
        this.posthog.captureLog({
          body: method ? [method, tool].filter(Boolean).join(' ') : primary.event,
          level: event.isError ? 'error' : 'info',
          attributes: {
            ...primary.properties,
            ...semconv,
            ...(event.sessionId ? { 'mcp.session.id': event.sessionId } : {}),
          },
        })
      )
    }
  }

  #bounded(kind: 'client' | 'model' | 'error', value: string): string {
    const seen = this.#labels[kind]
    if (seen.has(value)) return value
    if (seen.size >= MAX_LABEL_VALUES) return 'other'
    seen.add(value)
    return value
  }
}
