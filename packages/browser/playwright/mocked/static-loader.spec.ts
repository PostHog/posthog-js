import { expect, test, Page, TestInfo } from '@playwright/test'
import path from 'node:path'
import type { PostHog } from '../../src/posthog-core'

declare global {
    interface Window {
        loaderTestPosthog?: PostHog
    }
}

type CapturedEvent = { event: string; properties: Record<string, unknown> }

async function install(
    page: Page,
    testInfo: TestInfo,
    {
        region = 'us',
        tokenSource = 'query',
        config = {},
        delayCore = false,
        failCore = false,
        duplicate = false,
        dynamic = false,
    }: {
        region?: string
        tokenSource?: 'query' | 'attribute'
        config?: Record<string, unknown>
        delayCore?: boolean
        failCore?: boolean
        duplicate?: boolean
        dynamic?: boolean
    } = {}
) {
    const events: CapturedEvent[] = []
    const errors: string[] = []
    const coreRequests: string[] = []
    const host = `https://${region}-assets.i.posthog.com`
    const options = {
        autocapture: false,
        disable_session_recording: true,
        disable_surveys: true,
        disable_conversations: true,
        advanced_disable_feature_flags: true,
        request_batching: false,
        disable_compression: true,
        opt_out_useragent_filter: true,
        ...config,
    }
    const source = `${host}/static/loader.js${tokenSource === 'query' ? '?project_token=phc_loader_test' : ''}`
    const tokenAttribute = tokenSource === 'attribute' ? ' data-project-token="phc_loader_test"' : ''
    const tag = `<script src="${source}"${tokenAttribute} data-config='${JSON.stringify(options)}' crossorigin="anonymous"></script>`
    const html = dynamic
        ? '<!doctype html><html><head></head><body>Loader test</body></html>'
        : `<!doctype html><html><head>${tag}${duplicate ? tag : ''}<script>
        window.loaderTestPosthog = window.posthog;
        posthog.register({ queued_property: 'before-core' });
        posthog.capture('queued event');
    </script></head><body>Loader test</body></html>`
    const overrides = (testInfo.project.use as { staticOverrides?: Record<string, string> }).staticOverrides
    let releaseCore = () => {}
    const coreReady = new Promise<void>((resolve) => {
        releaseCore = resolve
    })
    if (!delayCore) {
        releaseCore()
    }
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/*', async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        const headers = {
            'access-control-allow-origin': 'https://customer.example',
            'access-control-allow-credentials': 'true',
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-allow-headers': '*',
        }
        if (request.method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers })
        }
        if (request.url() === 'https://customer.example/') {
            return route.fulfill({ contentType: 'text/html', body: html })
        }
        if (url.pathname === '/static/loader.js') {
            return route.fulfill({ path: path.resolve(__dirname, '../../dist/loader.js'), headers })
        }
        if (url.pathname === '/static/array.js') {
            coreRequests.push(request.url())
            await coreReady
            return route.fulfill({
                status: failCore ? 404 : 200,
                ...(failCore
                    ? { body: '' }
                    : { path: path.resolve(__dirname, '../../dist', overrides?.['array.js'] || 'array.js') }),
                headers,
            })
        }
        if (url.pathname.endsWith('/e/') && request.method() === 'POST') {
            const payload = request.postDataJSON()
            events.push(...(payload.batch || [payload]))
            return route.fulfill({ json: {}, headers })
        }
        return route.fulfill({ status: 404, body: '', headers })
    })
    await page.goto('https://customer.example/', { waitUntil: 'domcontentloaded' })
    return { events, errors, coreRequests, releaseCore, source, options }
}

const waitForSDK = (page: Page) => page.waitForFunction(() => (window as any).posthog?.__loaded)

for (const [region, tokenSource] of [
    ['us', 'query'],
    ['eu', 'query'],
    ['us', 'attribute'],
    ['eu', 'attribute'],
] as const) {
    test(`the ${region} cross-origin loader replays queued calls exactly once with a ${tokenSource} token`, async ({
        page,
    }, testInfo) => {
        const state = await install(page, testInfo, { region, tokenSource, delayCore: true })
        expect(await page.evaluate(() => (window as any).posthog.__loaded)).toBeUndefined()
        state.releaseCore()
        await waitForSDK(page)
        await expect.poll(() => state.events.filter(({ event }) => event === 'queued event')).toHaveLength(1)
        expect(state.events.find(({ event }) => event === 'queued event')?.properties.queued_property).toBe(
            'before-core'
        )
        expect(await page.evaluate(() => (window as any).posthog.config.api_host)).toBe(
            `https://${region}.i.posthog.com`
        )
        expect(await page.evaluate(() => (window as any).posthog.config.token)).toBe('phc_loader_test')
        expect(state.coreRequests).toEqual([`https://${region}-assets.i.posthog.com/static/array.js`])
        expect(state.errors).toEqual([])
    })
}

test('JavaScript injection exposes a callable queue when the loader onload callback runs', async ({
    page,
}, testInfo) => {
    const state = await install(page, testInfo, { dynamic: true, delayCore: true })
    await page.evaluate(
        ({ source, options }) =>
            new Promise<void>((resolve, reject) => {
                const script = document.createElement('script')
                script.src = source
                script.crossOrigin = 'anonymous'
                script.setAttribute('data-config', JSON.stringify(options))
                script.onload = () => {
                    ;(window as any).posthog.capture('dynamic event')
                    resolve()
                }
                script.onerror = () => reject(new Error('Loader download failed'))
                document.head.appendChild(script)
            }),
        { source: state.source, options: state.options }
    )
    expect(await page.evaluate(() => (window as any).posthog.__loaded)).toBeUndefined()
    state.releaseCore()
    await waitForSDK(page)
    await expect.poll(() => state.events.filter(({ event }) => event === 'dynamic event')).toHaveLength(1)
    expect(await page.evaluate(() => (window as any).posthog.config.token)).toBe('phc_loader_test')
    expect(state.coreRequests).toEqual(['https://us-assets.i.posthog.com/static/array.js'])
    expect(state.errors).toEqual([])
})

test('duplicate tags preserve the pending queue and the loaded SDK', async ({ page }, testInfo) => {
    const state = await install(page, testInfo, { delayCore: true, duplicate: true })
    state.releaseCore()
    await waitForSDK(page)
    await page.evaluate(() => {
        window.loaderTestPosthog = (window as any).posthog
    })
    await page.addScriptTag({ url: 'https://us-assets.i.posthog.com/static/loader.js?duplicate=1' })
    expect(await page.evaluate(() => window.loaderTestPosthog === (window as any).posthog)).toBe(true)
    await expect.poll(() => state.events.filter(({ event }) => event === 'queued event')).toHaveLength(1)
    expect(state.coreRequests).toHaveLength(1)
    expect(state.errors).toEqual([])
})

test('consent configuration applies before automatic or queued captures', async ({ page }, testInfo) => {
    const state = await install(page, testInfo, { config: { opt_out_capturing_by_default: true } })
    await waitForSDK(page)
    expect(state.events).toEqual([])
    expect(await page.evaluate(() => (window as any).posthog.has_opted_out_capturing())).toBe(true)
    await page.evaluate(() => {
        const ph = (window as any).posthog
        ph.capture('blocked event')
        ph.opt_in_capturing({ captureEventName: false })
        ph.capture('allowed event')
    })
    await expect.poll(() => state.events.filter(({ event }) => event === 'allowed event')).toHaveLength(1)
    expect(state.events.some(({ event }) => event === 'queued event' || event === 'blocked event')).toBe(false)
    expect(state.errors).toEqual([])
})

test('SDK download failure leaves a callable queue without throwing', async ({ page }, testInfo) => {
    const state = await install(page, testInfo, { failCore: true })
    await page.waitForLoadState('load')
    await page.evaluate(() => (window as any).posthog.capture('after failure'))
    expect(await page.evaluate(() => (window as any).posthog.slice())).toEqual([
        ['register', { queued_property: 'before-core' }],
        ['capture', 'queued event'],
        ['capture', 'after failure'],
    ])
    expect(state.events).toEqual([])
    expect(state.errors).toEqual([])
})
