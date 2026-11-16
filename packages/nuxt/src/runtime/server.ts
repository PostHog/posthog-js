import type { PostHog } from 'posthog-node'
import { serverClient } from './server-client'

export function getPostHogServerClient(): PostHog | undefined {
  return serverClient.current
}
