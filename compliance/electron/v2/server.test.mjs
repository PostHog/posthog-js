import { test, mock } from 'node:test'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { Fixture, startServer, protocol } from './server.mjs'
import { mockOrigin } from './network-policy.mjs'

test(
    'hybrid runner records failure when the adapter closes both streams before startup exit',
    { skip: process.platform !== 'darwin' },
    async () => {
        const directory = await mkdtemp(join(tmpdir(), 'electron-runner-startup-'))
        const consumer = join(directory, 'consumer')
        const report = join(directory, 'report')
        const preload = join(directory, 'exit-adapter.mjs')
        try {
            await mkdir(consumer)
            await writeFile(join(consumer, 'build.json'), '{}')
            await writeFile(
                preload,
                `if (process.argv[1]?.endsWith('/server.mjs')) {
            process.stdout.destroy()
            process.stderr.destroy()
            await new Promise((resolve) => setTimeout(resolve, 50))
            process.exit(42)
        }`
            )
            const result = spawnSync(
                process.execPath,
                [
                    fileURLToPath(new URL('./run-compliance.mjs', import.meta.url)),
                    'electron-main',
                    'supplemental',
                    report,
                ],
                {
                    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
                    env: {
                        ...process.env,
                        POSTHOG_ELECTRON_CONSUMER: consumer,
                        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
                    },
                    encoding: 'utf8',
                    timeout: 2000,
                }
            )
            assert.equal(result.error, undefined, result.stderr)
            assert.equal(result.status, 1)
            assert.match(result.stderr, /Adapter exited before startup/)
            assert.equal(await readFile(join(report, 'wrapper.exit'), 'utf8'), '1\n')
            await assert.rejects(readFile(join(report, 'network-create.exit')), { code: 'ENOENT' })
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    }
)

test('mockOrigin rejects live hosts, credentials, missing ports and non-HTTP inputs', () => {
    for (const value of [
        undefined,
        null,
        'https://us.i.posthog.com',
        'http://example.invalid:8080',
        'http://127.0.0.1',
        'http://user@127.0.0.1:8080',
        'http://127.0.0.1:8080/path',
    ])
        assert.equal(mockOrigin(value, []), undefined)
    for (const host of ['127.0.0.1', '192.168.10.2', '10.2.3.4', '172.16.2.3', '[::1]'])
        assert.equal(mockOrigin(`http://${host}:8080`, []), `http://${host}:8080`)
})
test('server negotiates semantic client profiles without advertising private controls', async () => {
    const adapter = await startServer({ consumer: '/not-used-for-negotiation', port: 0 })
    try {
        const response = await fetch(`http://127.0.0.1:${adapter.address.port}/v2/negotiate`, {
            method: 'POST',
            body: JSON.stringify({ protocol }),
        })
        const value = await response.json()
        assert.equal(value.protocol, protocol)
        assert.deepEqual(
            value.profiles.map((profile) => [profile.id, profile.sdk_type, profile.fixture_capabilities]),
            [
                ['electron-main', 'client', ['storage.empty.v1']],
                ['electron-renderer', 'client', ['storage.empty.v1']],
            ]
        )
        const lossy = await fetch(`http://127.0.0.1:${adapter.address.port}/v2/negotiate`, {
            method: 'POST',
            body: `{"protocol":"${protocol}","extra":9007199254740993}`,
        })
        assert.equal(lossy.status, 400)
    } finally {
        await adapter.close()
    }
})
test(
    'real Electron fixture rejects live hosts, preserves precision failures and bounds lifecycle',
    { skip: !process.env.POSTHOG_ELECTRON_CONSUMER },
    async () => {
        const adapter = await startServer({ consumer: process.env.POSTHOG_ELECTRON_CONSUMER, port: 0 })
        const signals = []
        const originalKill = process.kill
        const kill = mock.method(process, 'kill', (...args) => {
            signals.push(args[0])
            return originalKill(...args)
        })
        const request = async (path, body) => {
            const response = await fetch(`http://127.0.0.1:${adapter.address.port}${path}`, {
                method: 'POST',
                body: typeof body === 'string' ? body : JSON.stringify(body),
            })
            return { status: response.status, value: await response.json() }
        }
        try {
            const deadline = await request('/v2/fixtures/allocate', {
                fixture_id: 'deadline',
                case_id: 'server.test.mjs',
                profile_id: 'electron-main',
                timeout_ms: 1,
            })
            assert.equal(deadline.status, 400)
            assert.match(deadline.value.error, /deadline/)
            for (const profile of ['electron-main', 'electron-renderer']) {
                const fixture_id = profile
                const base = { fixture_id, timeout_ms: 15000 }
                assert.equal(
                    (
                        await request('/v2/fixtures/allocate', {
                            ...base,
                            case_id: 'server.test.mjs',
                            profile_id: profile,
                        })
                    ).status,
                    200
                )
                const blocked = await request('/v2/invoke', {
                    ...base,
                    call_id: `${profile}-live`,
                    route: '/setup',
                    args: { project_token: 'not-live', config: { host: 'https://us.i.posthog.com' } },
                })
                assert.equal(blocked.value.completion.failure.code, 'mock-host-required')
                const lossy = await request(
                    '/v2/invoke',
                    `{"fixture_id":"${fixture_id}","timeout_ms":15000,"call_id":"${profile}-precision","route":"/capture","args":{"event":"lossy","properties":{"n":9007199254740993}}}`
                )
                assert.equal(lossy.value.completion.failure.code, 'number-representation')
                assert.equal((await request('/v2/fixtures/close', base)).status, 200)
                const count = signals.length
                assert.equal((await request('/v2/fixtures/close', base)).status, 400)
                assert.equal(signals.length, count)
                assert.equal(
                    (await request('/v2/fixtures/allocate', { ...base, case_id: 'duplicate', profile_id: profile }))
                        .status,
                    400
                )
            }
        } finally {
            try {
                await adapter.close()
                await adapter.close()
                assert.equal(new Set(signals).size, signals.length, 'never signal a retired process group again')
            } finally {
                kill.mock.restore()
            }
        }
    }
)

test('fixture stop is idempotent and never signals an already exited process group', async () => {
    const signals = []
    const child = Object.assign(new EventEmitter(), { pid: 424242, exitCode: null, signalCode: null })
    const kill = mock.method(process, 'kill', (pid, signal) => {
        signals.push([pid, signal])
        child.exitCode = 0
        queueMicrotask(() => child.emit('exit', 0))
        return true
    })
    const fixture = Object.assign(Object.create(Fixture.prototype), {
        child,
        lines: { close() {} },
        directory: await mkdtemp(join(tmpdir(), 'electron-stop-unit-')),
    })
    try {
        await Promise.all([fixture.stop(), fixture.stop()])
        await fixture.stop()
        assert.deepEqual(signals, [[-424242, 'SIGKILL']])
        const exited = Object.assign(Object.create(Fixture.prototype), {
            child: Object.assign(new EventEmitter(), { pid: 424243, exitCode: 0, signalCode: null }),
            lines: { close() {} },
            directory: await mkdtemp(join(tmpdir(), 'electron-exited-unit-')),
        })
        await exited.stop()
        assert.equal(signals.length, 1)
    } finally {
        kill.mock.restore()
    }
})

test('mockOrigin restricts private hosts to an explicit allowlist when one is configured', () => {
    const allowed = ['192.168.97.2']
    assert.equal(mockOrigin('http://192.168.97.2:41234', allowed), 'http://192.168.97.2:41234')
    for (const host of ['127.0.0.1', 'localhost', '[::1]', '10.2.3.4', '192.168.97.3'])
        assert.equal(mockOrigin(`http://${host}:8765`, allowed), undefined, host)
})

test(
    'real Electron fixture rejects loopback services outside the runner mock allowlist',
    { skip: !process.env.POSTHOG_ELECTRON_CONSUMER },
    async () => {
        const previous = process.env.POSTHOG_ELECTRON_MOCK_HOSTS
        process.env.POSTHOG_ELECTRON_MOCK_HOSTS = '10.77.1.2'
        const adapter = await startServer({ consumer: process.env.POSTHOG_ELECTRON_CONSUMER, port: 0 })
        const request = async (path, body) =>
            (
                await fetch(`http://127.0.0.1:${adapter.address.port}${path}`, {
                    method: 'POST',
                    body: JSON.stringify({ protocol, timeout_ms: 15000, ...body }),
                })
            ).json()
        try {
            await request('/v2/fixtures/allocate', {
                fixture_id: 'allow',
                case_id: 'allowlist',
                profile_id: 'electron-main',
            })
            const blocked = await request('/v2/invoke', {
                fixture_id: 'allow',
                call_id: 'loopback',
                route: '/setup',
                args: { project_token: 'phc_test_key', config: { host: 'http://127.0.0.1:8765' } },
            })
            assert.equal(blocked.completion.failure.code, 'mock-host-required')
            await request('/v2/fixtures/close', { fixture_id: 'allow' })
        } finally {
            await adapter.close()
            if (previous === undefined) delete process.env.POSTHOG_ELECTRON_MOCK_HOSTS
            else process.env.POSTHOG_ELECTRON_MOCK_HOSTS = previous
        }
    }
)
