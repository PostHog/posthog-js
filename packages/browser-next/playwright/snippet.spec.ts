import { expect, test } from '@playwright/test'
import { stdout } from 'node:process'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import type { Inspection } from '@posthog-tooling/sdk-mock-server'
import type { IPostHog } from '../src/core/types'

declare global {
    interface Window {
        posthog?: unknown
        snippetEvidence: { readyCount: number; detailMatchesGlobal: boolean; flushed: boolean }
    }
}

const assetPrefix = '/nested/static/browser/0.0.3/'
const pageOrigin = 'http://127.0.0.1:2347'
const assetOrigin = 'http://127.0.0.1:2348'
const server = (origin: string) => ({
    inspect: async (): Promise<Inspection> => (await fetch(`${origin}/__captured/all`)).json(),
    reset: async () => {
        await fetch(`${origin}/__control/reset`, { method: 'POST' })
    },
    releaseBarrier: async (name: string) => {
        await fetch(`${origin}/__control/release`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ barriers: [name] }),
        })
    },
    failChunks: async (value: boolean) => {
        await fetch(`${origin}/__control/state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ failChunks: value }),
        })
    },
})
const backend = server(pageOrigin)
const assets = server(assetOrigin)
const assetRequests = async () => (await assets.inspect()).requests.filter((request) => request.path.endsWith('.js'))
const location = (options: Record<string, string | null> = {}, mode = 'async', copies = 1, occupied = false) =>
    `${pageOrigin}/nested/page?${new URLSearchParams({ options: JSON.stringify(options), mode, copies: String(copies), occupied: String(occupied) })}`

test.beforeEach(async ({ context }) => {
    await Promise.all([backend.reset(), assets.reset()])
    await Promise.all([backend.releaseBarrier('config'), assets.releaseBarrier('chunks')])
    // Local-only network boundary; no request is fulfilled with SDK code or delivery by Playwright.
    await context.route('**/*', (route) => {
        const origin = new URL(route.request().url()).origin
        return origin === pageOrigin || origin === assetOrigin ? route.continue() : route.abort()
    })
})

test.afterEach(async ({ page }) => {
    await page.evaluate(() => (window.posthog as IPostHog | undefined)?.shutdown?.(0)).catch(() => {})
})

for (const mode of ['sync', 'async', 'defer']) {
    test(`${mode} classic tag exposes early ready detail and late global, with native cross-origin chunks and Capture V1`, async ({
        page,
    }) => {
        await backend.reset()
        await page.goto(location({}, mode))
        await expect
            .poll(() => page.evaluate(() => window.snippetEvidence))
            .toMatchObject({ readyCount: 1, detailMatchesGlobal: true, flushed: true })
        expect(await page.evaluate(() => typeof (window.posthog as IPostHog | undefined)?.analytics?.capture)).toBe(
            'function'
        )
        const captures = (await backend.inspect()).requests.filter(
            (request) => request.path === '/i/v1/analytics/events'
        )
        expect(captures).toHaveLength(1)
        expect(captures[0]?.headers['authorization']).toBe('Bearer phc_snippet_fixture')
        expect(captures[0]?.body).toMatchObject({
            batch: [{ event: 'snippet_early', properties: { placement: 'plain-html' } }],
        })
        expect((await backend.inspect()).requests.some((request) => request.path === '/e/')).toBe(false)
        const chunks = (await assetRequests()).filter((request) => request.path !== `${assetPrefix}script.js`)
        expect(chunks.length).toBeGreaterThan(0)
        for (const request of chunks) {
            expect(request.path.startsWith(`${assetPrefix}chunks/`)).toBe(true)
            expect(request.query).toEqual({})
        }
        expect((await backend.inspect()).requests.some((request) => request.path.endsWith('.js'))).toBe(false)
    })
}

test('a nonce-only CSP permits deferred chunks and real Capture V1 delivery', async ({ page }) => {
    await page.goto(`${location()}&csp=true`)
    await expect.poll(() => page.evaluate(() => window.snippetEvidence)).toMatchObject({ readyCount: 1, flushed: true })
    expect((await backend.inspect()).events).toEqual([expect.objectContaining({ event: 'snippet_early' })])
    expect((await assetRequests()).some((request) => request.path.includes('/chunks/'))).toBe(true)
})

test('embedded analytics delivers queued and immediate events without optional chunk requests', async ({ page }) => {
    await page.goto(location({ flags: 'false', logs: 'false', surveys: 'false', autocapture: 'false' }))
    await expect.poll(() => page.evaluate(() => window.snippetEvidence)).toMatchObject({ readyCount: 1, flushed: true })
    expect((await backend.inspect()).events).toEqual([expect.objectContaining({ event: 'snippet_early' })])
    const summary = await page.evaluate(() => {
        const product = (window.posthog as IPostHog).analytics
        if (!product) throw new Error('Expected embedded analytics')
        return product.captureImmediate('inline_script')
    })
    expect(summary).toMatchObject({ submitted: 1, allPersisted: true })
    expect((await backend.inspect()).events.map((event) => (event as { event: string }).event)).toEqual([
        'snippet_early',
        'inline_script',
    ])
    expect((await assetRequests()).map((request) => request.path)).toEqual([`${assetPrefix}script.js`])
})

test('core is embedded in the first response; disabled products do not request chunks before capture', async ({
    page,
}) => {
    await page.goto(
        location({ flags: 'false', logs: 'false', surveys: 'false', autocapture: 'false', optOutByDefault: 'true' })
    )
    await expect.poll(() => page.evaluate(() => window.snippetEvidence.readyCount)).toBe(1)
    expect((await assetRequests()).map((request) => request.path)).toEqual([`${assetPrefix}script.js`])
    expect((await backend.inspect()).events).toHaveLength(0)
    const summary = await page.evaluate(async () => {
        ;(window.posthog as IPostHog).optIn()
        const product = (window.posthog as IPostHog).analytics
        if (!product) throw new Error('Expected embedded analytics')
        return product.captureImmediate('after_opt_in')
    })
    expect(summary).toMatchObject({ submitted: 1, allPersisted: true })
    expect((await backend.inspect()).events).toEqual([expect.objectContaining({ event: 'after_opt_in' })])
    expect((await assetRequests()).map((request) => request.path)).toEqual([`${assetPrefix}script.js`])
})

for (const [profile, options] of Object.entries({
    default: {},
    disabled: { flags: 'false', logs: 'false', surveys: 'false', autocapture: 'false' },
    denied: { optOutByDefault: 'true' },
})) {
    test(`records actual startup script bytes for ${profile}`, async ({ page }) => {
        const scripts: Array<Promise<{ path: string; minified: number; gzip: number; brotli: number }>> = []
        page.on('response', (response) => {
            const url = new URL(response.url())
            if (url.origin !== assetOrigin || !url.pathname.endsWith('.js') || response.status() !== 200) return
            scripts.push(
                response.body().then((body) => ({
                    path: url.pathname,
                    minified: body.length,
                    gzip: gzipSync(body, { level: 9 }).length,
                    brotli: brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
                }))
            )
        })
        await page.goto(location(options))
        await expect
            .poll(() => page.evaluate(() => window.snippetEvidence))
            .toMatchObject({ readyCount: 1, flushed: true })
        await page.waitForLoadState('networkidle')
        const loaded = await Promise.all(scripts)
        expect(loaded.filter(({ path }) => path === `${assetPrefix}script.js`)).toHaveLength(1)
        if (profile === 'disabled') expect(loaded).toHaveLength(1)
        if (profile === 'denied') expect((await backend.inspect()).events).toHaveLength(0)
        const sum = (files: typeof loaded) =>
            files.reduce(
                (total, file) => ({
                    minified: total.minified + file.minified,
                    gzip: total.gzip + file.gzip,
                    brotli: total.brotli + file.brotli,
                }),
                { minified: 0, gzip: 0, brotli: 0 }
            )
        stdout.write(
            `CDN startup ${test.info().project.name}/${profile}: ${JSON.stringify({
                initial: sum(loaded.filter(({ path }) => path === `${assetPrefix}script.js`)),
                deferred: sum(loaded.filter(({ path }) => path !== `${assetPrefix}script.js`)),
                total: sum(loaded),
                files: loaded,
            })}\n`
        )
    })
}

test('persisted denial gates pageview and early capture while initialization remains ready', async ({
    page,
    context,
}) => {
    await context.addInitScript(() => {
        localStorage.setItem('__ph_opt_in_out_phc_snippet_fixture', '0')
    })
    await page.goto(location({ capturePageview: 'true' }))
    await expect.poll(() => page.evaluate(() => window.snippetEvidence)).toMatchObject({ readyCount: 1, flushed: true })
    expect((await backend.inspect()).events).toHaveLength(0)
    expect((await assetRequests()).some((request) => request.path.includes('/chunks/'))).toBe(true)
    await page.evaluate(async () => {
        const client = window.posthog as IPostHog
        client.optIn()
        const product = client.analytics
        if (!product) throw new Error('Expected embedded analytics')
        product.capture('after_persisted_denial')
        await client.flush()
    })
    expect((await backend.inspect()).events.map((event) => (event as { event: string }).event)).toEqual([
        '$pageview',
        'after_persisted_denial',
    ])
})

test('concurrent duplicate tags initialize one client and dispatch ready once', async ({ page }) => {
    await assets.reset()
    await page.goto(location({}, 'async', 2), { waitUntil: 'domcontentloaded' })
    await expect.poll(async () => (await assets.inspect()).blockedRequests.length).toBeGreaterThan(0)
    await assets.releaseBarrier('chunks')
    await expect.poll(() => page.evaluate(() => window.snippetEvidence.readyCount)).toBe(1)
    await expect.poll(() => page.evaluate(() => window.snippetEvidence.flushed)).toBe(true)
    expect((await backend.inspect()).requests.filter((request) => request.path.includes('/config'))).toHaveLength(1)
    expect(
        (await backend.inspect()).events.filter((event) => (event as { event?: string }).event === 'snippet_early')
    ).toHaveLength(1)
})

test('an occupied legacy global is never overwritten or initialized alongside', async ({ page }) => {
    await page.goto(location({}, 'sync', 1, true))
    expect(await page.evaluate(() => window.posthog)).toEqual({ legacy: true })
    expect(await page.evaluate(() => window.snippetEvidence.readyCount)).toBe(0)
    expect(await assetRequests()).toHaveLength(1)
    expect((await backend.inspect()).events).toHaveLength(0)
    expect((await backend.inspect()).config_calls).toHaveLength(0)
})

test('a global claimed during initialization wins and no ready event is dispatched', async ({ page }) => {
    await assets.reset()
    await page.goto(location(), { waitUntil: 'domcontentloaded' })
    await expect.poll(async () => (await assets.inspect()).blockedRequests.length).toBeGreaterThan(0)
    await page.evaluate(() => {
        window.posthog = { legacy: true } as unknown as IPostHog
    })
    await assets.releaseBarrier('chunks')
    await page.waitForLoadState('load')
    expect(await page.evaluate(() => window.posthog)).toEqual({ legacy: true })
    expect(await page.evaluate(() => window.snippetEvidence.readyCount)).toBe(0)
})

for (const options of [
    { projectToken: null },
    { projectToken: '' },
    { apiHost: 'javascript:invalid' },
    { capturePageview: 'invalid' },
]) {
    test(`invalid configuration ${Object.keys(options)[0]}${Object.values(options)[0] === null ? ' (missing)' : ''} is contained without leaking query values`, async ({
        page,
    }) => {
        const messages: string[] = []
        const errors: string[] = []
        page.on('console', (message) => {
            if (message.type() === 'error') messages.push(message.text())
        })
        page.on('pageerror', (error) => errors.push(error.message))
        await page.goto(location(options, 'sync'))
        expect(await page.evaluate(() => window.posthog)).toBeUndefined()
        expect(await page.evaluate(() => window.snippetEvidence.readyCount)).toBe(0)
        expect((await backend.inspect()).requests.filter((request) => request.path !== '/nested/page')).toHaveLength(0)
        expect(await assetRequests()).toHaveLength(1)
        expect(messages).toContain('PostHog script initialization failed')
        expect(messages.join()).not.toContain('phc_snippet_fixture')
        expect(errors).toEqual([])
    })
}

test('failed optional chunks leave embedded analytics usable and optional acquisition can retry', async ({ page }) => {
    await assets.failChunks(true)
    await page.goto(location())
    await expect.poll(() => page.evaluate(() => window.snippetEvidence)).toMatchObject({ readyCount: 1, flushed: true })
    expect(await page.evaluate(() => (window.posthog as IPostHog).featureFlags)).toBeUndefined()
    expect((await backend.inspect()).events).toEqual([expect.objectContaining({ event: 'snippet_early' })])
    const summary = await page.evaluate(() => {
        const product = (window.posthog as IPostHog).analytics
        if (!product) throw new Error('Expected embedded analytics')
        return product.captureImmediate('optional_failure')
    })
    expect(summary).toMatchObject({ submitted: 1, allPersisted: true })
    await assets.failChunks(false)
    expect(
        await page.evaluate(async () => {
            const client = window.posthog as IPostHog
            return Boolean(await client.resolveExtension('featureFlags')) && client.featureFlags !== undefined
        })
    ).toBe(true)
    expect((await backend.inspect()).events).toEqual([
        expect.objectContaining({ event: 'snippet_early' }),
        expect.objectContaining({ event: 'optional_failure' }),
    ])
})
