import process from 'node:process'
/* global globalThis */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const commonRequire = createRequire(new URL('../../browser-common/package.json', import.meta.url))
const { Features, transform } = commonRequire('lightningcss')
const expectedSurveyStyles = transform({
    filename: 'survey.css',
    code: readFileSync(new URL('../../browser-common/src/surveys/survey.css', import.meta.url)),
    minify: true,
    include: Features.Nesting | Features.MediaQueries,
}).code.toString()
for (const format of ['js', 'mjs']) {
    const { surveyStyles } = await import(
        new URL(`../../browser-common/dist/surveys/survey-styles.${format}`, import.meta.url)
    )
    assert.equal(
        surveyStyles,
        expectedSurveyStyles,
        `${format} survey CSS must preserve legacy compatibility transforms`
    )
}

const guardedGlobals = [
    'addEventListener',
    'crypto',
    'document',
    'fetch',
    'localStorage',
    'location',
    'navigator',
    'performance',
    'removeEventListener',
    'sessionStorage',
    'setInterval',
    'setTimeout',
    'window',
    'XMLHttpRequest',
]
const descriptors = new Map()
for (const name of guardedGlobals) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
    if (descriptor && !descriptor.configurable) {
        throw new Error(`Cannot guard non-configurable global ${name}`)
    }
    descriptors.set(name, descriptor)
    Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
            throw new Error(`Package import read browser global ${name}`)
        },
    })
}

let createPostHog
let createEsmPostHog
let createCorePostHog
let analytics
let flags
let logs
let commonJsLogs
let commonJsFlags
let FeatureFlagsCommonExtension
let surveys
let autocapture
let commonJsAutocapture
let commonJsSurveys
try {
    const require = createRequire(import.meta.url)
    ;({ FeatureFlagsCommonExtension } = await import('@posthog/browser-common/extension-tokens'))
    if (require('@posthog/browser-common/extension-tokens').FeatureFlagsCommonExtension !== FeatureFlagsCommonExtension)
        throw new Error('Common feature flags token differs between module formats')
    ;({ createPostHog } = require('@posthog/browser'))
    ;({ createPostHog: createCorePostHog } = require('@posthog/browser/core'))
    ;({ analytics } = await import('@posthog/browser/analytics'))
    ;({ createPostHog: createEsmPostHog } = await import('@posthog/browser'))
    await import('@posthog/browser/core')
    ;({ flags } = await import('@posthog/browser/flags'))
    ;({ flags: commonJsFlags } = require('@posthog/browser/flags'))
    ;({ logs } = await import('@posthog/browser/logs'))
    ;({ logs: commonJsLogs } = require('@posthog/browser/logs'))
    ;({ surveys } = await import('@posthog/browser/surveys'))
    ;({ surveys: commonJsSurveys } = require('@posthog/browser/surveys'))
    ;({ autocapture } = await import('@posthog/browser/autocapture'))
    ;({ autocapture: commonJsAutocapture } = require('@posthog/browser/autocapture'))
} finally {
    for (const [name, descriptor] of descriptors) {
        if (descriptor) {
            Object.defineProperty(globalThis, name, descriptor)
        } else {
            delete globalThis[name]
        }
    }
}

const requests = []
const posthog = await createCorePostHog({
    projectToken: 'ph_test',
    storage: false,
    navigator: false,
    extensions: [analytics()],
    fetch: async (input, init) => {
        if (init.method === 'GET') return new Response('{}')
        const body = JSON.parse(init.body)
        requests.push({ url: String(input), body })
        const uuid = body?.batch?.[0]?.uuid
        return new Response(JSON.stringify({ results: { [uuid]: { result: 'ok' } } }), { status: 200 })
    },
})

posthog.analytics.registerForSession({ mixed_session: true })
posthog.analytics.capture('mixed_module_event')
await posthog.flush()
const immediateSummary = await posthog.analytics.captureImmediate('mixed_module_immediate', undefined, {
    uuid: 'mixed-immediate-uuid',
})
await posthog.dispose()

