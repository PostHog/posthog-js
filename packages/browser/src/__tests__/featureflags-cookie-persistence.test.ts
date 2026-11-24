import { publicFlagDetail } from '@posthog/browser-common/flags-response-v4'
import { isNull } from '@posthog/core'
import { PERSISTENCE_FEATURE_FLAG_DETAILS } from '../constants'
import { cookieStore, localStore } from '../storage'
import { PARITY_FLAGS, responseFor, startClient, type FlagSpec } from './released-flags-scenarios'

const NAME = 'flag-cookie-compatibility'
const COOKIE = `ph_${NAME}`
const LEGACY: FlagSpec = {
    key: 'existing-layout',
    enabled: true,
    variant: 'treatment',
    payload: '{"columns":2}',
    value: 'treatment',
    configVersion: 1,
    id: 100,
    version: 1,
    reason: { code: 'condition_match', condition_index: 0, description: 'Matched condition set 1' },
}
const SPLIT = PARITY_FLAGS.find((flag) => flag.key === 'v2-split')!

// A v1 string record at v4 also carries its variant key, as the server's projection does.
const v4Response = (specs: FlagSpec[]): Record<string, any> => {
    const response = responseFor('v4', specs) as Record<string, any>
    for (const spec of specs) {
        if (spec.configVersion === 1 && !isNull(spec.variant)) {
            response.flags[spec.key].metadata.variant_key = spec.variant
        }
    }
    return response
}

beforeEach(() => {
    vi.useFakeTimers()
    for (const name of ['warn', 'error', 'info', 'log'] as const) {
        vi.spyOn(console, name).mockImplementation(() => {})
    }
    window.localStorage.clear()
    cookieStore._remove(COOKIE, false)
})

