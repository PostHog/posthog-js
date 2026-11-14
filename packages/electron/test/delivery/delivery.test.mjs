import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect } from 'node:net'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import electron from 'electron'

const fixture = fileURLToPath(new URL('./fixture.cjs', import.meta.url))
async function listen(server) {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    return server.address().port
}
async function setup(t) {
    const directory = await mkdtemp(join(tmpdir(), 'electron-delivery-'))
    const processes = []
    t.after(async () => {
        await Promise.all(processes.map((kill) => kill()))
        await rm(directory, { recursive: true, force: true, maxRetries: 5 })
    })
    const storage = join(directory, 'storage')
    let instance = 0
    async function launch(host, config = {}) {
        const userData = join(directory, `app-${++instance}`)
        await mkdir(userData)
        const child = spawn(electron, [fixture, JSON.stringify({ host, storage, userData, ...config })], {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
            stdio: ['pipe', 'pipe', 'pipe'],
        })
        const exited = new Promise((resolve) => child.once('exit', resolve))
        let diagnostic = '',
            sequence = 0
        child.stderr.on('data', (data) => {
            diagnostic += data
        })
        const pending = new Map()
        let readyResolve
        const ready = new Promise((resolve) => {
            readyResolve = resolve
        })
        createInterface({ input: child.stdout }).on('line', (line) => {
            if (!line.startsWith('DELIVERY:')) return
            const value = JSON.parse(line.slice(9))
            if (value.ready || value.fatal) readyResolve(value)
            else {
                pending.get(value.id)?.(value)
                pending.delete(value.id)
            }
        })
        const bounded = (promise) =>
            Promise.race([
                promise,
                new Promise((_, reject) => {
                    const timer = setTimeout(
                        () => reject(new Error(`Electron fixture timed out: ${diagnostic}`)),
                        15000
                    )
                    timer.unref()
                    promise.finally(() => clearTimeout(timer))
                }),
                exited.then((code) => {
                    throw new Error(`Electron fixture exited ${code}: ${diagnostic}`)
                }),
            ])
        const kill = async () => {
            if (child.exitCode === null) child.kill('SIGKILL')
            await exited
        }
        processes.push(kill)
        const initial = await bounded(ready)
        assert.equal(initial.fatal, undefined)
        return {
            initial,
            exited,
            kill,
            async command(command, ...args) {
                const id = ++sequence
                const response = new Promise((resolve) => pending.set(id, resolve))
                child.stdin.write(JSON.stringify({ id, command, args }) + '\n')
                return bounded(response)
            },
        }
    }
    async function state() {
        const namespaces = await readdir(storage)
        return JSON.parse(await readFile(join(storage, namespaces[0], 'state.json'), 'utf8')).values
    }
    async function ageQueue() {
        const namespaces = await readdir(storage)
        const file = join(storage, namespaces[0], 'state.json')
        const stored = JSON.parse(await readFile(file, 'utf8'))
        for (const item of stored.values.queue)
            item.message.timestamp = new Date(Date.now() - 8 * 86400000).toISOString()
        await writeFile(file, JSON.stringify(stored))
    }
    return { directory, storage, launch, state, ageQueue }
}

async function ingestion(t, status = 200) {
    const received = []
    let requests = 0
    const server = createServer(async (req, res) => {
        requests++
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks))
        if (body.batch) received.push(...body.batch)
        res.writeHead(status, {
            'Content-Type': 'application/json',
            ...(status === 429 ? { 'Retry-After': '60' } : {}),
        })
        res.end('{}')
    })
    const port = await listen(server)
    t.after(() => {
        server.closeAllConnections()
        server.close()
    })
    return { server, port, received, requests: () => requests, host: `http://127.0.0.1:${port}` }
}

test(
    'idle native app.quit releases ownership without SDK shutdown or reclaim tombstones',
    { timeout: 30000 },
    async (t) => {
        const { launch, storage } = await setup(t)
        const target = await ingestion(t)
        const first = await launch(target.host)
        assert.deepEqual(first.initial.errors, [])
        const identity = first.initial.state.distinctId
        const [namespace] = await readdir(storage)
        const files = () => readdir(join(storage, namespace))
        assert.ok((await files()).includes('.owner'))
        await first.command('quit')
        assert.equal(await first.exited, 0)
        assert.deepEqual(await files(), ['state.json'])
        const next = await launch(target.host)
        assert.deepEqual(next.initial.errors, [])
        assert.equal(next.initial.state.distinctId, identity)
        assert.deepEqual((await files()).sort(), ['.owner', 'state.json'])
        await next.command('quit')
        assert.equal(await next.exited, 0)
        assert.deepEqual(await files(), ['state.json'])
    }
)

