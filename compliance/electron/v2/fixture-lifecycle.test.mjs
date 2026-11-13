import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Fixture, startServer } from './server.mjs'
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Real owned subprocesses speaking the fixture protocol; not a native Electron runtime assertion.
async function controlledConsumer(t, orphan = false) {
    const directory = await mkdtemp(join(tmpdir(), 'electron-lifetime-'))
    const sockets = new Map()
    const control = createServer((socket) => {
        socket.setEncoding('utf8')
        socket.once('data', (data) => {
            const identity = JSON.parse(data)
            sockets.set(identity.profile, { socket, directory: identity.directory, closed: false })
            socket.once('close', () => {
                sockets.get(identity.profile).closed = true
            })
            socket.write('ready')
        })
        socket.on('error', () => {})
        socket.resume()
    })
    control.listen(0, '127.0.0.1')
    await once(control, 'listening')
    await mkdir(join(directory, 'node_modules', 'electron'), { recursive: true })
    const program = join(directory, 'runtime.cjs')
    await writeFile(join(directory, 'package.json'), '{}')
    await writeFile(
        join(directory, 'node_modules', 'electron', 'index.js'),
        `module.exports = ${JSON.stringify(program)}`
    )
    await writeFile(
        join(directory, 'build.json'),
        JSON.stringify({
            electron: 'controlled-runtime',
            renderer_binding_sha256: createHash('sha256')
                .update(await readFile(new URL('./binding.mjs', import.meta.url)))
                .digest('hex'),
        })
    )
    await writeFile(
        program,
        `#!${process.execPath}
const fs = require('node:fs');
const net = require('node:net');
const profile = process.env.POSTHOG_ELECTRON_PROFILE;
const socket = net.connect(${control.address().port}, '127.0.0.1', () => socket.write(JSON.stringify({ profile, directory: process.env.POSTHOG_ELECTRON_USER_DATA })));
socket.on('data', data => {
    if (data.toString() === 'stop') process.exit(0);
    else fs.writeSync(3, JSON.stringify({ ready: true, runtime: { electron: profile === 'electron-renderer' ? 'wrong-runtime' : 'controlled-runtime' } }) + '\\n');
});
if (${orphan}) {
    const { spawn } = require('node:child_process');
    spawn(process.execPath, ['-e', \`const s = require('node:net').connect(${control.address().port}, '127.0.0.1', () => s.write(JSON.stringify({ profile: 'descendant', directory: process.env.POSTHOG_ELECTRON_USER_DATA }))); s.on('data', data => { if (data.toString() === 'stop') process.exit(0) }); setInterval(() => {}, 1000)\`], { stdio: 'ignore' });
    setTimeout(() => process.exit(0), 100);
} else require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
    const message = JSON.parse(line);
    fs.writeSync(3, JSON.stringify(message.close ? { closed: true } : { completion: { kind: 'sdk', outcome: { kind: 'void' } } }) + '\\n');
});
`,
        { mode: 0o755 }
    )
    t.after(async () => {
        const live = [...sockets.values()].filter((fixture) => !fixture.closed)
        const released = Promise.all(
            live.map(({ socket }) => {
                const closed = new Promise((done) => socket.once('close', done))
                if (!socket.destroyed && !socket.readableEnded && !socket.writableEnded) socket.write('stop')
                return closed
            })
        )
        await Promise.race([released, delay(1000)])
        const cooperativelyClosed = live.every((fixture) => fixture.closed)
        for (const { socket } of sockets.values()) socket.destroy()
        await new Promise((resolve) => control.close(resolve))
        await rm(directory, { recursive: true, force: true })
        assert.ok(cooperativelyClosed, 'test-owned descendants must acknowledge cooperative release')
    })
    return {
        directory,
        sockets,
        async wait(profile, predicate = () => true) {
            for (let i = 0; i < 100; i++) {
                if (sockets.has(profile) && predicate(sockets.get(profile))) return sockets.get(profile)
                await delay(10)
            }
            throw new Error(`Owned ${profile} did not reach expected lifetime state`)
        },
    }
}

test('runtime mismatch immediately removes only the rejected real fixture allocation', async (t) => {
    const consumer = await controlledConsumer(t)
    const adapter = await startServer({ consumer: consumer.directory, port: 0 })
    t.after(() => adapter.close())
    const request = async (path, body) => {
        const response = await fetch(`http://127.0.0.1:${adapter.address.port}${path}`, {
            method: 'POST',
            body: JSON.stringify(body),
        })
        return { status: response.status, body: await response.json() }
    }
    const allocate = (fixture_id, profile_id) =>
        request('/v2/fixtures/allocate', { fixture_id, profile_id, case_id: 'runtime-negative', timeout_ms: 3000 })
    assert.equal((await allocate('healthy', 'electron-main')).status, 200)
    const rejected = await allocate('rejected', 'electron-renderer')
    assert.equal(rejected.status, 400)
    assert.match(rejected.body.error, /Unexpected Electron runtime/)
    const bad = await consumer.wait('electron-renderer', (fixture) => fixture.closed)
    await assert.rejects(access(bad.directory), { code: 'ENOENT' })
    const base = { fixture_id: 'rejected', timeout_ms: 3000 }
    assert.match(
        (await request('/v2/invoke', { ...base, call_id: 'bad', route: '/flush', args: {} })).body.error,
        /Unknown fixture_id/
    )
    assert.equal(consumer.sockets.get('electron-main').closed, false)
    assert.equal(
        (await request('/v2/invoke', { ...base, fixture_id: 'healthy', call_id: 'healthy', route: '/flush', args: {} }))
            .status,
        200
    )
})

test('retired fixture leader leaves ambiguous descendants untouched rather than signaling a stale group (BLOCKED cleanup)', async (t) => {
    const consumer = await controlledConsumer(t, true)
    const fixture = new Fixture(consumer.directory, 'electron-main')
    t.after(() => fixture.stop())
    await fixture.exchange(null, 3000)
    await consumer.wait('descendant')
    if (fixture.child.exitCode === null) await once(fixture.child, 'exit')
    await fixture.stop()
    assert.equal(
        consumer.sockets.get('descendant').closed,
        false,
        'ownership is ambiguous after leader exit; test owner releases it cooperatively'
    )
})
