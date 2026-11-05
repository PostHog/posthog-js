import { PostHog } from 'posthog-node'
import type { PostHogOptions } from 'posthog-node'
import { getOrCreatePostHogClient } from './clientCache.js'

// With default Next.js bundling, instrumentation and App Router request handlers
// run in separate webpack layers, each loading its own copy of this module. Share
// the cache through globalThis so every layer reuses the same client — otherwise
// the OTel span processor and withPostHogContext can read and write different
// clients' context for the same request.
const CACHE_KEY = Symbol.for('posthog-nextjs.node-client-cache')
const cacheHolder = globalThis as typeof globalThis & { [CACHE_KEY]?: Map<string, PostHog> }
const cache = (cacheHolder[CACHE_KEY] ??= new Map<string, PostHog>())

export async function getOrCreateNodeClient(apiKey: string, options?: Partial<PostHogOptions>): Promise<PostHog> {
    return getOrCreatePostHogClient(cache, PostHog, apiKey, options)
}