test(
    'native quit after a non-awaited optOut keeps the user opted out after relaunch',
    { timeout: 30000 },
    async (t) => {
        const { launch, state } = await setup(t)
        const target = await ingestion(t)
        const first = await launch(target.host)
        assert.equal(first.initial.state.optedOut, false)
        await first.command('optOutThenQuit')
        assert.equal(await first.exited, 0)
        assert.equal((await state()).opted_out, true)
        const next = await launch(target.host)
        assert.equal(next.initial.state.optedOut, true)
        await next.command('capture', 'must-not-send')
        await next.command('flush')
        assert.deepEqual(target.received, [])
        await next.command('quit')
        assert.equal(await next.exited, 0)
    }
)

test('native cancelled quit retains ownership and a usable client', { timeout: 30000 }, async (t) => {
    const { launch, storage } = await setup(t)
    const target = await ingestion(t)
    const owner = await launch(target.host)
    const [namespace] = await readdir(storage)
    const lock = join(storage, namespace, '.owner')
    const before = await readFile(lock, 'utf8')
    await owner.command('cancelQuit')
    const captured = await owner.command('capture', 'after-native-cancel')
    assert.equal(captured.error, undefined)
    assert.equal(await readFile(lock, 'utf8'), before)
    assert.equal((await owner.command('flush')).error, undefined)
    assert.deepEqual(
        target.received.map(({ event }) => event),
        ['after-native-cancel']
    )
    await owner.command('quit')
    assert.equal(await owner.exited, 0)
})

test(
    'offline -> forced exit -> restart recovers persisted UUID and original identities',
    { timeout: 45000 },
    async (t) => {
        const { launch, state } = await setup(t)
        const target = await ingestion(t)
        await new Promise((resolve) => target.server.close(resolve))
        const first = await launch(target.host)
        const anonymous = first.initial.state.distinctId
        await first.command('capture', 'before-identify')
        await first.command('identify', 'fixture-person')
        await first.command('capture', 'after-identify')
        assert.match((await first.command('flush')).error, /Error/)
        const persisted = (await state()).queue.map(({ message }) => message)
        assert.ok(persisted.length >= 3)
        await first.kill()
        await new Promise((resolve) => target.server.listen(target.port, '127.0.0.1', resolve))
        const second = await launch(target.host)
        assert.equal(second.initial.state.distinctId, 'fixture-person')
        assert.equal((await second.command('flush')).error, undefined)
        assert.deepEqual(
            target.received.map(({ uuid }) => uuid),
            persisted.map(({ uuid }) => uuid)
        )
        assert.equal(target.received.find(({ event }) => event === 'before-identify').distinct_id, anonymous)
        assert.equal(target.received.find(({ event }) => event === 'after-identify').distinct_id, 'fixture-person')
        assert.deepEqual((await state()).queue, [])
        await second.command('exit')
    }
)

test(
    'exclusive ownership blocks second process entirely; competing reclaimers cannot overwrite after owner death',
    { timeout: 45000 },
    async (t) => {
        const { launch, state } = await setup(t)
        const target = await ingestion(t)
        const owner = await launch(target.host)
        await owner.command('capture', 'owned')
        const before = await state()
        const denied = await launch(target.host)
        assert.equal(denied.initial.state.optedOut, true)
        assert.equal(denied.initial.state.distinctId, '')
        assert.ok(denied.initial.errors.length)
        await denied.command('optIn')
        await denied.command('identify', 'intruder')
        await denied.command('capture', 'unowned')
        await denied.command('reloadFeatureFlagsAsync')
        await denied.command('flush')
        assert.equal(target.requests(), 0)
        assert.deepEqual(await state(), before)
        await owner.kill()
        const contenders = await Promise.all([launch(target.host), launch(target.host)])
        const winners = contenders.filter(({ initial }) => initial.state.distinctId === before.anonymous_id)
        assert.equal(winners.length, 1)
        const winner = winners[0]
        await winner.command('flush')
        assert.deepEqual(
            target.received.map(({ event }) => event),
            ['owned']
        )
        await winner.command('exit')
        const next = await launch(target.host)
        assert.equal(next.initial.state.distinctId, before.anonymous_id)
        await next.command('exit')
    }
)

