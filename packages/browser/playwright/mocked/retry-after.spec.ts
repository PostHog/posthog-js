import { expect, test } from '@playwright/test'
import { createServer, Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { build } from 'esbuild'
import path from 'node:path'

// Real cross-origin HTTP, browser timers and transports; no route interception or fake clock.
test.describe('Retry-After CORS exposure', () => {
    let server: Server
    let origin: string
    let bundle: string
    const attempts = new Map<string, number[]>()

    test.beforeAll(async () => {
        const root = path.resolve(__dirname, '../../../..')
        const result = await build({
            stdin: {
                contents: `
                    import { PostHog } from './packages/browser/src/posthog-core'
                    import { RetryQueue } from './packages/browser/src/retry-queue'
                    window.startRetryTest = (url, transport) => {
                        const instance = new PostHog()
                        instance.__loaded = true
                        const queue = new RetryQueue(instance)
                        Math.random = () => 0.5
                        window.retryCallbacks = []
                        queue.retriableRequest({ url, transport, callback: (...args) => window.retryCallbacks.push(args) })
                    }
                `,
                resolveDir: root,
                loader: 'ts',
            },
            alias: {
                '@posthog/browser-common': path.join(root, 'packages/browser-common/src'),
                '@posthog/core': path.join(root, 'packages/core/src'),
                '@posthog/types': path.join(root, 'packages/types/src'),
            },
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            nodePaths: [path.join(root, 'node_modules'), path.join(root, 'packages/browser/node_modules')],
        })
        bundle = result.outputFiles[0].text
        server = createServer((req, res) => {
            const url = new URL(req.url!, 'http://localhost')
            const key = url.pathname
            const times = attempts.get(key) ?? []
            times.push(Date.now())
            attempts.set(key, times)
            res.setHeader('Access-Control-Allow-Origin', '*')
            if (key.includes('exposed')) {
                res.setHeader('Access-Control-Expose-Headers', 'Retry-After')
            }
            if (!key.includes('missing')) {
                res.setHeader(
                    'Retry-After',
                    key.includes('repeated')
                        ? ['8', '120']
                        : key.includes('date')
                          ? new Date(Date.now() + 8000).toUTCString()
                          : '8'
                )
            }
            res.statusCode = key.includes('terminal') ? 429 : times.length === 1 ? 503 : 200
            res.end(res.statusCode === 200 ? '{}' : '')
        })
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })

    test.afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    })

    for (const transport of ['fetch', 'XHR']) {
        for (const mode of [
            'exposed',
            'exposed-date',
            'exposed-repeated',
            'hidden',
            'hidden-repeated',
            'missing',
            'terminal-exposed',
        ]) {
            test(`${transport}: ${mode}`, async ({ page }) => {
                const key = `/${transport}-${mode}`
                await page.goto('/playground/cypress/index.html')
                await page.addScriptTag({ content: bundle })
                await page.evaluate(
                    ({ url, transport }) => {
                        // This helper exists only in the source bundle above.
                        ;(window as any).startRetryTest(url, transport)
                    },
                    { url: origin + key, transport }
                )
                await expect.poll(() => attempts.get(key)?.length).toBe(1)
                if (mode.startsWith('terminal')) {
                    await expect
                        .poll(() => page.evaluate(() => (window as any).retryCallbacks))
                        .toEqual([[{ statusCode: 429, text: '' }]])
                    await page.waitForTimeout(9500)
                    expect(attempts.get(key)).toHaveLength(1)
                    return
                }
                await expect.poll(() => attempts.get(key)?.length, { timeout: 15_000 }).toBe(2)
                const times = attempts.get(key)!
                const delay = times[1] - times[0]
                await test.info().attach('retry-timing', {
                    body: JSON.stringify({ transport, mode, attempts: times, delay }),
                    contentType: 'application/json',
                })
                // HTTP dates have one-second precision, unlike delta-seconds.
                expect(delay).toBeGreaterThanOrEqual(
                    mode === 'exposed-date' ? 7000 : mode.startsWith('exposed') ? 8000 : 3000
                )
                if (!mode.startsWith('exposed')) {
                    expect(delay).toBeLessThan(8000)
                }
                await expect
                    .poll(() => page.evaluate(() => (window as any).retryCallbacks))
                    .toEqual([[{ statusCode: 200, text: '{}', json: {} }]])
            })
        }
    }
})
