import { PostHog } from 'posthog-node'
import type { PostHogOptions } from 'posthog-node'

const cache = new Map<string, PostHog>()

// Auto-detect waitUntil from @vercel/functions at module load.
// Fails gracefully in environments where it's not available.
const autoDetectedWaitUntil: Promise<((p: Promise<unknown>) => void) | undefined> = import('@vercel/functions')
    .then((mod) => mod.waitUntil)
    .catch(() => undefined)

/**
 * Returns a cached PostHog node client, creating one if needed.
 *
 * On first call, awaits auto-detection of @vercel/functions waitUntil
 * and merges it into options. Explicit options.waitUntil takes priority.
 */
export async function getOrCreateNodeClient(
    apiKey: string,
    options?: Partial<PostHogOptions>
): Promise<PostHog> {
    const key = `${apiKey}:${options?.host ?? ''}`
    let client = cache.get(key)
    if (!client) {
        const waitUntil = options?.waitUntil ?? (await autoDetectedWaitUntil)
        const mergedOptions: Partial<PostHogOptions> = {
            ...(waitUntil ? { waitUntil } : {}),
            ...options,
        }
        client = new PostHog(apiKey, mergedOptions)
        cache.set(key, client)
    }
    return client
}
