import { expect, test } from '@playwright/test'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { version } from '../../package.json'

type CapturedEvent = { event: string; properties: Record<string, unknown> }
const majorVersion = version.split('.')[0]

for (const assetHost of ['https://us-assets.i.posthog.com', 'https://eu-assets.i.posthog.com', '/ingest']) {
    for (const fail of [false, true]) {
        test(`application stays interactive during a ${fail ? 'failed' : 'delayed'} SDK download from ${assetHost}`, async ({
            page,
        }) => {
            const events: CapturedEvent[] = []
            const errors: string[] = []
            const downloads: string[] = []
            const bootstrapSource = readFileSync(path.resolve(__dirname, '../../dist/loader-bootstrap.js'), 'utf8')
            const coreSource = readFileSync(path.resolve(__dirname, '../../dist/array.js'), 'utf8')
            let revision = 1
            let release = () => {}
            const held = new Promise<void>((resolve) => {
                release = resolve
            })
            const options = {
                api_host: 'https://us.i.posthog.com',
                autocapture: false,
                capture_pageview: false,
                capture_pageleave: false,
                disable_session_recording: true,
                disable_surveys: true,
                disable_conversations: true,
                advanced_disable_feature_flags: true,
                request_batching: false,
                disable_compression: true,
                opt_out_useragent_filter: true,
                persistence: 'memory',
            }
            const html = `<!doctype html><html><head></head><body>
                <button id="probe">Test interaction</button><output id="result"></output>
                <script src="/bootstrap.js" data-asset-host="${assetHost}"></script>
                <script src="/init.js"></script>
                <script async src="/app.js"></script>
            </body></html>`
            page.on('pageerror', (error) => errors.push(error.message))
            await page.route('**/*', async (route) => {
                const request = route.request()
                const url = new URL(request.url())
                const headers = { 'access-control-allow-origin': '*' }
                if (request.method() === 'OPTIONS') {
                    return route.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-headers': '*' } })
                }
                if (url.href === 'https://customer.example/') {
                    return route.fulfill({ contentType: 'text/html', body: html })
                }
                if (url.pathname === '/bootstrap.js') {
                    return route.fulfill({ contentType: 'application/javascript', body: bootstrapSource })
                }
                if (url.pathname === '/init.js') {
                    return route.fulfill({
                        contentType: 'application/javascript',
                        body: `var options = ${JSON.stringify(options)};
                            options.before_send = function (event) {
                                if (event.event === 'private event') return null;
                                event.properties.filtered = true;
                                return event;
                            };
                            posthog.init('phc_bootstrap', options);
                            posthog.init('phc_secondary', options, 'secondary');`,
                    })
                }
                if (url.pathname === '/app.js') {
                    return route.fulfill({
                        contentType: 'application/javascript',
                        body: `posthog.register({ queued_property: 'before-download' });
                            posthog.capture('early event');
                            posthog.capture('private event');
                            posthog.secondary.capture('named event');
                            document.querySelector('#probe').addEventListener('click', function () {
                                document.querySelector('#result').textContent = 'clicked';
                                posthog.capture('interaction event');
                            });
                            window.appReady = true;`,
                    })
                }
                if (url.pathname.endsWith('/loader.js') || url.pathname.endsWith('/array.js')) {
                    downloads.push(request.url())
                    await held
                    if (fail) return route.fulfill({ status: 404, body: '', headers })
                    return route.fulfill({
                        contentType: 'application/javascript',
                        body: `${coreSource}\nwindow.__bootstrapCoreRevision = ${revision};`,
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

            try {
                await page.goto('https://customer.example/', { waitUntil: 'domcontentloaded' })
                await page.waitForFunction(() => (window as any).appReady)
                await expect.poll(() => downloads.length).toBe(1)
                await page.click('#probe')
                await expect(page.locator('#result')).toHaveText('clicked')
                expect(await page.evaluate(() => (window as any).posthog.__loaded)).toBeUndefined()
                expect(events).toEqual([])

                release()
                if (fail) {
                    await page.waitForLoadState('load')
                    expect(await page.evaluate(() => (window as any).posthog.__loaded)).toBeUndefined()
                    await page.click('#probe')
                    expect(events).toEqual([])
                } else {
                    await page.waitForFunction(() => (window as any).posthog.__loaded)
                    await page.evaluate(() => (window as any).posthog.capture('after ready'))
                    for (const event of ['early event', 'interaction event', 'named event', 'after ready']) {
                        await expect.poll(() => events.filter((captured) => captured.event === event)).toHaveLength(1)
                    }
                    expect(events.filter(({ event }) => event === 'private event')).toEqual([])
                    for (const event of events) expect(event.properties.filtered).toBe(true)
                    expect(events.find(({ event }) => event === 'early event')?.properties.queued_property).toBe(
                        'before-download'
                    )
                    expect(events.find(({ event }) => event === 'named event')?.properties.token).toBe('phc_secondary')
                }
                const resolvedHost = assetHost === '/ingest' ? 'https://customer.example/ingest' : assetHost
                const aliasURL = `${resolvedHost}/static/${majorVersion}/array.js`
                expect(downloads).toEqual([aliasURL])
                if (!fail) {
                    expect(await page.evaluate(() => (window as any).__bootstrapCoreRevision)).toBe(1)
                    revision = 2
                    events.length = 0
                    await page.reload({ waitUntil: 'domcontentloaded' })
                    await page.waitForFunction(
                        () => (window as any).__bootstrapCoreRevision === 2 && (window as any).posthog.__loaded
                    )
                    for (const event of ['early event', 'named event']) {
                        await expect.poll(() => events.filter((captured) => captured.event === event)).toHaveLength(1)
                    }
                    expect(events.filter(({ event }) => event === 'private event')).toEqual([])
                    expect(downloads).toEqual([aliasURL, aliasURL])
                }
                expect(errors).toEqual([])
            } finally {
                release()
            }
        })
    }
}