test('independent explicit storageDirectory allows two active instances', { timeout: 30000 }, async (t) => {
    const { launch, directory } = await setup(t)
    const target = await ingestion(t)
    const first = await launch(target.host)
    const second = await launch(target.host, { storage: join(directory, 'independent') })
    assert.notEqual(first.initial.state.distinctId, second.initial.state.distinctId)
    await first.command('capture', 'first')
    await second.command('capture', 'second')
    await first.command('flush')
    await second.command('flush')
    assert.deepEqual(target.received.map(({ event }) => event).sort(), ['first', 'second'])
})

test('429 outage backpressure bounds stored queue and immediate retries', { timeout: 30000 }, async (t) => {
    const { launch, state } = await setup(t)
    const target = await ingestion(t, 429)
    const owner = await launch(target.host, { options: { flushAt: 5, maxQueueSize: 5, maxStorageBytes: 10000 } })
    for (let i = 0; i < 30; i++) {
        await owner.command('capture', `outage-${i}`)
        await owner.command('flush')
    }
    assert.equal(target.requests(), 1, 'Retry-After suppresses repeated explicit flush network attempts')
    assert.equal((await state()).queue.length, 5)
    await owner.command('exit', 10)
})

test(
    'interrupted shutdown leaves unsent data recoverable after real process restart',
    { timeout: 30000 },
    async (t) => {
        const { launch, state } = await setup(t)
        let startedResolve
        const started = new Promise((resolve) => {
            startedResolve = resolve
        })
        const server = createServer((req) => {
            req.resume()
            startedResolve()
        })
        const port = await listen(server)
        t.after(() => {
            server.closeAllConnections()
            server.close()
        })
        const host = `http://127.0.0.1:${port}`
        const owner = await launch(host)
        await owner.command('capture', 'interrupted')
        const uuid = (await state()).queue[0].message.uuid
        const shutdown = owner.command('shutdown', 15000).catch(() => {})
        await started
        await owner.kill()
        await shutdown
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
        const received = []
        const recovery = createServer(async (req, res) => {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            received.push(...JSON.parse(Buffer.concat(chunks)).batch)
            res.end('{}')
        })
        await new Promise((resolve) => recovery.listen(port, '127.0.0.1', resolve))
        t.after(() => {
            recovery.closeAllConnections()
            recovery.close()
        })
        const next = await launch(host)
        await next.command('flush')
        assert.equal(received[0].uuid, uuid)
    }
)

test(
    'authenticated proxy is unsupported but 407 retains UUIDs for configuration recovery',
    { timeout: 30000 },
    async (t) => {
        const { launch, state } = await setup(t)
        const received = []
        let challenges = 0,
            authRequired = true
        const proxy = createServer(async (req, res) => {
            if (authRequired) {
                challenges++
                res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="delivery-fixture"' })
                res.end()
                return
            }
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            received.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks)) })
            res.end('{}')
        })
        const port = await listen(proxy)
        t.after(() => {
            proxy.closeAllConnections()
            proxy.close()
        })
        const owner = await launch('http://posthog.invalid', { proxy: `http=127.0.0.1:${port}`, proxyAuth: true })
        await owner.command('capture', 'authenticated-proxy')
        const uuid = (await state()).queue[0].message.uuid
        const result = await owner.command('flush')
        assert.match(result.error, /status=407/)
        assert.ok(challenges >= 1)
        assert.equal((await state()).queue[0].message.uuid, uuid)
        await owner.kill()
        authRequired = false
        const recovered = await launch('http://posthog.invalid', { proxy: `http=127.0.0.1:${port}` })
        assert.equal((await recovered.command('flush')).error, undefined)
        assert.equal(received[0].body.batch[0].uuid, uuid)
        assert.equal(received[0].url, 'http://posthog.invalid/batch/')
        assert.equal(received[0].body.batch[0].event, 'authenticated-proxy')
    }
)

test('Electron routes HTTP through the host-configured isolated-session proxy', { timeout: 30000 }, async (t) => {
    const { launch } = await setup(t)
    const received = []
    const proxy = createServer(async (req, res) => {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        received.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks)) })
        res.end('{}')
    })
    const port = await listen(proxy)
    t.after(() => {
        proxy.closeAllConnections()
        proxy.close()
    })
    const owner = await launch('http://posthog.invalid', { proxy: `http=127.0.0.1:${port}` })
    await owner.command('capture', 'http-proxy')
    assert.equal((await owner.command('flush')).error, undefined)
    assert.equal(received[0].url, 'http://posthog.invalid/batch/')
    assert.equal(received[0].body.batch[0].event, 'http-proxy')
})

