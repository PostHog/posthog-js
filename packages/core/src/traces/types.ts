// Re-export the user-facing tracing types from @posthog/types so the rest of the
// traces module can pull everything from one place.
export type {
  Span,
  SpanAttributes,
  SpanAttributeValue,
  SpanKind,
  SpanStatusCode,
  SpanTimeInput,
  StartSpanOptions,
  TracesConfig,
  OtlpSpan,
  OtlpSpanAnyValue,
  OtlpSpanEvent,
  OtlpSpanKeyValue,
  OtlpSpanStatus,
  OtlpTracesPayload,
} from '@posthog/types'

import type { OtlpTracesPayload, Span, SpanAttributes, SpanKind, SpanStatusCode, TracesConfig } from '@posthog/types'

/** Same tagged outcome shape as `SendLogsBatchOutcome` — one policy for all three signals. */
export type SendTracesBatchOutcome =
  | { kind: 'ok' }
  | { kind: 'retry-later'; error: unknown }
  | { kind: 'too-large' }
  | { kind: 'fatal'; error: unknown }

/**
 * The minimal host surface `PostHogTraces` depends on. `PostHogCoreStateless`
 * satisfies it structurally (node, mobile); the browser supplies an adapter
 * backed by its own request layer.
 */
export interface TracesHost {
  readonly isDisabled: boolean
  readonly optedOut: boolean
  _sendTracesBatch(payload: OtlpTracesPayload): Promise<SendTracesBatchOutcome>
  getLibraryId(): string
  getLibraryVersion(): string
}

/**
 * PostHog context snapshotted onto every span at start, so traces join back to
 * persons and sessions. Each SDK fills the fields that apply to it: server SDKs
 * read their request context, client SDKs their process-global identity and
 * session manager. Absent fields add no attribute.
 *
 * Internal to `@posthog/core` — customers don't see this in autocomplete.
 */
export interface TraceSdkContext {
  distinctId?: string
  sessionId?: string
  /** Web-only — current page URL. */
  currentUrl?: string
  /** Mobile-only — current screen / view name. */
  screenName?: string
  /** Mobile-only — app foreground/background state. */
  appState?: 'foreground' | 'background'
}

export interface SpanEventRecord {
  name: string
  /** ms epoch. */
  timestamp: number
  attributes?: SpanAttributes
}

/**
 * A completed span in plain, pre-encoding form: strings for kind and status, a
 * plain attribute map, ms-epoch timestamps. This is what the engine queues.
 */
export interface SpanRecord {
  traceId: string
  spanId: string
  parentSpanId?: string
  traceState?: string
  name: string
  kind: SpanKind
  status?: { code: SpanStatusCode; message?: string }
  attributes: SpanAttributes
  events: SpanEventRecord[]
  /** ms epoch. */
  startTime: number
  endTime: number
}

/**
 * Tracks which span is active, so spans nest without manual parent plumbing.
 *
 * The mechanism is platform-specific and stays out of core: node injects an
 * `AsyncLocalStorage` implementation, the browser a synchronous one. Core must
 * not import `node:async_hooks` — it ships to browsers, edge runtimes and
 * React Native.
 */
export interface SpanContextManager {
  /** The active span, or `undefined` when none is active. */
  active(): Span | undefined
  /** Run `fn` with `span` active for its (synchronous and async) duration. */
  with<T>(span: Span, fn: () => T): T
}

/**
 * Fields `PostHogTraces` needs resolved at runtime. The host SDK applies its own
 * defaults and hands the resolved config to the constructor.
 */
export interface ResolvedTracesConfig extends TracesConfig {
  flushIntervalMs: number
  maxExportBatchSize: number
  /**
   * Bound on the in-memory export queue, set by the host. On overflow the
   * *incoming* span is dropped rather than evicting queued ones, whose children
   * may already have been exported.
   */
  maxQueueSize: number
}