if (
    requests.length !== 2 ||
    requests[0].body?.batch?.[0]?.event !== 'mixed_module_event' ||
    requests[1].body?.batch?.[0]?.event !== 'mixed_module_immediate' ||
    requests[0].body?.batch?.[0]?.properties.mixed_session !== true ||
    requests[1].body?.batch?.[0]?.properties.mixed_session !== true ||
    !immediateSummary.allPersisted
) {
    throw new Error('Mixed CommonJS/ESM analytics delivery did not support queued and immediate events')
}

const automaticRequests = []
const automatic = await createPostHog({
    projectToken: 'ph_test',
    flags: false,
    logs: false,
    surveys: false,
    autocapture: false,
    capturePageview: false,
    storage: false,
    navigator: false,
    fetch: async (input, init) => {
        if (init.method === 'GET') return new Response('{}')
        automaticRequests.push({ url: String(input), body: JSON.parse(init.body) })
        return new Response('{}', { status: 200 })
    },
})
const automaticAnalytics = await automatic.resolveExtension('analytics')
if (!automaticAnalytics || automaticAnalytics !== automatic.analytics) throw new Error('Analytics acquisition failed')
automaticAnalytics.capture('automatic_cjs_event')
await automatic.flush()
await automatic.dispose()

if (automaticRequests.length !== 1 || automaticRequests[0].body?.batch?.[0]?.event !== 'automatic_cjs_event') {
    throw new Error('The CommonJS root did not dynamically load automatic analytics')
}

const coreRequests = []
const core = await createCorePostHog({
    projectToken: 'ph_test',
    capturePageview: false,
    storage: false,
    navigator: false,
    fetch: async (...args) => {
        coreRequests.push(args)
        return new Response('{}', { status: 200 })
    },
})
if (core.analytics || (await core.resolveExtension('analytics'))) {
    throw new Error('The manual CommonJS host must not construct or acquire implicit analytics')
}
await core.flush()
await core.dispose()
if (
    coreRequests.length !== 1 ||
    String(coreRequests[0][0]) !== 'https://us-assets.i.posthog.com/array/ph_test/config?token=ph_test' ||
    coreRequests[0][1].method !== 'GET'
) {
    throw new Error('The CommonJS core entrypoint must load only remote configuration, not analytics delivery')
}

for (const createFlags of [flags, commonJsFlags]) {
    const client = await createCorePostHog({
        projectToken: 'ph_test',
        storage: false,
        navigator: false,
        fetch: false,
        capturePageview: false,
        extensions: [createFlags({ featureFlagEvaluation: false, bootstrap: { featureFlags: { mixed: 'variant' } } })],
    })
    if (client.featureFlags.getFeatureFlag('mixed')?.variant !== 'variant')
        throw new Error('Mixed-module flags bootstrap failed')
    let results
    const subscription = client.featureFlags.onFeatureFlags((values) => {
        results = values
    })
    client.featureFlags.updateFlags({ mixed: false })
    if (client.featureFlags.getFeatureFlag('mixed')?.enabled !== false || results?.[0]?.enabled !== false)
        throw new Error('Mixed-module flags update failed')
    if ((await client.featureFlags.reloadFeatureFlags()).status !== 'skipped')
        throw new Error('Mixed-module flags reload did not report disabled evaluation')
    subscription.dispose()
    await client.dispose()
}
process.stdout.write('Pure CommonJS/ESM flags entrypoints and mixed-module lifecycle passed\n')

