/* global globalThis */
import { createRequire } from 'node:module'

const guardedGlobals = [
    'document',
    'fetch',
    'localStorage',
    'location',
    'navigator',
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
let analytics
try {
    const require = createRequire(import.meta.url)
    ;({ createPostHog } = require('@posthog/browser'))
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
const posthog = await createPostHog({
    projectToken: 'ph_test',
    storage: false,
    navigator: false,
    fetch: async (input, init) => {
        requests.push({ url: String(input), body: JSON.parse(init.body) })
        return new Response('{}', { status: 200 })
    },
})

await posthog.capture('mixed_module_event')
await posthog.installExtension(analytics())
await posthog.flush()
await posthog.dispose()

if (requests.length !== 1 || requests[0].body?.batch?.[0]?.event !== 'mixed_module_event') {
    throw new Error('Mixed CommonJS/ESM analytics delivery did not drain the queued event')
}
