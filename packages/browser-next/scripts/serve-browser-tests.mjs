import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(new URL('../.playwright/fixture.js', import.meta.url))
const port = Number(process.env.POSTHOG_BROWSER_NEXT_TEST_PORT ?? 2346)
const html = '<!doctype html><html><body><script src="/fixture.js"></script></body></html>'
const received = []

const server = createServer((request, response) => {
    if (/^\/replay\/(?:chunks\/)?[\w-]+\.js$/.test(request.url ?? '')) {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
        createReadStream(fileURLToPath(new URL(`../.playwright${request.url}`, import.meta.url))).pipe(response)
        return
    }
    if (/^\/replay-(root|static|core)$/.test(request.url ?? '')) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
            `<!doctype html><html><body><h1>Replay fixture</h1><input id="private" value="initial-secret"><button id="activity">Activity</button><script type="module" src="/replay/${request.url.slice(1)}-fixture.js"></script></body></html>`
        )
        return
    }
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
