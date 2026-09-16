import process from 'node:process'
/* global globalThis */
import { createRequire } from 'node:module'

const guardedGlobals = [
    'addEventListener',
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
let createCorePostHog
let analytics
let flags
let commonJsFlags
try {
    const require = createRequire(import.meta.url)
    ;({ createPostHog } = require('@posthog/browser'))
    ;({ createPostHog: createCorePostHog } = require('@posthog/browser/core'))
    ;({ analytics } = await import('@posthog/browser/analytics'))
    await import('@posthog/browser')
    await import('@posthog/browser/core')
    ;({ flags } = await import('@posthog/browser/flags'))
    ;({ flags: commonJsFlags } = require('@posthog/browser/flags'))
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
    String(coreRequests[0][0]) !== 'https://us.i.posthog.com/array/ph_test/config?token=ph_test' ||
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
    if (client.getFeatureFlag('mixed')?.variant !== 'variant') throw new Error('Mixed-module flags bootstrap failed')
    let results
    const subscription = client.onFeatureFlags((values) => {
        results = values
    })
    client.updateFlags({ mixed: false })
    if (client.getFeatureFlag('mixed')?.enabled !== false || results?.[0]?.enabled !== false)
        throw new Error('Mixed-module flags update failed')
    subscription.dispose()
    await client.dispose()
}
process.stdout.write('Pure CommonJS/ESM flags entrypoints and mixed-module lifecycle passed\n')
