import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(new URL('../.playwright/fixture.js', import.meta.url))
const port = Number(process.env.POSTHOG_BROWSER_NEXT_TEST_PORT ?? 2346)
const html = '<!doctype html><html><body><script src="/fixture.js"></script></body></html>'
const received = []

const server = createServer((request, response) => {
    if (request.url === '/fixture.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
        createReadStream(fixture).pipe(response)
        return
    }
    if (request.url === '/' || request.url === '/after') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(request.url === '/' ? html : '<!doctype html><html><body>after</body></html>')
        return
    }
    if (request.url === '/i/v1/analytics/events' && request.method === 'POST') {
        const chunks = []
        request.on('data', (chunk) => chunks.push(chunk))
        request.on('end', () => {
            received.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') })
            response.writeHead(200, { 'Content-Type': 'application/json' })
            response.end('{}')
        })
        return
    }
    if (request.url === '/requests' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(received))
        return
    }
    response.writeHead(404)
    response.end()
})

server.listen(port, '127.0.0.1')

const close = () => server.close(() => process.exit(0))
process.on('SIGINT', close)
process.on('SIGTERM', close)
