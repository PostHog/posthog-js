import { PostHog } from 'posthog-node'
import type { PostHogOptions } from 'posthog-node'
import { getOrCreatePostHogClient } from './clientCache.js'

const cache = new Map<string, PostHog>()

export async function getOrCreateEdgeClient(projectToken: string, options?: Partial<PostHogOptions>): Promise<PostHog> {
    return getOrCreatePostHogClient(cache, PostHog, projectToken, options)
}
