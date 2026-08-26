import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(new URL('../.playwright/fixture.js', import.meta.url))
const port = Number(process.env.POSTHOG_BROWSER_NEXT_TEST_PORT ?? 2346)
const html = '<!doctype html><html><body><script src="/fixture.js"></script></body></html>'

const server = createServer((request, response) => {
    if (request.url === '/fixture.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
        createReadStream(fixture).pipe(response)
        return
    }
    if (request.url === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(html)
        return
    }
    response.writeHead(404)
    response.end()
})

server.listen(port, '127.0.0.1')

const close = () => server.close(() => process.exit(0))
process.on('SIGINT', close)
process.on('SIGTERM', close)