afterEach(() => {
    cookieStore._remove(COOKIE, false)
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('v4 flags in cookie persistence', () => {
    it.each(['cookie', 'fallback'] as const)('compacts only v1 records with %s storage', async (storage) => {
        if (storage === 'fallback') {
            vi.spyOn(localStore, '_is_supported').mockReturnValue(false)
        }
        const client = await startClient(
            { persistence: storage === 'cookie' ? 'cookie' : 'localStorage+cookie', cross_subdomain_cookie: false },
            NAME
        )
        await client.load(v4Response([LEGACY, SPLIT]))
        const live = client.posthog.get_property(PERSISTENCE_FEATURE_FLAG_DETAILS)
        const original = structuredClone(live)
        const stored = cookieStore._parse(COOKIE)[PERSISTENCE_FEATURE_FLAG_DETAILS]

        expect(stored[LEGACY.key]).toEqual(publicFlagDetail(live[LEGACY.key]))
        expect(stored[LEGACY.key]).not.toHaveProperty('value')
        expect(stored[LEGACY.key].metadata).not.toHaveProperty('config_version')
        expect(stored[LEGACY.key].metadata).not.toHaveProperty('variant_key')
        expect(stored[SPLIT.key]).toEqual(JSON.parse(JSON.stringify(live[SPLIT.key])))
        expect(live[LEGACY.key]).toMatchObject({ value: 'treatment', metadata: { config_version: 1 } })

        const write = vi.spyOn(cookieStore, '_set')
        client.posthog.persistence!.save()
        expect(write).not.toHaveBeenCalled()
        expect(client.posthog.get_property(PERSISTENCE_FEATURE_FLAG_DETAILS)).toEqual(original)
        await client.close()
    })

    it('keeps cached v2 exposures and dedupe across page loads beside compact v1 flags', async () => {
        const config = { persistence: 'cookie' as const, cross_subdomain_cookie: false }
        const first = await startClient(config, NAME)
        await first.load(v4Response([LEGACY, SPLIT]))
        first.posthog.getFeatureFlag(LEGACY.key)
        await first.close()

        const second = await startClient(config, NAME)
        expect(second.requests).toEqual([])
        expect(second.posthog.getFeatureFlag(LEGACY.key)).toBe('treatment')
        expect(second.posthog.getFeatureFlagPayload(LEGACY.key)).toEqual({ columns: 2 })
        expect(second.events).toEqual([])
        expect(second.posthog.getFeatureFlag(SPLIT.key)).toBe(SPLIT.value)
        expect(second.events).toEqual([
            ['$feature_flag_called', expect.objectContaining({ $feature_flag_config_version: 2 })],
            ['$experiment_exposure', expect.objectContaining({ $feature_flag_variant_key: 'arm-b' })],
        ])
        await second.close()

        const third = await startClient(config, NAME)
        expect(third.posthog.getFeatureFlag(SPLIT.key)).toBe(SPLIT.value)
        expect(third.events).toEqual([])
        expect(third.requests).toEqual([])
        await third.close()
    })

    it('preserves the distinction between disabled and failed v1 records after a page load', async () => {
        const config = { persistence: 'cookie' as const, cross_subdomain_cookie: false }
        const first = await startClient(config, NAME)
        await first.load(
            v4Response([
                { ...LEGACY, key: 'disabled', enabled: false, variant: null, value: false, payload: null },
                { ...LEGACY, key: 'failed', failed: true, variant: null, value: null, payload: null },
            ])
        )
        await first.close()

        const next = await startClient(config, NAME)
        expect(next.posthog.isFeatureEnabled('disabled', { defaultValue: true })).toBe(false)
        expect(next.posthog.isFeatureEnabled('failed', { defaultValue: true })).toBe(true)
        expect(next.posthog.getFeatureFlag('failed', { send_event: false })).toBeUndefined()
        expect(next.posthog.getFeatureFlagPayload('failed')).toBeUndefined()
        expect(next.events).toEqual([
            ['$feature_flag_called', expect.objectContaining({ $feature_flag_response: false })],
            ['$feature_flag_called', expect.objectContaining({ $feature_flag_error: 'evaluation_failed' })],
        ])
        await next.close()
    })

    it('keeps updated legacy values within the cookie budget and readable on the next page', async () => {
        const specs = Array.from({ length: 6 }, (_, i) => ({
            ...LEGACY,
            key: `existing-flag-${i}`,
            id: 100 + i,
            payload: null,
        }))
        const config = { persistence: 'cookie' as const, cross_subdomain_cookie: false }
        const first = await startClient(config, NAME)
        await first.load(responseFor('v2', specs))
        const legacyBytes = COOKIE.length + encodeURIComponent(cookieStore._get(COOKIE)).length
        expect(legacyBytes).toBeLessThan(4096)

        const changed = specs.map((spec) => ({ ...spec, value: 'different', variant: 'different' }))
        await first.load(v4Response(changed))
        const props = first.posthog.persistence!.props
        expect(COOKIE.length + encodeURIComponent(JSON.stringify(props)).length).toBeGreaterThan(4096)
        expect(COOKIE.length + encodeURIComponent(cookieStore._get(COOKIE)).length).toBeLessThanOrEqual(legacyBytes)
        await first.close()

        const next = await startClient(config, NAME)
        expect(next.requests).toEqual([])
        for (const spec of changed) {
            expect(next.posthog.getFeatureFlag(spec.key, { send_event: false })).toBe('different')
        }
        await next.close()
    })

    it.each(['localStorage', 'localStorage+cookie', 'sessionStorage', 'memory'] as const)(
        'retains the full records in %s',
        async (persistence) => {
            const first = await startClient({ persistence }, NAME)
            await first.load(v4Response([LEGACY, SPLIT]))
            const details = JSON.parse(JSON.stringify(first.posthog.get_property(PERSISTENCE_FEATURE_FLAG_DETAILS)))
            await first.close()

            const next = await startClient({ persistence }, NAME)
            expect(next.posthog.get_property(PERSISTENCE_FEATURE_FLAG_DETAILS)).toEqual(details)
            expect(details[LEGACY.key]).toMatchObject({ value: 'treatment', metadata: { config_version: 1 } })
            await next.close()
        }
    )
})
