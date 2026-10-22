import { expect, test } from '@playwright/test'
import type { Inspection } from '@posthog-tooling/sdk-mock-server'
import type { PostHog } from '../src/types'

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
    await page.evaluate(() => (window.posthog as PostHog | undefined)?.shutdown?.(0)).catch(() => {})
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
        expect(await page.evaluate(() => typeof (window.posthog as PostHog | undefined)?.capture)).toBe('function')
        const captures = (await backend.inspect()).requests.filter(
            (request) => request.path === '/i/v1/analytics/events'
        )
        expect(captures).toHaveLength(1)
        expect(captures[0]?.headers['authorization']).toBe('Bearer phc_snippet_fixture')
        expect(captures[0]?.body).toMatchObject({
            batch: [{ event: 'snippet_early', properties: { placement: 'plain-html' } }],
        })
        expect((await backend.inspect()).requests.some((request) => request.path === '/e/')).toBe(false)
        const chunks = (await assetRequests()).filter((request) => request.path !== `${assetPrefix}posthog.js`)
        expect(chunks.length).toBeGreaterThan(0)
        for (const request of chunks) {
            expect(request.path.startsWith(`${assetPrefix}chunks/`)).toBe(true)
            expect(request.query).toEqual({})
        }
        expect((await backend.inspect()).requests.some((request) => request.path.endsWith('.js'))).toBe(false)
    })
}

test('core is embedded in the first response; disabled products do not request chunks before capture', async ({
    page,
}) => {
    await page.goto(
        location({ flags: 'false', logs: 'false', surveys: 'false', autocapture: 'false', optOutByDefault: 'true' })
    )
    await expect.poll(() => page.evaluate(() => window.snippetEvidence.readyCount)).toBe(1)
    expect((await assetRequests()).map((request) => request.path)).toEqual([`${assetPrefix}posthog.js`])
    expect((await backend.inspect()).events).toHaveLength(0)
    const summary = await page.evaluate(async () => {
        ;(window.posthog as PostHog).optIn()
        return (window.posthog as PostHog).captureImmediate('after_opt_in')
    })
    expect(summary).toMatchObject({ submitted: 1, allPersisted: true })
    expect((await backend.inspect()).events).toEqual([expect.objectContaining({ event: 'after_opt_in' })])
})

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
        const client = window.posthog as PostHog
        client.optIn()
        client.capture('after_persisted_denial')
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
        window.posthog = { legacy: true } as unknown as PostHog
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

test('failed optional chunks still expose a usable client; analytics loading can retry', async ({ page }) => {
    await assets.failChunks(true)
    await page.goto(location())
    await expect.poll(() => page.evaluate(() => window.snippetEvidence)).toMatchObject({ readyCount: 1, flushed: true })
    expect(await page.evaluate(() => (window.posthog as PostHog).getExtension('featureFlags'))).toBeUndefined()
    expect((await backend.inspect()).events).toHaveLength(0)
    await assets.failChunks(false)
    await page.evaluate(() => (window.posthog as PostHog).flush())
    expect((await backend.inspect()).events).toEqual([expect.objectContaining({ event: 'snippet_early' })])
})