for (const createLogs of [logs, commonJsLogs]) {
    const requests = []
    const logger = createLogs()
    const client = await createCorePostHog({
        projectToken: 'ph_test',
        storage: false,
        navigator: false,
        capturePageview: false,
        remoteConfig: {
            supportedCompression: [],
            toolbarParams: {},
            toolbarVersion: 'toolbar',
            isAuthenticated: false,
            siteApps: [],
        },
        extensions: [logger],
        fetch: async (url, init) => {
            requests.push({ url, body: JSON.parse(init.body) })
            return new Response('{}')
        },
    })
    logger.captureLog({ body: 'mixed logs' })
    await client.shutdown()
    if (
        requests.length !== 1 ||
        !String(requests[0].url).includes('/i/v1/logs?token=ph_test') ||
        requests[0].body.resourceLogs[0].scopeLogs[0].logRecords[0].body.stringValue !== 'mixed logs'
    ) {
        throw new Error('Mixed-module logs did not flush its OTLP record on shutdown')
    }
}
process.stdout.write('Pure CommonJS/ESM logs entrypoints and mixed-module logs lifecycle passed\n')

for (const create of [createPostHog, createEsmPostHog]) {
    let lookupShared
    let lookupFacade
    const client = await create({
        projectToken: 'ph_lookup',
        storage: false,
        navigator: false,
        fetch: false,
        analytics: false,
        logs: false,
        capturePageview: false,
        flags: { featureFlagEvaluation: false, bootstrap: { featureFlags: { lookup: 'shared' } } },
        extensions: [
            analytics(),
            {
                name: 'consumer',
                setup(value) {
                    lookupShared = () => value.sharedClient.getExtension(FeatureFlagsCommonExtension)
                    lookupFacade = () => value.featureFlags
                },
            },
        ],
    })
    const facade = client.featureFlags
    const shared = lookupShared()
    if (
        !shared ||
        shared === facade ||
        lookupFacade() !== facade ||
        'getExtension' in client ||
        facade.getFeatureFlag('lookup')?.variant !== 'shared' ||
        shared.getFeatureFlag('lookup') !== 'shared'
    )
        throw new Error('Dynamic flags did not resolve SDK and common tokens consistently')
    facade.updateFlags({ lookup: 'updated' })
    if (shared.getFeatureFlag('lookup') !== 'updated' || (await shared.reloadFeatureFlagsAsync()).status !== 'skipped')
        throw new Error('Dynamic flags shared lookup did not use the live implementation')
    client.analytics.reset()
    if (shared.getFeatureFlag('lookup') !== undefined) throw new Error('Dynamic flags shared state survived reset')
    await client.dispose()
    if (
        lookupShared() !== undefined ||
        lookupFacade() !== undefined ||
        'getExtension' in client ||
        client.featureFlags !== undefined
    )
        throw new Error('Dynamic flags lookup survived disposal')
}
process.stdout.write('Built CommonJS/ESM dynamic flags public/shared lookup, async reload, reset and disposal passed\n')

