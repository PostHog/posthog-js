export type {
  Span,
  SpanAttributes,
  SpanAttributeValue,
  SpanKind,
  SpanStatusCode,
  SpanTimeInput,
  StartSpanOptions,
  TracesConfig,
  BeforeSpanSendFn,
  OtlpSpan,
  OtlpSpanEvent,
  OtlpSpanKeyValue,
  OtlpSpanStatus,
  OtlpTracesPayload,
} from '@posthog/types'

import type {
  BeforeSpanSendFn,
  OtlpTracesPayload,
  Span,
  SpanAttributes,
  SpanKind,
  SpanRecord as HookSpanRecord,
  SpanStatusCode,
  TracesConfig,
} from '@posthog/types'

/** Same tagged outcome shape as `SendLogsBatchOutcome` — one policy for all three signals. */
export type SendTracesBatchOutcome =
  | { kind: 'ok' }
  | { kind: 'retry-later'; error: unknown }
  | { kind: 'too-large' }
  | { kind: 'fatal'; error: unknown }

/** The minimal host surface `PostHogTraces` depends on; `PostHogCoreStateless` satisfies it structurally. */
export interface TracesHost {
  readonly isDisabled: boolean
  readonly optedOut: boolean
  _sendTracesBatch(payload: OtlpTracesPayload): Promise<SendTracesBatchOutcome>
  getLibraryId(): string
  getLibraryVersion(): string
}

/**
 * PostHog context snapshotted onto every span at start, so traces join back to
 * persons and sessions. Each SDK fills the fields that apply to it; absent
 * fields add no attribute. Internal to `@posthog/core`.
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
 * plain attribute map, ms-epoch timestamps.
 */
/**
 * A finished span as the SDK carries it, which is the hook-visible record plus
 * the fields no hook may rewrite. Declaring only the additions keeps the shared
 * half from drifting; a field added here rather than to the public record is a
 * field `beforeSpanSend` cannot see, and so cannot corrupt.
 */
export interface SpanRecord extends HookSpanRecord {
  traceState?: string
  /** The W3C trace-flags byte this span propagates, e.g. `01` sampled. */
  traceFlags: string
  /** True when the parent came from a `traceparent` header rather than a local handle. */
  parentIsRemote: boolean
  droppedAttributesCount?: number
  droppedEventsCount?: number
}

/**
 * Tracks which span is active, so spans nest without manual parent plumbing. The
 * mechanism is platform-specific and stays out of core: node injects an
 * `AsyncLocalStorage` implementation over the synchronous default.
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
   * Bound on the in-memory export queue. On overflow the *incoming* span is
   * dropped rather than queued ones, whose children may already have shipped.
   */
  maxQueueSize: number
  beforeSpanSend: BeforeSpanSendFn[]
  maxAttributesPerSpan: number
  maxEventsPerSpan: number
  maxAttributeValueLength: number
  /** Bound on spans started but not yet ended. At the bound `startSpan` returns a no-op handle. */
  maxLiveSpans: number
  /** How long a span may stay live before it stops being accounted for and can never export. */
  maxSpanAgeMs: number
}
