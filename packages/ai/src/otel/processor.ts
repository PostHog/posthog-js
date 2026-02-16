import { PostHog } from 'posthog-node'
import { captureSpan } from './capture'
import type { Context, Span } from '@opentelemetry/api'
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base'
import type { PostHogTelemetryOptions } from './types'

export class PostHogSpanProcessor implements SpanProcessor {
  constructor(
    private readonly phClient: PostHog,
    private readonly options: PostHogTelemetryOptions = {}
  ) {}

  onStart(_span: Span, _parentContext: Context): void {
    // no-op
  }

  onEnd(span: ReadableSpan): void {
    void captureSpan(span, this.phClient, this.options).catch((error) => {
      console.error('Failed to capture telemetry span', error)
    })
  }

  async shutdown(): Promise<void> {
    return Promise.resolve()
  }

  async forceFlush(): Promise<void> {
    return Promise.resolve()
  }
}

export function createPostHogSpanProcessor(phClient: PostHog, options: PostHogTelemetryOptions = {}): SpanProcessor {
  return new PostHogSpanProcessor(phClient, options)
}
