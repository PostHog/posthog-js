import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const runner = fileURLToPath(new URL('./run-compliance.mjs', import.meta.url))
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function controlledRun(t, scenario) {
    const directory = await mkdtemp(join(tmpdir(), 'electron-runner-regression-'))
    const consumer = join(directory, 'consumer')
    const report = join(directory, 'report')
    const preload = join(directory, 'adapter.mjs')
    const dockerLog = join(directory, 'docker.jsonl')
    await mkdir(consumer)
    await writeFile(join(consumer, 'build.json'), '{}')
    const ownedSockets = new Set()
    const control = createServer((socket) => {
        ownedSockets.add(socket)
        socket.on('error', () => {})
        socket.on('close', () => ownedSockets.delete(socket))
        socket.resume()
    })
    control.listen(0, '127.0.0.1')
    await once(control, 'listening')
    await writeFile(
        preload,
        `
if (process.argv[1]?.endsWith('/server.mjs')) {
    const { spawn } = await import('node:child_process')
    const { connect } = await import('node:net')
    const control = connect(${control.address().port}, '127.0.0.1')
    control.on('data', () => process.exit(0))
    if (${JSON.stringify(scenario)} === 'pipes') {
        spawn(process.execPath, ['-e', \`const s = require('node:net').connect(${control.address().port}, '127.0.0.1'); s.on('data', () => process.exit(0)); setInterval(() => {}, 1000)\`], { stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '' } })
        setTimeout(() => process.exit(42), 100)
    } else if (${JSON.stringify(scenario)} === 'early') {
        process.stderr.write('underlying-startup-diagnostic\\n')
        process.exit(42)
    } else {
        process.stdout.write(JSON.stringify({ port: 12345 }) + '\\n')
        setInterval(() => {}, 1000)
        process.on('SIGTERM', () => process.exit(0))
    }
    await new Promise(() => {})
}
`
    )
    const bin = join(directory, 'bin')
    await mkdir(bin)
    await writeFile(
        join(bin, 'docker'),
        `#!${process.execPath}
const fs = require('node:fs');
const control = require('node:net').connect(${control.address().port}, '127.0.0.1');
control.unref(); control.on('data', () => process.exit(0));
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(dockerLog)}, JSON.stringify(args) + '\\n');
if (args[0] === 'network' && args[1] === 'create' && ${JSON.stringify(scenario)} === 'create') setInterval(() => {}, 1000);
else if (args[0] === 'network' && args[1] === 'create' && ${JSON.stringify(scenario)} === 'oversize') fs.writeSync(1, Buffer.alloc(51 * 1024 * 1024, 'x'));
else if (args[0] === 'run' && args.includes('--name')) {
    if (['create', 'run'].includes(${JSON.stringify(scenario)})) setInterval(() => {}, 1000);
    else {
        fs.writeFileSync(${JSON.stringify(join(report, 'report.json'))}, JSON.stringify({
            inventory: [{ selected: ${scenario !== 'zero-selected'}, applicability: { kind: 'applicable' } }],
            results: [{ result: { executed: ${scenario !== 'zero-executed'} } }]
        }));
        process.exitCode = ${scenario === 'run-failed' ? 7 : 0};
    }
} else if (args.includes('check-report')) process.exitCode = ${scenario === 'strict-failed' ? 9 : 0};
else if (args[0] === 'ps') console.log('controlled-container');
`,
        { mode: 0o755 }
    )
    const child = spawn(process.execPath, [runner, 'electron-main', 'supplemental', report], {
        env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            POSTHOG_ELECTRON_CONSUMER: consumer,
            NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (data) => {
        stderr += data
    })
    child.stdout.resume()
    const exit = once(child, 'exit')
    t.after(async () => {
        const sockets = [...ownedSockets]
        const released = Promise.all(
            sockets.map((socket) => {
                const closed = new Promise((done) => socket.once('close', done))
                if (!socket.destroyed && !socket.readableEnded && !socket.writableEnded) socket.write('stop')
                return closed
            })
        )
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
        await Promise.race([exit, delay(1000)])
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        await Promise.race([released, delay(1000)])
        const cooperativelyClosed = sockets.every((socket) => socket.destroyed)
        for (const socket of ownedSockets) socket.destroy()
        await new Promise((resolve) => control.close(resolve))
        await rm(directory, { recursive: true, force: true })
        assert.ok(cooperativelyClosed, 'test-owned descendants must acknowledge cooperative release')
    })
    return {
        child,
        report,
        stderr: () => stderr,
        async finished() {
            return Promise.race([
                exit,
                delay(2000).then(() => {
                    throw new Error('runner failed bounded cleanup')
                }),
            ])
        },
        async commands() {
            return (await readFile(dockerLog, 'utf8')).trim().split('\n').map(JSON.parse)
        },
        async waitCommand() {
            for (let i = 0; i < 200; i++) {
                try {
                    if ((await readFile(dockerLog, 'utf8')).includes(scenario === 'create' ? 'create' : '--name'))
                        return
                } catch {}
                await delay(10)
            }
            throw new Error('controlled command did not start')
        },
    }
}

test(
    'runner retains diagnostics for a real adapter exiting before readiness',
    { skip: process.platform !== 'darwin' },
    async (t) => {
        const run = await controlledRun(t, 'early')
        assert.deepEqual(await run.finished(), [1, null], run.stderr())
        assert.match(await readFile(join(run.report, 'adapter.log'), 'utf8'), /underlying-startup-diagnostic/)
        assert.equal(await readFile(join(run.report, 'wrapper.exit'), 'utf8'), '1\n')
    }
)

test(
    'runner bounds cleanup when an exited adapter descendant holds both output pipes',
    { skip: process.platform !== 'darwin' },
    async (t) => {
        const run = await controlledRun(t, 'pipes')
        assert.deepEqual(await run.finished(), [1, null], run.stderr())
        assert.equal(await readFile(join(run.report, 'wrapper.exit'), 'utf8'), '1\n')
    }
)

for (const scenario of ['create', 'run'])
    for (const [signal, code] of [
        ['SIGINT', 130],
        ['SIGTERM', 143],
    ]) {
        test(
            `runner persists ${signal} cancellation and cleans only owned resources during ${scenario}`,
            { skip: process.platform !== 'darwin' },
            async (t) => {
                const run = await controlledRun(t, scenario)
                await run.waitCommand()
                run.child.kill(signal)
                assert.deepEqual(await run.finished(), [code, null], run.stderr())
                assert.equal(await readFile(join(run.report, 'wrapper.exit'), 'utf8'), `${code}\n`)
                const commands = await run.commands()
                const network = commands.find((args) => args[0] === 'network' && args[1] === 'create')[2]
                assert.match(network, /^electron-compliance-[0-9a-f-]{36}$/)
                assert.ok(commands.some((args) => args.join(' ') === `network rm ${network}`))
                for (const args of commands.filter((args) => args[0] === 'rm'))
                    assert.deepEqual(args, ['rm', '--force', `${network}-harness`])
                assert.equal(
                    await readFile(
                        join(run.report, `${scenario === 'create' ? 'network-create' : 'run'}.exit`),
                        'utf8'
                    ),
                    `${code}\n`
                )
            }
        )
    }

for (const [scenario, code, runExit, checkExit] of [
    ['success', 0, 0, 0],
    ['run-failed', 1, 7, 0],
    ['strict-failed', 1, 0, 9],
    ['zero-selected', 1, 0, 0],
    ['zero-executed', 1, 0, 0],
]) {
    test(
        `runner retains raw exits and honest selection gate: ${scenario}`,
        { skip: process.platform !== 'darwin' },
        async (t) => {
            const run = await controlledRun(t, scenario)
            assert.deepEqual(await run.finished(), [code, null], run.stderr())
            assert.equal(await readFile(join(run.report, 'wrapper.exit'), 'utf8'), `${code}\n`)
            assert.equal(await readFile(join(run.report, 'run.exit'), 'utf8'), `${runExit}\n`)
            assert.equal(await readFile(join(run.report, 'check-report.exit'), 'utf8'), `${checkExit}\n`)
            const counts = JSON.parse(await readFile(join(run.report, 'counts.json'), 'utf8'))
            assert.equal(counts.selected, scenario === 'zero-selected' ? 0 : 1)
            assert.equal(counts.executed, scenario === 'zero-executed' ? 0 : 1)
        }
    )
}

test('runner retains the 50 MiB command output bound', { skip: process.platform !== 'darwin' }, async (t) => {
    const run = await controlledRun(t, 'oversize')
    assert.deepEqual(await run.finished(), [1, null], run.stderr())
    assert.equal(await readFile(join(run.report, 'network-create.exit'), 'utf8'), '1\n')
    assert.ok((await readFile(join(run.report, 'network-create.log'))).length <= 50 * 1024 * 1024)
})
