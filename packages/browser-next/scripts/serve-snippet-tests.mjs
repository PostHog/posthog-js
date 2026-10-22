import { readFileSync } from 'node:fs'
import { createMockServer } from '@posthog-tooling/sdk-mock-server'

const html = readFileSync(new URL('../playwright/snippet.html', import.meta.url), 'utf8')
const assetPrefix = '/nested/static/browser/0.0.3/'
const pageOrigin = 'http://127.0.0.1:2347'
const assetOrigin = 'http://127.0.0.1:2348'
const defaults = { disableBotDetection: 'true', capturePageview: 'false' }
const assets = createMockServer({
    port: 2348,
    barriers: ['chunks'],
    adapter: async (request, controls) => {
        if (!request.path.startsWith(assetPrefix)) return undefined
        const file = request.path.slice(assetPrefix.length)
        if (!/^(posthog\.js|chunks\/[\w.-]+\.js)$/.test(file)) return { status: 404 }
        if (file.startsWith('chunks/')) {
            await controls.waitForBarrier('chunks')
            if (controls.getState().failChunks) return { status: 503 }
        }
        return {
            body: readFileSync(new URL(`../dist-cdn/${file}`, import.meta.url)),
            headers: { 'Content-Type': 'text/javascript' },
        }
    },
})
const backend = createMockServer({
    port: 2347,
    barriers: ['config'],
    adapter: (request) => {
        if (request.path === '/' || request.path === '/favicon.ico') return { status: 204 }
        if (request.path !== '/nested/page') return undefined
        const options = JSON.parse(request.url.searchParams.get('options') ?? '{}')
        const src = new URL(`${assetOrigin}${assetPrefix}posthog.js`)
        src.search = new URLSearchParams(
            Object.entries({
                projectToken: 'phc_snippet_fixture',
                apiHost: pageOrigin,
                ...defaults,
                ...options,
            }).filter(([, value]) => value !== null)
        ).toString()
        src.hash = 'script-fragment'
        const mode = request.url.searchParams.get('mode')
        const attribute = mode === 'async' || mode === 'defer' ? mode : ''
        const copies = Number(request.url.searchParams.get('copies') ?? '1')
        const tags = Array.from(
            { length: copies },
            () => `<script ${attribute} src="${src.href.replaceAll('&', '&amp;')}"></script>`
        ).join('\n')
        const occupied =
            request.url.searchParams.get('occupied') === 'true'
                ? '<script>window.posthog = { legacy: true }</script>'
                : ''
        const nonceOnly = request.url.searchParams.get('csp') === 'true'
        const body = html.replace('<!-- snippet-tags -->', occupied + tags)
        return {
            body: nonceOnly ? body.replaceAll('<script', '<script nonce="snippet-fixture"') : body,
            headers: {
                'Content-Type': 'text/html',
                ...(nonceOnly
                    ? {
                          'Content-Security-Policy':
                              "default-src 'none'; script-src 'nonce-snippet-fixture'; connect-src 'self'",
                      }
                    : {}),
            },
        }
    },
})

await Promise.all([assets.start(), backend.start()])
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
        await Promise.all([assets.stop(), backend.stop()])
        process.exit(0)
    })
}