for (const create of [createPostHog, createEsmPostHog]) {
    const requests = []
    let scoped
    const client = await create({
        projectToken: 'ph_identity_helpers',
        storage: false,
        navigator: false,
        capturePageview: false,
        analytics: { flushInterval: 0 },
        flags: false,
        logs: false,
        surveys: false,
        autocapture: false,
        extensions: [
            {
                name: 'observer',
                setup(value) {
                    scoped = value
                },
            },
        ],
        remoteConfig: {
            supportedCompression: [],
            toolbarParams: {},
            toolbarVersion: 'toolbar',
            isAuthenticated: false,
            siteApps: [],
        },
        fetch: async (input, init) => {
            requests.push({ url: String(input), body: JSON.parse(init.body) })
            return new Response('{}')
        },
    })
    const product = await client.resolveExtension('analytics')
    assert.ok(product)
    assert.equal(product, client.analytics)
    assert.equal(product, scoped.analytics)
    const identity = { distinctId: client.distinctId, anonymousId: client.anonymousId, deviceId: client.deviceId }
    let groupResets = 0
    let scopedGroupResets = 0
    let fullResets = 0
    let identifies = 0
    client.onGroupsReset(() => {
        groupResets++
    })
    scoped.onGroupsReset(() => {
        scopedGroupResets++
    })
    client.onReset(() => {
        fullResets++
    })
    client.onIdentify(() => {
        identifies++
    })
    client.kv.set('retained', true)
    await product.group('organization', 'current')
    const { alias, groupIdentify, resetGroups } = product
    alias('account-123')
    groupIdentify('organization', 0, { plan: 'paid' }, { uuid: 'group-profile-uuid' })
    assert.deepEqual(client.groups, { organization: 'current' })
    assert.deepEqual(
        { distinctId: client.distinctId, anonymousId: client.anonymousId, deviceId: client.deviceId },
        identity
    )
    product.capture('before_group_reset')
    const session = client.session
    resetGroups()
    assert.deepEqual(client.groups, {})
    assert.deepEqual(client.session, session)
    assert.equal(client.kv.get('retained'), true)
    assert.equal(groupResets, 1)
    assert.equal(scopedGroupResets, 1)
    assert.equal(fullResets, 0)
    assert.equal(identifies, 0)
    product.capture('after_group_reset')
    await client.flush()
    const events = requests.flatMap(({ body }) => body.batch)
    assert.deepEqual(
        events.map(({ event }) => event),
        ['$groupidentify', '$create_alias', '$groupidentify', 'before_group_reset', 'after_group_reset']
    )
    assert.equal(events[1].distinct_id, identity.distinctId)
    assert.equal(events[1].properties.alias, 'account-123')
    assert.equal(events[1].options.process_person_profile, true)
    assert.equal(events[2].properties.$group_key, 0)
    assert.deepEqual(events[2].properties.$group_set, { plan: 'paid' })
    assert.equal(events[2].uuid, 'group-profile-uuid')
    assert.deepEqual(events[3].properties.$groups, { organization: 'current' })
    assert.deepEqual(events[4].properties.$groups, {})
    await client.dispose()
    resetGroups()
    alias('disposed')
    groupIdentify('organization', 'disposed')
    assert.equal(groupResets, 1)
    assert.equal(scopedGroupResets, 1)
}
process.stdout.write('Built CommonJS/ESM acquired analytics alias, group profile and group-only reset passed\n')

