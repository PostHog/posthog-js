import { expect, test } from '@playwright/test'
import { createServer, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// A real HTTP fixture: routing/fulfilling with Playwright can bypass the browser's keepalive quota.
// Hold headers and then response bodies separately to exercise both fetch lifetime boundaries.
test('named clients share keepalive bytes until response bodies finish', async ({ page }) => {
    const held = new Map<string, ServerResponse>()
    const received: any[] = []
    const server = createServer((req, res) => {
        if (req.url === '/sdk.js') {
            res.setHeader('Content-Type', 'application/javascript')
            res.end(readFileSync(path.resolve(__dirname, '../../dist/array.js')))
        } else if (req.method === 'POST') {
            let body = ''
            req.setEncoding('utf8')
            req.on('data', (chunk) => {
                body += chunk
            })
            req.on('end', () => {
                const payload = JSON.parse(body)
                received.push(payload)
                held.set(payload.batch[0].event, res)
            })
        } else if (req.url === '/') {
            res.setHeader('Content-Type', 'text/html')
            res.end('<!doctype html><html><body><script src="/sdk.js"></script></body></html>')
        } else {
            res.setHeader('Content-Type', 'application/json')
            res.end('{}')
        }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    try {
        await page.addInitScript(() => {
            const originalFetch = window.fetch
            ;(window as any).sends = []
            ;(window as any).responses = []
            ;(window as any).completedBodies = 0
            window.fetch = (url, init) => {
                // Second wrapper forwards the original url/init, preserving strings on WebKit.
                const capture = init?.method === 'POST'
                if (capture) {
                    ;(window as any).sends.push({
                        keepalive: init.keepalive,
                        bytes: new Blob([init.body as BlobPart]).size,
                    })
                }
                return originalFetch(url, init).then((response) => {
                    if (capture) {
                        ;(window as any).responses.push(response)
                        const text = response.text.bind(response)
                        response.text = () =>
                            text().then((body) => {
                                ;(window as any).completedBodies++
                                return body
                            })
                    }
                    return response
                })
            }
        })
        await page.goto(origin)
        await page.evaluate((api_host) => {
            const posthog = (window as any).posthog
            const config = {
                api_host,
                opt_out_useragent_filter: true,
                capture_pageview: false,
                capture_pageleave: false,
                autocapture: false,
                advanced_disable_flags: true,
                disable_session_recording: true,
                disable_external_dependency_loading: true,
                disable_compression: true,
                request_batching: false,
                persistence: 'memory',
            }
            posthog.init('keepalive-first', config)
            posthog.init('keepalive-second', config, 'second')
            ;(window as any).sendCapture = (name: string, second = false) => {
                const client = second ? posthog.second : posthog
                client.capture(name, { payload: '😀'.repeat(7500) })
            }
            ;(window as any).sendCapture('first')
            ;(window as any).sendCapture('second', true)
            ;(window as any).sendCapture('third')
        }, origin)
        const sends = await page.evaluate(() => (window as any).sends)
        expect(sends).toHaveLength(3)
        expect(sends.every((send: { bytes: number }) => send.bytes < 64 * 1024 * 0.8)).toBe(true)
        expect(sends.reduce((sum: number, send: { bytes: number }) => sum + send.bytes, 0)).toBeGreaterThan(64 * 1024)
        expect(sends.map((send: { keepalive: boolean }) => send.keepalive)).toEqual([true, false, false])
        await expect.poll(() => held.size).toBe(3)
        held.get('first')!.writeHead(200, { 'Content-Type': 'application/json' })
        held.get('first')!.write('{"ok":')
        await expect.poll(() => page.evaluate(() => (window as any).responses.length)).toBe(1)
        await page.evaluate(() => (window as any).sendCapture('before-body-end', true))
        expect(await page.evaluate(() => (window as any).sends[3].keepalive)).toBe(false)
        await expect.poll(() => held.size).toBe(4)
        held.get('first')!.end('true}')
        await expect.poll(() => page.evaluate(() => (window as any).completedBodies)).toBe(1)
        await page.evaluate(() => (window as any).sendCapture('after-body-end', true))
        expect(await page.evaluate(() => (window as any).sends[4].keepalive)).toBe(true)
        await expect.poll(() => held.size).toBe(5)
        expect(received.map((payload) => [payload.batch[0].event, payload.api_key])).toEqual(
            expect.arrayContaining([
                ['first', 'keepalive-first'],
                ['second', 'keepalive-second'],
                ['third', 'keepalive-first'],
                ['before-body-end', 'keepalive-second'],
                ['after-body-end', 'keepalive-second'],
            ])
        )
        expect(received.every((payload) => payload.batch[0].properties.payload === '😀'.repeat(7500))).toBe(true)
        held.forEach((res, event) => {
            if (event !== 'first') {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end('{}')
            }
        })
    } finally {
        await page.close()
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
    }
})
