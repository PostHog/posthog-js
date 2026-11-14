import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { lookup } from 'node:dns/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { routes, failure } from './binding.mjs'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

export const protocol = 'sdk-compliance-v2-draft2'
const maxTimeout = 60000
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
function requireRequest(condition, message) {
    if (!condition) throw new Error(message)
}
function timeout(value) {
    requireRequest(Number.isInteger(value) && value > 0 && value <= maxTimeout, 'Invalid timeout_ms')
    return value
}
function identifier(value) {
    requireRequest(typeof value === 'string' && value.length > 0, 'Nonempty identifier required')
    return value
}

function decimal(token) {
    const [mantissa, exponent = '0'] = token.toLowerCase().split('e')
    const [whole, fraction = ''] = mantissa.split('.')
    const digits = (whole.replace('-', '') + fraction).replace(/^0+/, '')
    if (!digits) return '0'
    const coefficient = digits.replace(/0+$/, '')
    return `${whole.startsWith('-') ? '-' : ''}${coefficient}e${Number(exponent) - fraction.length + digits.length - coefficient.length}`
}

function parseRequest(body) {
    let lossless = true
    const data = JSON.parse(body, (_key, value, context) => {
        if (typeof value === 'number') {
            // Check the original token before parsing or JSON IPC can hide precision loss.
            lossless &&=
                Number.isFinite(value) &&
                !Object.is(value, -0) &&
                (!Number.isInteger(value) || Number.isSafeInteger(value)) &&
                decimal(context.source) === decimal(String(value))
        }
        return value
    })
    return { data, lossless }
}

export class Fixture {
    constructor(consumer, profile) {
        const identity = JSON.parse(readFileSync(join(consumer, 'build.json')))
        this.runtimeVersion = identity.electron
        requireRequest(
            identity.renderer_binding_sha256 ===
                createHash('sha256')
                    .update(readFileSync(new URL('./binding.mjs', import.meta.url)))
                    .digest('hex'),
            'Renderer binding changed; prepare a new immutable consumer'
        )
        const require = createRequire(join(consumer, 'package.json'))
        this.directory = mkdtempSync(join(tmpdir(), 'electron-acceptance-'))
        this.child = spawn(require('electron'), [fileURLToPath(new URL('./electron-main.mjs', import.meta.url))], {
            cwd: consumer,
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: undefined,
                POSTHOG_ELECTRON_CONSUMER: consumer,
                POSTHOG_ELECTRON_PROFILE: profile,
                POSTHOG_ELECTRON_USER_DATA: this.directory,
            },
            stdio: ['pipe', 'inherit', 'inherit', 'pipe'],
            detached: true,
        })
        this.child.stdin.on('error', () => {
            this.dead = true
        })
        this.lines = createInterface({ input: this.child.stdio[3] })
        this.calls = new Set()
        this.busy = false
        this.dead = false
        this.child.on('error', () => {
            this.dead = true
        })
        this.child.on('exit', () => {
            this.dead = true
        })
    }
    async exchange(message, milliseconds) {
        requireRequest(!this.dead && !this.busy, 'Fixture unavailable or busy')
        this.busy = true
        try {
            return await new Promise((resolveReply, reject) => {
                const cleanup = () => {
                    clearTimeout(timer)
                    this.lines.off('line', reply)
                    this.child.off('error', failed)
                    this.child.off('exit', exited)
                }
                const failed = () => {
                    cleanup()
                    reject(new Error('SDK process failed'))
                }
                const exited = () => {
                    cleanup()
                    reject(new Error('SDK process exited'))
                }
                const reply = (line) => {
                    let response
                    try {
                        response = JSON.parse(line)
                    } catch {
                        failed()
                        return
                    }
                    cleanup()
                    if (response.error) reject(new Error(response.error))
                    else resolveReply(response)
                }
                const timer = setTimeout(() => {
                    cleanup()
                    reject(new Error('SDK process deadline exceeded'))
                }, milliseconds)
                this.lines.once('line', reply)
                this.child.once('error', failed)
                this.child.once('exit', exited)
                if (message)
                    this.child.stdin.write(JSON.stringify(message) + '\n', (error) => {
                        if (error) failed()
                    })
            })
        } catch (error) {
            await this.stop()
            throw error
        } finally {
            this.busy = false
        }
    }
    stop() {
        return (this.stopping ??= this.stopOwnedProcess())
    }
    async stopOwnedProcess() {
        this.dead = true
        const active = this.child.pid && this.child.exitCode === null && this.child.signalCode === null
        const exited = active ? once(this.child, 'exit').catch(() => {}) : Promise.resolve()
        if (active) {
            try {
                process.kill(-this.child.pid, 'SIGKILL')
            } catch (error) {
                if (error.code !== 'ESRCH') throw error
            }
        }
        await exited
        this.lines.close()
        rmSync(this.directory, { recursive: true, force: true })
    }
}

