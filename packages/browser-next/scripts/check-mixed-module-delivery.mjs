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

posthog.capture('mixed_module_event')
await posthog.flush()
const immediateSummary = await posthog.captureImmediate('mixed_module_immediate', undefined, {
    uuid: 'mixed-immediate-uuid',
})
await posthog.dispose()

if (
    requests.length !== 2 ||
    requests[0].body?.batch?.[0]?.event !== 'mixed_module_event' ||
    requests[1].body?.batch?.[0]?.event !== 'mixed_module_immediate' ||
    !immediateSummary.allPersisted
) {
    throw new Error('Mixed CommonJS/ESM analytics delivery did not support queued and immediate events')
}

const automaticRequests = []
const automatic = await createPostHog({
    projectToken: 'ph_test',
    capturePageview: false,
    storage: false,
    navigator: false,
    fetch: async (input, init) => {
        if (init.method === 'GET') return new Response('{}')
        automaticRequests.push({ url: String(input), body: JSON.parse(init.body) })
        return new Response('{}', { status: 200 })
    },
})
automatic.capture('automatic_cjs_event')
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
core.capture('core_buffered_event')
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
    if (client.getExtension('featureFlags').getFeatureFlag('mixed')?.variant !== 'variant')
        throw new Error('Mixed-module flags bootstrap failed')
    let results
    const subscription = client.getExtension('featureFlags').onFeatureFlags((values) => {
        results = values
    })
    client.getExtension('featureFlags').updateFlags({ mixed: false })
    if (
        client.getExtension('featureFlags').getFeatureFlag('mixed')?.enabled !== false ||
        results?.[0]?.enabled !== false
    )
        throw new Error('Mixed-module flags update failed')
    if ((await client.getExtension('featureFlags').reloadFeatureFlags()).status !== 'skipped')
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
            {
                name: 'consumer',
                setup(value) {
                    lookupShared = () => value.getExtension(FeatureFlagsCommonExtension)
                    lookupFacade = () => value.getExtension('featureFlags')
                },
            },
        ],
    })
    const facade = client.getExtension('featureFlags')
    const shared = lookupShared()
    if (
        !shared ||
        shared === facade ||
        lookupFacade() !== facade ||
        client.getExtension(FeatureFlagsCommonExtension) !== shared ||
        facade.getFeatureFlag('lookup')?.variant !== 'shared' ||
        shared.getFeatureFlag('lookup') !== 'shared'
    )
        throw new Error('Dynamic flags did not resolve SDK and common tokens consistently')
    facade.updateFlags({ lookup: 'updated' })
    if (shared.getFeatureFlag('lookup') !== 'updated' || (await shared.reloadFeatureFlagsAsync()).status !== 'skipped')
        throw new Error('Dynamic flags shared lookup did not use the live implementation')
    client.reset()
    if (shared.getFeatureFlag('lookup') !== undefined) throw new Error('Dynamic flags shared state survived reset')
    await client.dispose()
    if (
        lookupShared() !== undefined ||
        lookupFacade() !== undefined ||
        client.getExtension(FeatureFlagsCommonExtension) !== undefined ||
        client.getExtension('featureFlags') !== undefined
    )
        throw new Error('Dynamic flags lookup survived disposal')
}
process.stdout.write('Built CommonJS/ESM dynamic flags public/shared lookup, async reload, reset and disposal passed\n')

for (const factory of [surveys, commonJsSurveys]) {
    const client = await createCorePostHog({
        projectToken: 'ph_surveys_test',
        storage: false,
        navigator: false,
        fetch: false,
        capturePageview: false,
        extensions: [factory({ automaticDisplay: false })],
    })
    const extension = client.getExtension('surveys')
    const result = await new Promise((resolve) => extension.getSurveys(resolve))
    if (result.length !== 0 || (await extension.canRenderSurvey('missing')).visible) {
        throw new Error('Mixed-module surveys must return unavailable results without a document')
    }
    await client.dispose()
}
process.stdout.write('Pure CommonJS/ESM surveys entrypoints and SSR lifecycle passed\n')
