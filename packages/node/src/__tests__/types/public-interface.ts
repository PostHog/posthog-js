import type { IPostHog, PostHog } from '../../entrypoints/index.node'

export function checkPublicInterface(posthog: PostHog): Promise<void> {
  const client: IPostHog = posthog
  const signal = new AbortController().signal
  client.withContext({ sessionId: 'request-session' }, () => client.getContext(), { fresh: true, signal })
  client.enterContext({ distinctId: 'request-user' }, { signal })
  client.metrics.count('jobs.processed', 1)
  client.captureException(new Error('queued exception'), 'user')
  return client.captureExceptionImmediate(new Error('immediate exception'), 'user')
}

export async function checkOpenTelemetryInterface(posthog: PostHog): Promise<void> {
  const { BasicTracerProvider } = await import('@opentelemetry/sdk-trace-base')
  const { PostHogContextSpanProcessor, enrichCurrentSpan } = await import('../../entrypoints/otel')
  const provider = new BasicTracerProvider({ spanProcessors: [new PostHogContextSpanProcessor(posthog)] })
  enrichCurrentSpan(posthog)
  await provider.shutdown()
}
