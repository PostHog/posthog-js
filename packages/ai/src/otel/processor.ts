import { PostHog } from 'posthog-node'
import { captureSpan } from './capture'
import type { Context, Span } from '@opentelemetry/api'
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base'
import type { PostHogTelemetryOptions } from './types'

export class PostHogSpanProcessor implements SpanProcessor {
  private readonly pendingCaptures = new Set<Promise<void>>()

  constructor(
    private readonly phClient: PostHog,
    private readonly options: PostHogTelemetryOptions = {}
  ) {}

  onStart(_span: Span, _parentContext: Context): void {
    // no-op
  }

  onEnd(span: ReadableSpan): void {
    const capturePromise = captureSpan(span, this.phClient, this.options)
      .catch((error) => {
        console.error('Failed to capture telemetry span', error)
      })
      .finally(() => {
        this.pendingCaptures.delete(capturePromise)
      })

    this.pendingCaptures.add(capturePromise)
  }

  async shutdown(): Promise<void> {
    await this.forceFlush()
  }

  async forceFlush(): Promise<void> {
    while (this.pendingCaptures.size > 0) {
      await Promise.allSettled([...this.pendingCaptures])
    }
  }
}

export function createPostHogSpanProcessor(phClient: PostHog, options: PostHogTelemetryOptions = {}): SpanProcessor {
  return new PostHogSpanProcessor(phClient, options)
}
