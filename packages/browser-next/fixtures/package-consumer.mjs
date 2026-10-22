import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import process from 'node:process'
/* global globalThis */

const format = process.argv[2]
assert.ok(format === 'esm' || format === 'cjs')
const require = createRequire(import.meta.url)
const load = format === 'esm' ? (name) => import(name) : (name) => require(name)
const entrypoints = [
    '@posthog/browser',
    ...['core', 'analytics', 'flags', 'logs', 'surveys', 'autocapture'].map((name) => `@posthog/browser/${name}`),
]
const modules = new Map()
const descriptors = new Map()
for (const name of [
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
]) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
            throw new Error(`Package import read browser global ${name}`)
        },
    })
}
try {
    for (const name of entrypoints) modules.set(name, await load(name))
} finally {
    for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else delete globalThis[name]
    }
}

const origin = process.env.MOCK_ORIGIN
assert.ok(origin && new URL(origin).hostname === '127.0.0.1')
for (const entry of ['root', 'core']) {
    const { createPostHog } = modules.get(entry === 'root' ? '@posthog/browser' : '@posthog/browser/core')
    // Cross-format composition catches token/extension identity differences hidden by workspace imports.
    const { analytics } =
        format === 'esm' ? require('@posthog/browser/analytics') : await import('@posthog/browser/analytics')
    const client = await createPostHog({
        projectToken: 'phc_package_consumer',
        apiHost: origin,
        storage: false,
        navigator: false,
        capturePageview: false,
        ...(entry === 'core' ? { extensions: [analytics({ flushInterval: 0 })] } : {}),
        fetch: (input, init) => {
            assert.equal(new URL(input).origin, origin, 'Installed consumer must not send external requests')
            return globalThis.fetch(input, init)
        },
    })
    try {
        const name = `packaged_${format}_${entry}`
        client.capture(`${name}_queued`, { distribution: 'npm' })
        await client.flush()
        const summary = await client.captureImmediate(`${name}_immediate`, { distribution: 'npm' })
        assert.equal(summary.submitted, 1)
        assert.equal(summary.allPersisted, true)
        assert.equal(summary.error, undefined)
    } finally {
        await client.shutdown()
    }
}
process.stdout.write(`Installed ${format} entrypoints: pure imports and root/core Capture V1 delivery passed\n`)