for (const create of [createPostHog, createEsmPostHog]) {
    const requests = []
    const values = new Map()
    const storage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
    }
    const options = {
        projectToken: 'ph_registered_properties',
        storage,
        navigator: false,
        capturePageview: false,
        analytics: { flushInterval: 0 },
        flags: false,
        logs: false,
        surveys: false,
        autocapture: false,
        remoteConfig: {
            supportedCompression: [],
            toolbarParams: {},
            toolbarVersion: 'toolbar',
            isAuthenticated: false,
            siteApps: [],
        },
        fetch: async (_input, init) => {
            const body = JSON.parse(init.body)
            requests.push(body)
            return new Response(
                JSON.stringify({
                    results: Object.fromEntries(body.batch.map(({ uuid }) => [uuid, { result: 'ok' }])),
                })
            )
        },
    }
    const client = await create(options)
    const product = await client.resolveExtension('analytics')
    assert.ok(product)
    const { register, registerOnce, unregister, getProperty } = product
    const copied = { register, registerOnce, unregister, getProperty }
    const nested = { count: 1 }
    register({ nested, plan: 'persistent', tier: 'persistent', initial: 'None', retained: false })
    registerOnce({ initial: 'first', retained: true })
    registerOnce({ initial: 'second' })
    copied.register(JSON.parse('{"__proto__":{"own":true},"constructor":"application","prototype":"own"}'))
    nested.count = 2
    const read = getProperty('nested')
    assert.deepEqual(read, { count: 1 })
    read.count = 3
    assert.deepEqual(copied.getProperty('nested'), { count: 1 })
    assert.equal(getProperty('initial'), 'first')
    assert.equal(getProperty('retained'), false)
    assert.deepEqual(getProperty('__proto__'), { own: true })
    assert.equal(getProperty('constructor'), 'application')
    assert.equal(getProperty('prototype'), 'own')
    assert.equal(client.session, undefined)
    assert.equal(requests.length, 0)
    const dynamic = product.registerDynamicEventProperties(() => ({ plan: 'dynamic', tier: 'dynamic' }))
    let serialized = 0
    product.capture(
        'registered_queued',
        {
            plan: 'caller',
            token: 'wrong',
            $device_id: 'wrong',
            $process_person_profile: true,
            converted: {
                toJSON() {
                    serialized++
                    return { count: 1 }
                },
            },
        },
        { uuid: 'registered-queued', set: { plan: 'person' } }
    )
    register({ nested: { count: 9 }, plan: 'later' })
    copied.unregister('initial')
    const immediate = await product.captureImmediate(
        'registered_immediate',
        { plan: 'immediate' },
        { uuid: 'registered-immediate' }
    )
    assert.equal(immediate.allPersisted, true)
    await client.flush()
    const events = requests.flatMap(({ batch }) => batch)
    const queued = events.find(({ event }) => event === 'registered_queued')
    const inline = events.find(({ event }) => event === 'registered_immediate')
    assert.ok(queued)
    assert.ok(inline)
    assert.equal(serialized, 1)
    assert.equal(queued.properties.plan, 'caller')
    assert.equal(queued.properties.tier, 'dynamic')
    assert.deepEqual(queued.properties.nested, { count: 1 })
    assert.deepEqual(queued.properties.converted, { count: 1 })
    assert.deepEqual(queued.properties.$set, { plan: 'person' })
    assert.equal(queued.properties.$device_id, client.deviceId)
    assert.equal(queued.options.process_person_profile, false)
    assert.deepEqual(queued.properties['__proto__'], { own: true })
    assert.equal(inline.properties.plan, 'immediate')
    assert.deepEqual(inline.properties.nested, { count: 9 })
    assert.equal(Object.hasOwn(inline.properties, 'initial'), false)
    product.resetGroups()
    assert.deepEqual(getProperty('nested'), { count: 9 })
    dynamic.dispose()
    await client.dispose()
    copied.register({ late: true })
    copied.registerOnce({ late: true })
    copied.unregister('nested')
    assert.equal(getProperty('late'), undefined)
    const fresh = await create(options)
    const restored = await fresh.resolveExtension('analytics')
    assert.ok(restored)
    assert.deepEqual(restored.getProperty('nested'), { count: 9 })
    assert.equal(restored.getProperty('late'), undefined)
    restored.reset()
    assert.equal(restored.getProperty('nested'), undefined)
    await fresh.dispose()
}
process.stdout.write(
    'Built CommonJS/ESM acquired persistent analytics properties, snapshots, precedence and reset passed\n'
)

