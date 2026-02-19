import type { PostHogConfig } from 'posthog-js'
import type { PostHogOptions } from 'posthog-node'

/**
 * Configuration for the client-side PostHog provider.
 * Extends the standard posthog-js config.
 */
export type PostHogClientConfig = Partial<PostHogConfig>

/**
 * Configuration for the server-side PostHog client.
 * Extends the standard posthog-node options.
 */
export type PostHogServerConfig = PostHogOptions
