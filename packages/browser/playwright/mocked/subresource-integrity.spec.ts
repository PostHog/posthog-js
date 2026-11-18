import { expect, test, Page } from '@playwright/test'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { version } from '../../package.json'

declare global {
    interface Window {
        sriTampered?: string[]
        siteAppRan?: boolean
    }
}

const dist = path.resolve(__dirname, '../../dist')
const integrityOf = (file: string) =>
    `sha384-${createHash('sha384')
        .update(new Uint8Array(readFileSync(path.join(dist, file))))
        .digest('base64')}`

type Options = {
    apiHost?: string
    tamper?: string[]
    config?: Record<string, unknown>
    host?: string
    loader?: boolean
    preloadSiteApp?: boolean
    instances?: { name: string; config: Record<string, unknown> }[]
}

const baseConfig = {
    autocapture: false,
    request_batching: false,
    disable_compression: true,
    opt_out_useragent_filter: true,
    advanced_disable_feature_flags: true,
    disable_session_recording: false,
    disable_surveys: false,
    disable_surveys_automatic_display: true,
    disable_conversations: true,
    disable_product_tours: true,
    capture_performance: false,
}

const remoteConfig = {
    supportedCompression: [],
    sessionRecording: { endpoint: '/s/' },
    surveys: true,
    siteApps: [],
}

