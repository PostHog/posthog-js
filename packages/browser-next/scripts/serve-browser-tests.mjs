import { readFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createMockServer } from '@posthog-tooling/sdk-mock-server'

const fixture = fileURLToPath(new URL('../.playwright/fixture.js', import.meta.url))
const html = '<!doctype html><html><body><script src="/fixture.js"></script></body></html>'

export function createBrowserTestServer({ port = 0, fixturePath = fixture } = {}) {
    const server = createMockServer({
        port,
        adapter(request) {
            if (request.path === '/fixture.js')
                return {
                    body: readFileSync(fixturePath),
                    headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
                }
            if (request.path === '/' || request.path === '/after')
                return {
                    body: request.path === '/' ? html : '<!doctype html><html><body>after</body></html>',
                    headers: { 'Content-Type': 'text/html; charset=utf-8' },
                }
            if (request.path === '/requests' && request.method === 'GET')
                return {
                    json: server
                        .inspect()
                        .requests.filter(
                            (record) => record.path === '/i/v1/analytics/events' && record.method === 'POST'
                        )
                        .map((record) => ({
                            headers: record.headers,
                            body: record.rawBody,
                            rawBodyBase64: record.rawBodyBase64,
                            decodedBody: record.body,
                        })),
                }
            return undefined
        },
    })
    return server
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const server = createBrowserTestServer({ port: Number(process.env.POSTHOG_BROWSER_NEXT_TEST_PORT ?? 2346) })
    await server.start()
    const close = async () => {
        await server.stop()
        process.exit(0)
    }
    process.on('SIGINT', close)
    process.on('SIGTERM', close)
}
