import type { IPostHog, PostHog } from '../../entrypoints/index.node'

export function checkPublicInterface(posthog: PostHog): Promise<void> {
  const client: IPostHog = posthog
  client.metrics.count('jobs.processed', 1)
  client.captureException(new Error('queued exception'), { distinctId: 'user', level: 'warning' })
  // @ts-expect-error The 5.x positional form only works at runtime.
  client.captureException(new Error('queued exception'), 'user')
  return client.captureExceptionImmediate(new Error('immediate exception'), { distinctId: 'user' })
}
