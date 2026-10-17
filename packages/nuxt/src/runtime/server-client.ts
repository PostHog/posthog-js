import type { PostHog } from 'posthog-node'

export const serverClient: { current?: PostHog } = {}
