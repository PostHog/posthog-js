import { FlagDefinitionCacheData, FlagDefinitionCacheProvider } from 'posthog-node/experimental'

// Base implementation of a Cloudflare KV-backed flag definition cache.
// Not intended to be used directly.
class CloudflareKVFlagCache implements FlagDefinitionCacheProvider {
    private static readonly CACHE_KEY_PREFIX = 'posthog:flags:'

    constructor(
        protected kv: KVNamespace,
        protected teamKey: string
    ) {}

    protected get cacheKey(): string {
        return `${CloudflareKVFlagCache.CACHE_KEY_PREFIX}${this.teamKey}`
    }

    async getFlagDefinitions() {
        try {
            const cached = await this.kv.get(this.cacheKey)
            if (cached === null) {
                return undefined
            }
            const parsed = JSON.parse(cached)
            return parsed
        } catch {
            return undefined
        }
    }

    shouldFetchFlagDefinitions() {
        // We'll overwrite this in subclasses.
        return false
    }

    async onFlagDefinitionsReceived(data: FlagDefinitionCacheData) {
        // We don't use an expiration here to guarantee availability of flag
        // definitions at all times.
        const serialized = JSON.stringify(data)
        await this.kv.put(this.cacheKey, serialized)
    }

    shutdown() {
        // no-op
    }
}

// Reader cache that only ever reads from KV and never writes.
// This can be used in request handlers to provide read-only access
// to flag definitions.
export class CloudflareKVFlagCacheReader extends CloudflareKVFlagCache {
    shouldFetchFlagDefinitions() {
        // Never fetch from the read only cache. Returning false here means
        // that we'll never be asked to write flag definitions to cache.
        return false
    }

    async onFlagDefinitionsReceived(): Promise<void> {
        // This shouldn't ever happen.
        throw new Error('CloudflareKVFlagCacheReader is read-only and cannot store flag definitions.')
    }
}

// Writer cache that always fetches fresh flag definitions and overwrites existing cache.
// Used in scheduled jobs to refresh the cache periodically.
export class CloudflareKVFlagCacheWriter extends CloudflareKVFlagCache {
    getFlagDefinitions() {
        // Always return undefined to force fetching fresh flag definitions.
        return Promise.resolve(undefined)
    }

    shouldFetchFlagDefinitions() {
        // Assume we don't need any distributed coordination. We can run this in a
        // cron job on a single scheduled worker.
        return true
    }
}
