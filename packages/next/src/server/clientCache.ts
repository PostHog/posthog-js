type WaitUntil = (promise: Promise<unknown>) => void

type CacheablePostHogOptions = {
    host?: string
    waitUntil?: WaitUntil
}

type PostHogConstructor<TClient, TOptions extends CacheablePostHogOptions> = new (
    apiKey: string,
    options?: Partial<TOptions>
) => TClient

// Auto-detect waitUntil from @vercel/functions at module load.
// Fails gracefully in environments where it's not available.
const autoDetectedWaitUntil: Promise<WaitUntil | undefined> = import(/* webpackIgnore: true */ '@vercel/functions')
    .then((mod) => mod.waitUntil)
    .catch(() => undefined)

/**
 * Returns a cached PostHog client, creating one if needed.
 *
 * Clients are cached by project key + host. Only the options from the first
 * call for a given key+host pair take effect; subsequent calls with different
 * options (e.g. flushAt, flushInterval) will return the existing client.
 *
 * On first call, awaits auto-detection of @vercel/functions waitUntil
 * and merges it into options. Explicit options.waitUntil takes priority.
 */
export async function getOrCreatePostHogClient<TClient, TOptions extends CacheablePostHogOptions>(
    cache: Map<string, TClient>,
    PostHogClient: PostHogConstructor<TClient, TOptions>,
    apiKey: string,
    options?: Partial<TOptions>
): Promise<TClient> {
    const key = `${apiKey}:${options?.host ?? ''}`
    let client = cache.get(key)
    if (!client) {
        const waitUntil = options?.waitUntil ?? (await autoDetectedWaitUntil)
        const mergedOptions = {
            ...(waitUntil ? { waitUntil } : {}),
            ...options,
        } as Partial<TOptions>
        client = new PostHogClient(apiKey, mergedOptions)
        cache.set(key, client)
    }
    return client
}
