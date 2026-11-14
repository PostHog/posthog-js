import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const fixture = fileURLToPath(new URL('main.cjs', import.meta.url))

async function listen(server) {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    return `http://127.0.0.1:${server.address().port}`
}

for (const target of ['different-origin', 'outside-configured-prefix']) {
    test(`does not forward event or flag bodies to a redirect ${target}`, { timeout: 20000 }, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'electron-redirect-'))
        const escaped = []
        const requests = []
        const recipient = createServer(async (request, response) => {
            let body = ''
            for await (const part of request) body += part
            escaped.push({ path: request.url, body })
            response.writeHead(200, { 'content-type': 'application/json' })
            response.end(JSON.stringify({ featureFlags: { unexpected: true } }))
        })
        let destination
        const source = createServer(async (request, response) => {
            let body = ''
            for await (const part of request) body += part
            if (request.url.startsWith('/ingest/')) {
                requests.push({ path: request.url, body })
                response.writeHead(307, { location: destination })
                response.end()
            } else {
                escaped.push({ path: request.url, body })
                response.writeHead(200, { 'content-type': 'application/json' })
                response.end(JSON.stringify({ featureFlags: { unexpected: true } }))
            }
        })
        let child
        let timer
        try {
            const other = await listen(recipient)
            const origin = await listen(source)
            destination = `${target === 'different-origin' ? other : origin}/outside/receiver`
            const result = join(directory, 'result.json')
            const config = join(directory, 'config.json')
            await writeFile(config, JSON.stringify({ directory, result, host: `${origin}/ingest` }))
            const env = { ...process.env }
            delete env.ELECTRON_RUN_AS_NODE
            delete env.NODE_OPTIONS
            child = spawn(require('electron'), [fixture, config], { env, stdio: ['ignore', 'pipe', 'pipe'] })
            let log = ''
            child.stdout.on('data', (data) => {
                log += data
            })
            child.stderr.on('data', (data) => {
                log += data
            })
            timer = setTimeout(() => child.kill('SIGKILL'), 15000)
            const [code, signal] = await once(child, 'exit')
            assert.equal(code, 0, `native fixture failed (${signal}): ${log}`)
            const state = JSON.parse(await readFile(result, 'utf8'))
            assert.ok(state.electron, 'must execute genuine Electron')
            assert.ok(
                requests.some(({ path }) => path.includes('/batch/')),
                'batch request must reach configured host'
            )
            assert.ok(
                requests.some(({ path }) => path.includes('/flags/')),
                'flags request must reach configured host'
            )
            assert.deepEqual(
                escaped,
                [],
                'a redirect must not forward either POST body outside the configured boundary'
            )
            assert.equal(state.rejected, true)
            assert.deepEqual(state.flags, {})
            assert.equal(state.queue.length, 1)
            assert.equal(state.queue[0].event, 'synthetic-redirect-event')
            assert.ok(state.queue[0].uuid, 'failed delivery must retain its original queued event')
        } finally {
            clearTimeout(timer)
            if (child?.exitCode === null && child.signalCode === null) {
                child.kill('SIGKILL')
                await once(child, 'exit')
            }
            await Promise.all([
                new Promise((resolve) => source.close(resolve)),
                new Promise((resolve) => recipient.close(resolve)),
            ])
            await rm(directory, { recursive: true, force: true })
        }
    })
}