export async function startServer({ consumer, host = '127.0.0.1', port = 8080 }) {
    requireRequest(typeof consumer === 'string' && consumer.length > 0, 'POSTHOG_ELECTRON_CONSUMER required')
    requireRequest(Number.isInteger(port) && port >= 0 && port <= 65535, 'Invalid PORT')
    const profiles = ['electron-main', 'electron-renderer'].map((id) => ({
        id,
        sdk_type: 'client',
        sdk_capabilities: ['capture_v0', 'capture_v0_batch', 'flags_v2'],
        fixture_capabilities: ['storage.empty.v1'],
    }))
    const fixtures = new Map()
    const allocatedIds = new Set()
    let closing = false
    async function dispatch(path, data, lossless) {
        requireRequest(!closing, 'Adapter shutting down')
        requireRequest(object(data), 'JSON object required')
        requireRequest(path === '/v2/invoke' || lossless, 'Lossy JSON number')
        if (path === '/v2/negotiate') {
            requireRequest(data.protocol === protocol, 'Unsupported protocol')
            return {
                protocol,
                supported_routes: routes,
                profiles,
                max_timeout_ms: maxTimeout,
            }
        }
        const id = identifier(data.fixture_id)
        const milliseconds = timeout(data.timeout_ms)
        if (path === '/v2/fixtures/allocate') {
            identifier(data.case_id)
            requireRequest(
                profiles.some((profile) => profile.id === data.profile_id),
                'Unknown profile'
            )
            requireRequest(!allocatedIds.has(id), 'Duplicate fixture_id')
            allocatedIds.add(id)
            const fixture = new Fixture(resolve(consumer), data.profile_id)
            fixtures.set(id, fixture)
            let ready
            try {
                ready = await fixture.exchange(null, milliseconds)
                requireRequest(
                    ready.ready === true && ready.runtime?.electron === fixture.runtimeVersion,
                    'Unexpected Electron runtime'
                )
            } catch (error) {
                fixtures.delete(id)
                await fixture.stop()
                throw error
            }
            process.stderr.write(
                JSON.stringify({ fixture_id: id, profile: data.profile_id, runtime: ready.runtime }) + '\n'
            )
            return { fixture_id: id }
        }
        const fixture = fixtures.get(id)
        requireRequest(fixture, 'Unknown fixture_id')
        if (path === '/v2/invoke') {
            identifier(data.call_id)
            requireRequest(!fixture.calls.has(data.call_id), 'Duplicate call_id')
            requireRequest(typeof data.route === 'string' && object(data.args), 'Invalid invocation')
            fixture.calls.add(data.call_id)
            if (!lossless)
                return {
                    fixture_id: id,
                    call_id: data.call_id,
                    completion: failure(
                        'blocked_fixture',
                        'number-representation',
                        'JSON number cannot be represented losslessly by the SDK binding'
                    ),
                }
            const { completion } = await fixture.exchange({ route: data.route, args: data.args }, milliseconds)
            return { fixture_id: id, call_id: data.call_id, completion }
        }
        if (path === '/v2/fixtures/close') {
            try {
                const closed = await fixture.exchange({ close: true }, milliseconds)
                requireRequest(closed.closed === true, 'SDK shutdown incomplete')
            } finally {
                fixtures.delete(id)
                await fixture.stop()
            }
            return { fixture_id: id }
        }
        throw new Error('Unknown endpoint')
    }
    const server = createServer(async (request, response) => {
        try {
            requireRequest(request.method === 'POST', 'POST required')
            let body = ''
            request.setEncoding('utf8')
            for await (const chunk of request) {
                body += chunk
                requireRequest(Buffer.byteLength(body) <= 1048576, 'Request too large')
            }
            const { data, lossless } = parseRequest(body)
            const result = await dispatch(request.url, data, lossless)
            response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
        } catch (error) {
            response
                .writeHead(400, { 'content-type': 'application/json' })
                .end(JSON.stringify({ error: error.message }))
        }
    })
    server.requestTimeout = maxTimeout
    // Use one socket and one actual port. Prefer IPv4 for DNS names: on IPv6
    // loopback-only Linux, clients may omit ::1 via AI_ADDRCONFIG.
    const addresses = await lookup(host, { all: true })
    const address = addresses.find(({ family }) => family === 4) ?? addresses[0]
    server.listen({ host: address.address, port, ipv6Only: false })
    await once(server, 'listening')
    return {
        server,
        address: server.address(),
        async close() {
            closing = true
            await Promise.all([...fixtures.values()].map((fixture) => fixture.stop()))
            server.closeAllConnections()
            await new Promise((done) => server.close(done))
        },
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const adapter = await startServer({
        consumer: process.env.POSTHOG_ELECTRON_CONSUMER,
        host: process.env.HOST ?? '127.0.0.1',
        port: Number(process.env.PORT ?? 8080),
    })
    process.stdout.write(JSON.stringify({ protocol, ...adapter.address }) + '\n')
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, async () => {
            await adapter.close()
            process.exitCode = 0
        })
}