for (const create of [createPostHog, createEsmPostHog]) {
    const requests = []
    const values = new Map()
    const storage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
    }
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
    const localDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    const localValues = new Map()
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage })
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key) => localValues.get(key) ?? null,
            setItem: (key, value) => localValues.set(key, value),
            removeItem: (key) => localValues.delete(key),
        },
    })
    const options = {
        projectToken: 'ph_session_properties',
        navigator: false,
        capturePageview: false,
        analytics: { flushInterval: 0 },
        flags: false,
        logs: false,
        surveys: false,
        autocapture: false,
        remoteConfig: {
            supportedCompression: [],
            toolbarParams: {},
            toolbarVersion: 'toolbar',
            isAuthenticated: false,
            siteApps: [],
        },
        fetch: async (_input, init) => {
            const body = JSON.parse(init.body)
            requests.push(body)
            return new Response(
                JSON.stringify({
                    results: Object.fromEntries(body.batch.map(({ uuid }) => [uuid, { result: 'ok' }])),
                })
            )
        },
    }
    try {
        const client = await create(options)
        const product = await client.resolveExtension('analytics')
        assert.ok(product)
        const { registerForSession, unregisterForSession } = product
        const copied = { registerForSession, unregisterForSession }
        const input = { count: 1 }
        product.register({ precedence: 'persistent', fallback: true })
        registerForSession({ input, precedence: 'session', removed: true, nullable: null })
        input.count = 2
        assert.equal(client.session, undefined)
        copied.unregisterForSession('removed')
        product.capture('session_queued')
        const summary = await product.captureImmediate('session_immediate', { precedence: 'caller' })
        assert.equal(summary.allPersisted, true)
        await client.flush()
        const events = requests.flatMap(({ batch }) => batch)
        const queued = events.find(({ event }) => event === 'session_queued')
        const inline = events.find(({ event }) => event === 'session_immediate')
        assert.ok(queued)
        assert.ok(inline)
        assert.equal(queued.properties.precedence, 'session')
        assert.equal(queued.properties.fallback, true)
        assert.deepEqual(queued.properties.input, { count: 1 })
        assert.equal(Object.hasOwn(queued.properties, 'removed'), false)
        assert.equal(Object.hasOwn(queued.properties, 'nullable'), false)
        assert.equal(inline.properties.precedence, 'caller')
        product.resetGroups()
        product.capture('after_group_reset')
        await client.flush()
        const groupReset = requests.flatMap(({ batch }) => batch).find(({ event }) => event === 'after_group_reset')
        assert.ok(groupReset)
        assert.deepEqual(groupReset.properties.input, { count: 1 })
        product.reset()
        product.capture('after_full_reset')
        await client.flush()
        const fullReset = requests.flatMap(({ batch }) => batch).find(({ event }) => event === 'after_full_reset')
        assert.ok(fullReset)
        assert.equal(Object.hasOwn(fullReset.properties, 'input'), false)
        copied.registerForSession({ reload: true })
        await client.dispose()
        copied.registerForSession({ late: true })
        const fresh = await create(options)
        const restored = await fresh.resolveExtension('analytics')
        assert.ok(restored)
        restored.capture('session_reloaded')
        await fresh.flush()
        const reloaded = requests.flatMap(({ batch }) => batch).find(({ event }) => event === 'session_reloaded')
        assert.ok(reloaded)
        assert.equal(reloaded.properties.reload, true)
        assert.equal(Object.hasOwn(reloaded.properties, 'late'), false)
        await fresh.dispose()
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor)
        else delete globalThis.sessionStorage
        if (localDescriptor) Object.defineProperty(globalThis, 'localStorage', localDescriptor)
        else delete globalThis.localStorage
    }
}
process.stdout.write('Built CommonJS/ESM acquired session properties, snapshots, precedence and reset passed\n')

for (const factory of [surveys, commonJsSurveys]) {
    const client = await createCorePostHog({
        projectToken: 'ph_surveys_test',
        storage: false,
        navigator: false,
        fetch: false,
        capturePageview: false,
        extensions: [factory({ automaticDisplay: false })],
    })
    const extension = client.surveys
    const result = await new Promise((resolve) => extension.getSurveys(resolve))
    if (result.length !== 0 || (await extension.canRenderSurvey('missing')).visible) {
        throw new Error('Mixed-module surveys must return unavailable results without a document')
    }
    await client.dispose()
}
process.stdout.write('Pure CommonJS/ESM surveys entrypoints and SSR lifecycle passed\n')

for (const factory of [autocapture, commonJsAutocapture]) {
    const extension = factory()
    const client = await createCorePostHog({
        projectToken: 'ph_test',
        storage: false,
        navigator: false,
        fetch: false,
        capturePageview: false,
        extensions: [extension],
    })
    assert.equal(client.autocapture, extension)
    await client.dispose()
}
process.stdout.write('Pure CommonJS/ESM autocapture entrypoints and SSR lifecycle passed\n')