test(
    'Electron rejects untrusted TLS through CONNECT proxy without certificate overrides',
    { timeout: 30000 },
    async (t) => {
        const { launch, directory, state } = await setup(t)
        execFileSync(
            'openssl',
            [
                'req',
                '-x509',
                '-newkey',
                'rsa:2048',
                '-nodes',
                '-days',
                '1',
                '-subj',
                '/CN=localhost',
                '-keyout',
                join(directory, 'key.pem'),
                '-out',
                join(directory, 'cert.pem'),
            ],
            { stdio: 'ignore' }
        )
        let hits = 0,
            tunnels = 0
        const tls = createHttpsServer(
            { key: await readFile(join(directory, 'key.pem')), cert: await readFile(join(directory, 'cert.pem')) },
            (_req, res) => {
                hits++
                res.end('{}')
            }
        )
        const tlsPort = await listen(tls)
        t.after(() => {
            tls.closeAllConnections()
            tls.close()
        })
        const sockets = new Set()
        const proxy = createServer()
        proxy.on('connect', (req, client, head) => {
            tunnels++
            assert.equal(req.url, `localhost:${tlsPort}`)
            const upstream = connect(tlsPort, '127.0.0.1', () => {
                client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
                upstream.write(head)
                client.pipe(upstream)
                upstream.pipe(client)
            })
            sockets.add(client)
            sockets.add(upstream)
            client.on('error', () => upstream.destroy())
            upstream.on('error', () => client.destroy())
        })
        const proxyPort = await listen(proxy)
        t.after(() => {
            for (const socket of sockets) socket.destroy()
            proxy.close()
        })
        const owner = await launch(`https://localhost:${tlsPort}`, { proxy: `https=127.0.0.1:${proxyPort}` })
        await owner.command('capture', 'tls-protected')
        assert.match((await owner.command('flush')).error, /Error/)
        assert.ok(tunnels >= 1)
        assert.equal(hits, 0)
        assert.equal((await state()).queue[0].message.event, 'tls-protected')
    }
)

test(
    'deferred storage initialization is cancelled within shutdown budget in a real Electron process',
    { timeout: 30000 },
    async (t) => {
        const { launch, storage } = await setup(t)
        const target = await ingestion(t)
        const owner = await launch(target.host, { deferStorage: true })
        assert.equal(owner.initial.state.distinctId, '')
        assert.equal(owner.initial.errors.length, 1)
        assert.match(owner.initial.errors[0], /shutdown timed out/)
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert.equal(target.requests(), 0)
        const namespaces = await readdir(storage)
        assert.equal(namespaces.length, 1)
        assert.deepEqual(await readdir(join(storage, namespaces[0])), [])
    }
)

test('long-outage restart discards expired events without losing persisted identity', { timeout: 30000 }, async (t) => {
    const { launch, state, ageQueue } = await setup(t)
    const target = await ingestion(t, 503)
    const owner = await launch(target.host)
    await owner.command('identify', 'long-outage-person')
    await owner.command('capture', 'expired-offline-event')
    await owner.command('flush')
    await owner.kill()
    // Controlled clock aging on a stopped process models eight days without waiting or live credentials.
    await ageQueue()
    const next = await launch(target.host)
    assert.equal(next.initial.state.distinctId, 'long-outage-person')
    const previousRequests = target.requests()
    await next.command('flush')
    assert.equal(target.requests(), previousRequests)
    assert.deepEqual((await state()).queue, [])
})

test(
    'configured immediate retries are bounded and later flushes respect outage backoff',
    { timeout: 30000 },
    async (t) => {
        const { launch, state } = await setup(t)
        const target = await ingestion(t, 503)
        const owner = await launch(target.host, { options: { fetchRetryCount: 2, fetchRetryDelay: 10 } })
        await owner.command('capture', 'retry-budget')
        const uuid = (await state()).queue[0].message.uuid
        assert.match((await owner.command('flush')).error, /status=503/)
        assert.equal(target.requests(), 3)
        assert.deepEqual(
            target.received.map((message) => message.uuid),
            [uuid, uuid, uuid]
        )
        await owner.command('flush')
        assert.equal(target.requests(), 3)
        assert.equal((await state()).queue[0].message.uuid, uuid)
    }
)
