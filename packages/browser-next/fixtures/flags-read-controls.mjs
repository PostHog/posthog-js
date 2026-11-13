import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)
for (const load of [(name) => import(name), (name) => require(name)]) {
    const { createPostHog, FeatureFlagsExtension } = await load('@posthog/browser')
    const { featureFlags } = await load('@posthog/browser/flags')
    const { analytics } = await load('@posthog/browser/analytics')
    for (const inclusion of ['automatic', 'static']) {
        const captured = []
        let flagRequests = 0
        const flagOptions = {
            refreshIntervalMs: 0,
            bootstrap: {
                featureFlags: { test: 'bootstrap' },
                featureFlagPayloads: { test: [{ text: 'original' }, null] },
            },
        }
        const client = await createPostHog({
            projectToken: 'ph_flags_read_controls_fixture',
            capturePageview: false,
            storage: false,
            navigator: false,
            remoteConfig: {
                supportedCompression: [],
                toolbarParams: {},
                toolbarVersion: 'toolbar',
                isAuthenticated: false,
                siteApps: [],
            },
            ...(inclusion === 'automatic' ? { flags: flagOptions } : { flags: false }),
            extensions: [
                analytics({ flushInterval: 0 }),
                ...(inclusion === 'static' ? [featureFlags(flagOptions)] : []),
            ],
            fetch: async (input) => {
                assert.ok(String(input).includes('/flags/'))
                flagRequests++
                return new Response(
                    JSON.stringify({
                        flags: {
                            test: { key: 'test', enabled: true, variant: 'remote' },
                            off: { key: 'off', enabled: false },
                        },
                    })
                )
            },
        })
        const flags = await client.resolveExtension(FeatureFlagsExtension)
        assert.equal(flags, client.featureFlags)
        assert.ok(flags)
        client.analytics.onEvent((event) => captured.push(event))
        const reloading = []
        let subscription
        try {
            assert.equal(flags.getFeatureFlag('test', { sendFeatureFlagEvent: false }).variant, 'bootstrap')
            assert.equal(flags.getFeatureFlag('test', { fresh: true }), undefined)
            const snapshot = flags.getAllFeatureFlags()
            snapshot[0].payload[0].text = 'changed'
            snapshot[0].payload.push('added')
            assert.deepEqual(flags.getAllFeatureFlags()[0].payload, [{ text: 'original' }, null])
            assert.equal(captured.length, 0)
            assert.deepEqual(await flags.reloadFeatureFlags(), { status: 'loaded' })
            subscription = flags.onReloading(() => reloading.push('start'))
            assert.equal(reloading.length, 0)
            assert.deepEqual(await flags.reloadFeatureFlags(), { status: 'loaded' })
            assert.deepEqual(reloading, ['start'])
            assert.deepEqual(flags.getFeatureFlag('off', { fresh: true, sendFeatureFlagEvent: false }), {
                key: 'off',
                enabled: false,
                variant: undefined,
                payload: undefined,
            })
            assert.equal(flags.getAllFeatureFlags().length, 2)
            assert.equal(captured.length, 0)
            flags.getFeatureFlag('test', { sendFeatureFlagEvent: undefined })
            flags.getFeatureFlag('test')
            assert.equal(captured.length, 1)
            assert.equal(captured[0].event, '$feature_flag_called')
            flags.updateFlags({ legacy: '' }, { legacy: { copy: ['original'] } })
            const emptyVariant = {
                key: 'legacy',
                enabled: false,
                variant: '',
                payload: { copy: ['original'] },
            }
            assert.deepEqual(flags.getFeatureFlag('legacy', { sendFeatureFlagEvent: false }), emptyVariant)
            const emptyVariantSnapshot = flags.getAllFeatureFlags()
            assert.deepEqual(emptyVariantSnapshot, [emptyVariant])
            emptyVariantSnapshot[0].payload.copy.push('changed')
            assert.deepEqual(flags.getAllFeatureFlags(), [emptyVariant])
            assert.equal(captured.length, 1)
            subscription.dispose()
            await flags.reloadFeatureFlags()
            assert.equal(reloading.length, 1)
            for (const trigger of ['explicit', 'automatic']) {
                const before = flagRequests
                let starts = 0
                const nested = []
                const nestedSubscription = flags.onReloading(() => {
                    starts++
                    if (starts <= 3) nested.push(flags.reloadFeatureFlags())
                })
                try {
                    let completion
                    if (trigger === 'explicit') {
                        completion = flags.reloadFeatureFlags()
                    } else {
                        await client.analytics.identify('nested-reload-person')
                        completion = flags.reloadFeatureFlags()
                    }
                    assert.equal(starts, 1)
                    assert.equal(nested.length, 1)
                    assert.deepEqual(await Promise.all([completion, ...nested]), [
                        { status: 'loaded' },
                        { status: 'loaded' },
                    ])
                    assert.equal(starts, 1)
                    assert.equal(flagRequests - before, 1)
                } finally {
                    nestedSubscription.dispose()
                }
            }
        } finally {
            subscription?.dispose()
            await client.dispose()
        }
        assert.deepEqual(flags.getAllFeatureFlags(), [])
        assert.equal(flags.getFeatureFlag('test'), undefined)
        assert.deepEqual(await flags.reloadFeatureFlags(), { status: 'cancelled' })
        flags.onReloading(() => assert.fail('Disposed flags notified a listener')).dispose()
    }
}
process.stdout.write('Public CommonJS/ESM feature flag read controls passed\n')
