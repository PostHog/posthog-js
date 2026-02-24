import 'server-only'

import { PostHog } from 'posthog-node'
import type { PostHogOptions } from 'posthog-node'

const cache = new Map<string, PostHog>()

export function getOrCreateNodeClient(apiKey: string, options?: Partial<PostHogOptions>): PostHog {
    const key = `${apiKey}:${options?.host ?? ''}`
    let client = cache.get(key)
    if (!client) {
        client = new PostHog(apiKey, options)
        cache.set(key, client)
    }
    return client
}
