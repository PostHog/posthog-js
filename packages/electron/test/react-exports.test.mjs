import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)
const require = createRequire(new URL('package.json', root))

test('React is an optional peer and non-React process entries never load it', async () => {
    const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
    assert.equal(manifest.peerDependencies.react, '>=18.0.0')
    assert.equal(manifest.peerDependenciesMeta.react.optional, true)
    assert.equal(manifest.peerDependenciesMeta['@types/react'].optional, true)
    assert.equal(manifest.dependencies.react, undefined)
    for (const name of ['main', 'renderer', 'preload', 'preload-helper']) {
        const source = await readFile(new URL(`dist/${name}.cjs`, root), 'utf8')
        vm.runInNewContext(source, {
            exports: {},
            require: (id) => {
                assert.doesNotMatch(id, /react|posthog-js/, `${name} must not load React or the browser SDK`)
                if (id === 'electron') return { contextBridge: { exposeInMainWorld() {} }, ipcRenderer: {} }
                return require(id)
            },
        })
        assert.doesNotMatch(await readFile(new URL(`dist/${name}.d.ts`, root), 'utf8'), /from ["']react/)
        assert.doesNotMatch(await readFile(new URL(`dist/${name}.mjs`, root), 'utf8'), /from ["']react/)
    }
})

test('React subpath exposes hooks in ESM and CommonJS and server rendering does not expose flags', async () => {
    for (const bindings of [require('@posthog/electron/react'), await import('@posthog/electron/react')]) {
        const { createElement } = require('react')
        const { renderToString } = require('react-dom/server')
        const { PostHog } = require('@posthog/electron/renderer')
        const requests = []
        const client = new PostHog({
            subscribe: () => () => {},
            request: async (request) => {
                requests.push(request)
                return {
                    ok: true,
                    state: {
                        revision: 1,
                        generation: 0,
                        flagRevision: 1,
                        distinctId: 'alice',
                        anonymousId: 'anonymous',
                        sessionId: 'session',
                        optedOut: false,
                        flagsLoaded: true,
                        featureFlags: { experiment: 'test' },
                        featureFlagPayloads: {},
                    },
                }
            },
        })
        try {
            await client.ready()
            const Probe = () => {
                assert.equal(bindings.usePostHog(), client)
                assert.equal(bindings.useFeatureFlagEnabled('experiment'), true)
                assert.equal(bindings.useFeatureFlagVariantKey('experiment'), 'test')
                assert.equal(bindings.useFeatureFlagPayload('experiment'), null)
                return createElement('span', null, 'ready')
            }
            assert.equal(
                renderToString(createElement(bindings.PostHogProvider, { client }, createElement(Probe))),
                '<span>ready</span>'
            )
            await client.flush()
            assert.deepEqual(
                requests.map((request) => request.command.type),
                ['hello', 'flush']
            )
        } finally {
            client.dispose()
        }
    }
})

test('published React declarations accept the actual renderer class without duplicating private members', async () => {
    const directory = await mkdtemp(fileURLToPath(new URL('test/.react-types-', root)))
    try {
        await writeFile(
            join(directory, 'consumer.ts'),
            `
import { createElement } from 'react'
import { init, type PostHog } from '@posthog/electron/renderer'
import { PostHogProvider, usePostHog } from '@posthog/electron/react'
async function app() {
    const client = await init()
    return createElement(PostHogProvider, { client })
}
const client: PostHog = usePostHog()
void client
void app
// @ts-expect-error The provider cannot initialize an SDK from a renderer token.
createElement(PostHogProvider, { apiKey: 'secret' })
`
        )
        await writeFile(
            join(directory, 'tsconfig.json'),
            JSON.stringify({
                compilerOptions: {
                    strict: true,
                    noEmit: true,
                    target: 'ES2022',
                    module: 'ESNext',
                    moduleResolution: 'bundler',
                    types: [],
                    skipLibCheck: false,
                },
                include: ['consumer.ts'],
            })
        )
        const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
        execFileSync(process.execPath, [compiler, '--project', join(directory, 'tsconfig.json')], { stdio: 'pipe' })
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
