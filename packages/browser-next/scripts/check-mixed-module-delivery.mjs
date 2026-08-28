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
try {
    const require = createRequire(import.meta.url)
    ;({ createPostHog } = require('@posthog/browser'))
    ;({ createPostHog: createCorePostHog } = require('@posthog/browser/core'))
    ;({ analytics } = await import('@posthog/browser/analytics'))
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
        requests.push({ url: String(input), body: JSON.parse(init.body) })
        return new Response('{}', { status: 200 })
    },
})

posthog.capture('mixed_module_event')
await posthog.flush()
await posthog.dispose()

if (requests.length !== 1 || requests[0].body?.batch?.[0]?.event !== 'mixed_module_event') {
    throw new Error('Mixed CommonJS/ESM analytics delivery did not drain the queued event')
}

const automaticRequests = []
const automatic = await createPostHog({
    projectToken: 'ph_test',
    capturePageview: false,
    storage: false,
    navigator: false,
    fetch: async (input, init) => {
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
if (coreRequests.length !== 0) {
    throw new Error('The CommonJS core entrypoint loaded analytics delivery')
}
