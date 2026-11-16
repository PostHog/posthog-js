import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { once } from 'node:events'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createMockServer } from '@posthog-tooling/sdk-mock-server'
import { createCompatibilityContext } from './network.mjs'

const require = createRequire(import.meta.url)
const playwright = require('@playwright/test')
const evidence = []

for (const engine of ['chromium', 'firefox', 'webkit']) {
    test(`compatibility network policy denies other loopback HTTP and HTTPS origins in ${engine}`, async () => {
        let httpHits = 0,
            tlsConnections = 0
        const foreign = createServer((_request, response) => {
            httpHits++
            response.setHeader('Access-Control-Allow-Origin', '*')
            response.end('foreign destination')
        })
        // Count attempted TLS connections without requiring a certificate or TLS failure as the denial proof.
        const tls = createTcpServer((socket) => {
            tlsConnections++
            socket.destroy()
        })
        foreign.listen(0, '127.0.0.1')
        tls.listen(0, '127.0.0.1')
        await Promise.all([once(foreign, 'listening'), once(tls, 'listening')])
        const server = createMockServer({
            adapter: (request) =>
                request.path === '/'
                    ? { body: '<!doctype html><title>Egress control</title>', headers: { 'Content-Type': 'text/html' } }
                    : request.path === '/favicon.ico'
                      ? { status: 204, body: '' }
                      : undefined,
        })
        const origin = await server.start()
        const browser = await playwright[engine].launch()
        const context = await createCompatibilityContext(browser, engine, origin)
        try {
            const page = await context.newPage()
            const destinations = []
            context.on('request', (request) => {
                if (new URL(request.url()).origin !== origin) destinations.push(request.url())
            })
            await page.goto(origin)
            const urls = [
                `http://127.0.0.1:${foreign.address().port}/blocked`,
                `https://127.0.0.1:${tls.address().port}/blocked`,
            ]
            const outcomes = await page.evaluate(async (urls) => {
                const results = []
                for (const url of urls) {
                    try {
                        const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
                        results.push({ url, status: response.status })
                    } catch (error) {
                        results.push({ url, error: error.name })
                    }
                }
                return results
            }, urls)
            assert.equal(httpHits, 0, 'Foreign HTTP server was reached')
            assert.equal(tlsConnections, 0, 'Foreign TLS server was reached before denial')
            assert(outcomes.every((outcome) => outcome.status === 403 || outcome.error === 'TypeError'))
            assert(
                urls.every((url) => destinations.includes(url)),
                'Unexpected destinations were not observed'
            )
            const wire = server.inspect()
            assert(wire.errors.includes(`Blocked proxy destination: 127.0.0.1:${foreign.address().port}`))
            if (engine !== 'webkit')
                assert(wire.errors.includes(`Blocked proxy CONNECT: 127.0.0.1:${tls.address().port}`))
            evidence.push({
                engine,
                browserVersion: browser.version(),
                httpHits,
                tlsConnections,
                outcomes,
                destinations,
                wire,
            })
        } finally {
            await context.close()
            await browser.close()
            await server.stop()
            await Promise.all([
                new Promise((resolve) => foreign.close(resolve)),
                new Promise((resolve) => tls.close(resolve)),
            ])
        }
    })
}

process.on('exit', () => {
    if (process.env.COMPATIBILITY_EGRESS_EVIDENCE)
        writeFileSync(
            process.env.COMPATIBILITY_EGRESS_EVIDENCE,
            JSON.stringify({ passed: evidence.length === 3, evidence }, null, 2) + '\n'
        )
})