// The page runs on its own origin and loads assets from another one, or from a reverse-proxied
// path on the page origin.
async function setup(
    page: Page,
    {
        apiHost = 'https://us.i.posthog.com',
        tamper = [],
        config = {},
        host = 'https://customer.example',
        instances,
        loader = false,
        preloadSiteApp = false,
    }: Options = {}
) {
    const staticRequests: string[] = []
    const configJsRequests: string[] = []
    const events: { event: string; token: string }[] = []
    const errors: string[] = []
    const configs = instances ?? [{ name: '', config: { require_subresource_integrity: true, ...config } }]
    // The customer pins loader.js natively; its data-core-integrity pins array.js, whose embedded
    // map pins every extension.
    const loaderTag = `<script src="https://us-assets.i.posthog.com/static/${version}/loader.js?project_token=phc_sri" integrity="${integrityOf('loader.js')}" crossorigin="anonymous" data-core-integrity="${integrityOf('array.js')}" data-config='${JSON.stringify({ ...baseConfig, api_host: apiHost, require_subresource_integrity: true, ...config })}'></script>`
    const html = loader
        ? `<!doctype html><html><head><script>window.sriTampered = [];</script>${loaderTag}</head><body></body></html>`
        : `<!doctype html><html><head><script>
        window.sriTampered = [];
        ${
            // Mimics the token-specific array.js, which preloads config and site-app code.
            preloadSiteApp
                ? `window._POSTHOG_REMOTE_CONFIG = { phc_sri: { config: ${JSON.stringify(remoteConfig)}, siteApps: [{ id: 'preloaded', init: function () { window.siteAppRan = true; return {} } }] } };`
                : ''
        }
    </script><script src="https://us-assets.i.posthog.com/static/${version}/array.js" crossorigin="anonymous" integrity="${integrityOf('array.js')}"></script></head><body>
        <script>
            ${configs
                .map(
                    ({ name, config }) =>
                        `posthog.init('phc_sri${name}', ${JSON.stringify({
                            ...baseConfig,
                            api_host: apiHost,
                            ...config,
                        })}${name ? `, '${name}'` : ''});`
                )
                .join('\n')}
        </script>
    </body></html>`
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/*', async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        if (url.hostname === '127.0.0.1') {
            return route.continue()
        }
        const headers = {
            'access-control-allow-origin': host,
            'access-control-allow-credentials': 'true',
            'access-control-allow-headers': '*',
        }
        if (request.method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers })
        }
        if (request.url() === `${host}/`) {
            return route.fulfill({ contentType: 'text/html', body: html })
        }
        if (url.pathname === `/static/${version}/array.js` || url.pathname === `/static/${version}/loader.js`) {
            return route.fulfill({
                path: path.join(dist, path.basename(url.pathname)),
                contentType: 'application/javascript',
                headers: { 'access-control-allow-origin': '*' },
            })
        }
        if (url.pathname.includes('/static/')) {
            staticRequests.push(url.pathname + url.search)
            const file = url.pathname.split('/').pop()!
            if (!existsSync(path.join(dist, file))) {
                return route.fulfill({ status: 404, headers })
            }
            const body = readFileSync(path.join(dist, file), 'utf8')
            return route.fulfill({
                contentType: 'application/javascript',
                body: tamper.includes(file) ? `window.sriTampered.push(${JSON.stringify(file)});${body}` : body,
                headers,
            })
        }
        if (url.pathname.endsWith('/config.js')) {
            configJsRequests.push(url.pathname)
            return route.fulfill({ contentType: 'application/javascript', body: '', headers })
        }
        if (/\/array\/[^/]+\/config$/.test(url.pathname)) {
            return route.fulfill({ json: remoteConfig, headers })
        }
        if (url.pathname.includes('/surveys')) {
            return route.fulfill({ json: { surveys: [] }, headers })
        }
        if (url.pathname.endsWith('/e/') && request.method() === 'POST') {
            const payload = request.postDataJSON()
            for (const event of payload.batch || [payload]) {
                events.push({ event: event.event, token: event.properties?.token })
            }
            return route.fulfill({ json: {}, headers })
        }
        return route.fulfill({ status: 200, json: {}, headers })
    })
    await page.goto(`${host}/`, { waitUntil: 'load' })
    await page.waitForFunction(() => (window as any).posthog?.__loaded)
    return { staticRequests, configJsRequests, events, errors }
}

const extensions = (page: Page) =>
    page.evaluate(() => {
        const ext = (window as any).__PosthogExtensions__ || {}
        return { recorder: !!ext.rrweb?.record && !!ext.initSessionRecording, surveys: !!ext.generateSurveys }
    })

test.describe('require_subresource_integrity', () => {
    test('loads verified extensions from exact-version paths and the features work', async ({ page }) => {
        const state = await setup(page)

        await expect.poll(() => extensions(page)).toEqual({ recorder: true, surveys: true })
        await expect.poll(() => page.evaluate(() => (window as any).posthog.sessionRecording?.started)).toBe(true)
        expect([...state.staticRequests].sort()).toEqual(
            [`/static/${version}/lazy-recorder.js`, `/static/${version}/surveys.js`].sort()
        )
        expect(state.configJsRequests).toEqual([])
        const integrity = await page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLScriptElement>('script[src*="/static/"]'))
                .filter((s) => !s.src.endsWith('/array.js'))
                .map((s) => [s.src.split('/').pop(), s.integrity, s.crossOrigin])
                .sort()
        )
        expect(integrity).toEqual([
            ['lazy-recorder.js', integrityOf('lazy-recorder.js'), 'anonymous'],
            ['surveys.js', integrityOf('surveys.js'), 'anonymous'],
        ])
        await page.evaluate(() => (window as any).posthog.capture('sri event'))
        await expect.poll(() => state.events.map(({ event }) => event)).toContain('sri event')
        expect(state.errors).toEqual([])
    })

    test('tampered extensions do not execute and no mutable URL is requested', async ({ page }) => {
        const state = await setup(page, { tamper: ['lazy-recorder.js', 'surveys.js'] })

        await expect.poll(() => state.staticRequests.length).toBe(2)
        await page.waitForTimeout(500)
        expect(await page.evaluate(() => window.sriTampered)).toEqual([])
        expect(await extensions(page)).toEqual({ recorder: false, surveys: false })
        expect(state.staticRequests.every((request) => request.startsWith(`/static/${version}/`))).toBe(true)
        expect(state.staticRequests.some((request) => request.includes('?v='))).toBe(false)
        await page.evaluate(() => (window as any).posthog.capture('still capturing'))
        await expect.poll(() => state.events.map(({ event }) => event)).toContain('still capturing')
        expect(state.errors).toEqual([])
    })

    test('pinning loader.js and data-core-integrity pins every extension', async ({ page }) => {
        const state = await setup(page, { loader: true, tamper: ['surveys.js'] })

        await expect.poll(() => extensions(page)).toEqual({ recorder: true, surveys: false })
        await page.waitForTimeout(500)
        expect(await page.evaluate(() => window.sriTampered)).toEqual([])
        expect([...state.staticRequests].sort()).toEqual(
            [`/static/${version}/lazy-recorder.js`, `/static/${version}/surveys.js`].sort()
        )
        expect(state.configJsRequests).toEqual([])
        expect(
            await page.evaluate(() => document.querySelector<HTMLScriptElement>('script[src$="/array.js"]')?.integrity)
        ).toBe(integrityOf('array.js'))
        await page.evaluate(() => (window as any).posthog.capture('loader event'))
        await expect.poll(() => state.events.map(({ event }) => event)).toContain('loader event')
        expect(state.errors).toEqual([])
    })

    for (const requireIntegrity of [true, false]) {
        test(`preloaded site app code ${requireIntegrity ? 'does not run' : 'runs'} with opt_in_site_apps${requireIntegrity ? ' and require_subresource_integrity' : ''}`, async ({
            page,
        }) => {
            const state = await setup(page, {
                preloadSiteApp: true,
                config: { opt_in_site_apps: true, require_subresource_integrity: requireIntegrity },
            })

            await expect.poll(() => extensions(page)).toEqual({ recorder: true, surveys: true })
            await page.waitForTimeout(500)
            expect(await page.evaluate(() => window.siteAppRan)).toBe(requireIntegrity ? undefined : true)
            expect(state.errors).toEqual([])
        })
    }

    test('a reverse-proxy api_host path loads verified extensions', async ({ page }) => {
        const state = await setup(page, { apiHost: 'https://customer.example/ingest' })

        await expect.poll(() => extensions(page)).toEqual({ recorder: true, surveys: true })
        expect([...state.staticRequests].sort()).toEqual(
            [`/ingest/static/${version}/lazy-recorder.js`, `/ingest/static/${version}/surveys.js`].sort()
        )
    })

    // route.fulfill responses bypass the browser's CORS check, so serve assets from a real
    // cross-origin server to prove a missing Access-Control-Allow-Origin fails closed.
    for (const cors of [true, false]) {
        test(`a real cross-origin asset host ${cors ? 'with' : 'without'} CORS ${cors ? 'loads' : 'fails closed'}`, async ({
            page,
        }) => {
            const requests: string[] = []
            const server: Server = createServer((request, response) => {
                requests.push(request.url!)
                const file = path.basename(new URL(request.url!, 'http://localhost').pathname)
                response.writeHead(200, {
                    'content-type': 'application/javascript',
                    ...(cors ? { 'access-control-allow-origin': '*' } : {}),
                })
                response.end(readFileSync(path.join(dist, file)))
            })
            await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
            try {
                const assetHost = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
                const state = await setup(page, {
                    config: { asset_host: assetHost },
                    host: 'http://customer.localhost',
                })

                await expect.poll(() => requests.length).toBe(2)
                if (cors) {
                    await expect.poll(() => extensions(page)).toEqual({ recorder: true, surveys: true })
                } else {
                    await page.waitForTimeout(500)
                    expect(await extensions(page)).toEqual({ recorder: false, surveys: false })
                }
                expect([...requests].sort()).toEqual(
                    [`/static/${version}/lazy-recorder.js`, `/static/${version}/surveys.js`].sort()
                )
                expect(state.staticRequests).toEqual([])
            } finally {
                await new Promise((resolve) => server.close(resolve))
            }
        })
    }

    test('a hardened instance reuses extension code another instance already ran unverified', async ({ page }) => {
        const state = await setup(page, {
            instances: [{ name: '', config: { strict_script_versioning: true } }],
            tamper: ['surveys.js'],
        })
        await expect.poll(() => extensions(page)).toEqual({ recorder: true, surveys: true })

        await page.evaluate((config) => (window as any).posthog.init('phc_sri_hardened', config, 'hardened'), {
            ...baseConfig,
            api_host: 'https://us.i.posthog.com',
            require_subresource_integrity: true,
        })
        await page.waitForFunction(() => (window as any).posthog.hardened?.__loaded)
        await page.waitForTimeout(500)

        // Page globals are shared: the documented limitation is that the hardened guarantee
        // does not cover extension code another instance already executed.
        expect(await page.evaluate(() => window.sriTampered)).toEqual(['surveys.js'])
        expect([...state.staticRequests].sort()).toEqual(
            [`/static/${version}/lazy-recorder.js`, `/static/${version}/surveys.js`].sort()
        )
        await page.evaluate(() => (window as any).posthog.hardened.capture('hardened event'))
        await expect.poll(() => state.events.map(({ event }) => event)).toContain('hardened event')
        expect(state.errors).toEqual([])
    })

    test('a hardened instance keeps its own loader when another core replaces the shared one', async ({ page }) => {
        const state = await setup(page, {
            instances: [
                {
                    name: '',
                    config: {
                        require_subresource_integrity: true,
                        disable_session_recording: true,
                        disable_surveys: true,
                    },
                },
            ],
            tamper: ['surveys.js'],
        })
        // Stands in for an older core that loads unpinned scripts and has its own extension hashes.
        await page.evaluate(() => {
            ;(window as any).__PosthogExtensions__.loadExternalDependency = (_: unknown, kind: string, cb: any) => {
                const script = document.createElement('script')
                script.src = `https://us-assets.i.posthog.com/static/${kind}.js?v=old`
                script.onload = () => cb()
                document.head.appendChild(script)
            }
        })
        await page.evaluate((config) => (window as any).posthog.init('phc_sri_hardened', config, 'hardened'), {
            ...baseConfig,
            api_host: 'https://us.i.posthog.com',
            require_subresource_integrity: true,
            disable_session_recording: true,
        })

        await expect.poll(() => state.staticRequests).toEqual([`/static/${version}/surveys.js`])
        await page.waitForTimeout(500)
        expect(await page.evaluate(() => window.sriTampered)).toEqual([])
        expect(state.errors).toEqual([])
    })

    test('a hardened instance refuses an unverified script still loading for another instance', async ({ page }) => {
        const state = await setup(page, {
            instances: [{ name: '', config: { require_subresource_integrity: true, disable_surveys: true } }],
        })
        const result = await page.evaluate(
            (version) =>
                new Promise((resolve) => {
                    const existing = document.createElement('script')
                    existing.src = `https://us-assets.i.posthog.com/static/${version}/surveys.js`
                    existing.crossOrigin = 'anonymous'
                    document.body.appendChild(existing)
                    ;(window as any).__PosthogExtensions__.loadExternalDependency(
                        (window as any).posthog,
                        'surveys',
                        resolve
                    )
                }),
            version
        )

        expect(result).toBe('Existing script conflicts with prepared script policy')
        expect(state.errors).toEqual([])
    })
})
