import { MutableFeatureFlagsConfigSource } from '../feature-flags-config'
import { defaultConfig } from '../posthog-core'

describe('feature flags configuration mapping', () => {
    it('maps and resets session deduplication, cache TTL, and compression options', () => {
        const config = defaultConfig()
        const source = new MutableFeatureFlagsConfigSource(config)
        const defaults = {
            deduplicateCallsPerSession: false,
            cacheTtlMs: undefined,
            compression: 'best-available',
        }
        expect(source.get()).toMatchObject(defaults)

        source.update(
            {
                ...config,
                advanced_feature_flags_dedup_per_session: true,
                feature_flag_cache_ttl_ms: 60 * 60 * 1000,
                disable_compression: true,
            },
            false
        )
        expect(source.get()).toMatchObject({
            deduplicateCallsPerSession: true,
            cacheTtlMs: 60 * 60 * 1000,
            compression: undefined,
        })

        source.update(config, false)
        expect(source.get()).toMatchObject(defaults)
    })
})
