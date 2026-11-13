import assert from 'node:assert/strict'
import process from 'node:process'
import { createRequire } from 'node:module'
import { createPostHog as createEsmRoot } from '@posthog/browser'
import { createPostHog as createEsmCore } from '@posthog/browser/core'
import { featureFlags as esmFlags } from '@posthog/browser/flags'
import { analytics } from '@posthog/browser/analytics'

const require = createRequire(import.meta.url)
const { createPostHog: createCjsRoot } = require('@posthog/browser')
const { createPostHog: createCjsCore } = require('@posthog/browser/core')
const { featureFlags: cjsFlags } = require('@posthog/browser/flags')
const feature = {
    name: 'Preview',
    description: 'Preview feature',
    stage: 'beta',
    documentationUrl: null,
    payload: { preview: true },
    flagKey: 'preview',
}

for (const [create, factory] of [
    [createEsmRoot, undefined],
    [createCjsRoot, undefined],
    [createEsmCore, cjsFlags],
    [createCjsCore, esmFlags],
]) {
    const listings = []
    const events = []
    const client = await create({
        projectToken: 'ph_early_access_built',
        apiHost: 'https://example.com',
        navigator: false,
        storage: false,
        capturePageview: false,
        flags: { featureFlagEvaluation: false },
        analytics: { flushInterval: 0 },
        logs: false,
        surveys: false,
        autocapture: false,
        extensions: [analytics({ flushInterval: 0 }), ...(factory ? [factory({ featureFlagEvaluation: false })] : [])],
        remoteConfig: {
            supportedCompression: [],
            toolbarParams: {},
            toolbarVersion: 'toolbar',
            isAuthenticated: false,
            siteApps: [],
        },
        fetch: async (input, init) => {
            const url = new URL(String(input))
            if (url.pathname === '/api/early_access_features/') {
                listings.push(url)
                return new Response(JSON.stringify({ earlyAccessFeatures: [feature] }))
            }
            assert.equal(url.pathname, '/i/v1/analytics/events')
            const body = JSON.parse(init.body)
            events.push(...body.batch)
            return new Response(
                JSON.stringify({ results: Object.fromEntries(body.batch.map(({ uuid }) => [uuid, { result: 'ok' }])) })
            )
        },
    })
    try {
        const flags = client.featureFlags
        assert.ok(flags)
        const list = (forceReload, stages) =>
            new Promise((resolve) => flags.getEarlyAccessFeatures(resolve, forceReload, stages))
        assert.deepEqual(await list(false, ['beta']), [feature])
        assert.equal(listings.length, 1)
        assert.deepEqual(listings[0].searchParams.getAll('stage'), ['beta'])
        assert.deepEqual(await list(false, ['alpha']), [feature])
        assert.equal(listings.length, 1)
        assert.deepEqual(await list(true, ['beta', 'general-availability']), [feature])
        assert.equal(listings.length, 2)
        assert.deepEqual(listings[1].searchParams.getAll('stage'), ['beta', 'general-availability'])
        const identity = [client.distinctId, client.deviceId, client.groups]
        flags.updateEarlyAccessFeatureEnrollment('preview', true, 'beta')
        await client.flush()
        const enrollment = events.filter(({ event }) => event === '$feature_enrollment_update')
        assert.equal(enrollment.length, 1)
        assert.equal(enrollment[0].properties.$feature_flag, 'preview')
        assert.equal(enrollment[0].properties.$feature_enrollment, true)
        assert.equal(enrollment[0].properties.$feature_enrollment_stage, 'beta')
        assert.equal(enrollment[0].properties.$early_access_feature_name, 'Preview')
        assert.deepEqual(enrollment[0].properties.$set, { '$feature_enrollment/preview': true })
        assert.deepEqual([client.distinctId, client.deviceId, client.groups], identity)
        client.optOut()
        flags.updateEarlyAccessFeatureEnrollment('preview', false)
        assert.equal(flags.getFeatureFlag('preview').enabled, false)
        await client.flush()
        assert.equal(events.filter(({ event }) => event === '$feature_enrollment_update').length, 1)
        await client.dispose()
        let called = false
        flags.getEarlyAccessFeatures(() => (called = true))
        flags.updateEarlyAccessFeatureEnrollment('preview', true)
        assert.equal(called, false)
        assert.equal(listings.length, 2)
    } finally {
        await client.dispose()
    }
}
process.stdout.write(
    'Built root/manual CommonJS/ESM early-access listing, enrollment wire payload, consent and disposal passed\n'
)
