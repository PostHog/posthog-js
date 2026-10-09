import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { build } from 'esbuild'

const env = { POSTHOG_PROJECT_API_KEY: 'phc_test', POSTHOG_HOST: 'https://posthog.example' }

for (const [directory, entry, eventName] of [
    ['example-cloudflare', 'src/index.ts', 'cloudflare_edge_request'],
    ['example-vercel-edge', 'api/hello.ts', 'vercel_edge_request'],
    ['example-nextjs-edge-middleware', 'middleware.ts', 'nextjs_edge_middleware_request'],
    ['example-nextjs-edge-route', 'app/api/hello/route.ts', 'nextjs_edge_route_request'],
]) {
    test(directory, async () => {
        const cwd = fileURLToPath(new URL(`./${directory}/`, import.meta.url))
        const result = await build({
            absWorkingDir: cwd,
            entryPoints: [entry],
            bundle: true,
            write: false,
            platform: 'browser',
            format: 'cjs',
            external: ['next/server'],
            define: {
                'process.env.POSTHOG_PROJECT_API_KEY': JSON.stringify(env.POSTHOG_PROJECT_API_KEY),
                'process.env.POSTHOG_HOST': JSON.stringify(env.POSTHOG_HOST),
                'process.env.NODE_ENV': '"production"',
            },
        })
        const pending = []
        const batches = []
        const errors = []
        const context = { waitUntil: (promise) => pending.push(promise) }
        const module = { exports: {} }
        runInNewContext(result.outputFiles[0].text, {
            module,
            exports: module.exports,
            require: createRequire(`${cwd}/package.json`),
            process: { env: {} },
            Blob,
            Request,
            Response,
            Headers,
            URL,
            URLSearchParams,
            TextEncoder,
            TextDecoder,
            AbortController,
            AbortSignal,
            crypto,
            setTimeout,
            clearTimeout,
            console: { ...console, error: (...args) => errors.push(args) },
            [Symbol.for('@vercel/request-context')]: { get: () => context },
            fetch: async (url, options) => {
                await new Promise((resolve) => setTimeout(resolve, 0))
                assert.equal(new URL(url).origin, env.POSTHOG_HOST)
                batches.push(JSON.parse(options.body))
                return new Response('{}', { status: 200 })
            },
        })
        const request = new Request('https://example.com/?private=not-captured')
        let response
        if (directory === 'example-cloudflare') {
            response = module.exports.default.fetch(
                request,
                {
                    POSTHOG_PROJECT_API_KEY: env.POSTHOG_PROJECT_API_KEY,
                    POSTHOG_API_HOST: env.POSTHOG_HOST,
                },
                context
            )
        } else if (directory === 'example-vercel-edge') {
            const { scripts } = createRequire(`${cwd}/package.json`)('./package.json')
            assert.equal(scripts.build, undefined, 'Vercel must not auto-detect its own CLI wrapper')
            assert.equal(scripts.dev, undefined, 'Vercel must not auto-detect its own CLI wrapper')
            response = module.exports.default(request)
        } else if (directory === 'example-nextjs-edge-route') {
            assert.equal(module.exports.runtime, 'edge')
            response = await module.exports.GET(request)
            assert.equal(batches.length, 1, 'flush must finish before the handler returns')
        } else {
            const { NextRequest } = createRequire(`${cwd}/package.json`)('next/server')
            response = module.exports.middleware(new NextRequest(request), context)
            assert.equal(response.headers.get('x-middleware-next'), '1')
        }
        assert.equal(response.status, 200)
        assert.equal(pending.length, directory === 'example-nextjs-edge-route' ? 0 : 1)
        await Promise.all(pending)
        assert.deepEqual(errors, [])
        assert.equal(batches.length, 1)
        assert.equal(batches[0].api_key, env.POSTHOG_PROJECT_API_KEY)
        const [event] = batches[0].batch
        assert.equal(event.event, eventName)
        assert.equal(event.distinct_id, 'example-user')
        assert.equal(event.properties.pathname, '/')
        assert.equal(event.properties.$lib, 'posthog-edge')
        assert.ok(!JSON.stringify(batches).includes('not-captured'))
    })
}
