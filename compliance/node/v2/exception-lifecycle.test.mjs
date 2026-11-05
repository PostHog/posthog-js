import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const consumer = process.env.POSTHOG_NODE_CONSUMER
if (!consumer) throw new Error('Set POSTHOG_NODE_CONSUMER to an installed tarball consumer')

async function receiver(t, responseMode = 'healthy') {
    const requests = []
    const server = createServer(async (request, response) => {
        let body = ''
        for await (const chunk of request) body += chunk
        requests.push({ path: request.url, body: JSON.parse(body) })
        if (responseMode === 'stalled') return
        response.statusCode = responseMode === 'failed' ? 503 : 200
        response.setHeader('content-type', 'application/json')
        response.end('{"status":1}')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(async () => {
        server.closeAllConnections()
        await new Promise((done) => server.close(done))
    })
    return { host: `http://127.0.0.1:${server.address().port}`, requests }
}

async function runChild(t, { host, mode, format, scenario = 'fatal', enabled = true, strict = false }) {
    const load =
        format === 'esm'
            ? "await import('posthog-node')"
            : "createRequire(process.cwd() + '/package.json')('posthog-node')"
    const source = `
        import { createRequire } from 'node:module';
        const { PostHog } = ${load};
        ${scenario === 'application-handler' ? "process.on('uncaughtException', () => { setImmediate(async () => { await client.flush(); await client.shutdown(); process.disconnect(); }); });" : ''}
        const client = new PostHog('test-token', {
            host: ${JSON.stringify(host)}, enableExceptionAutocapture: ${enabled},
            flushAt: 20, flushInterval: 0, disableCompression: true, fetchRetryCount: 0
        });
        process.once('message', async () => {
            if (${JSON.stringify(scenario)} === 'restart') {
                await client.flush();
                await client.shutdown();
                process.disconnect();
            } else {
                setImmediate(function crash() { throw new TypeError('uncaught lifecycle fixture'); });
            }
        });
        process.send('ready');
    `
    const child = spawn(
        process.execPath,
        [...(strict ? ['--unhandled-rejections=strict'] : []), '--input-type=module', '--eval', source],
        {
            cwd: resolve(consumer),
            env: { ...process.env, NODE_OPTIONS: '', POSTHOG_CAPTURE_MODE: mode },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        }
    )
    t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    })
    child.stdout.resume()
    let stderr = ''
    child.stderr.on('data', (chunk) => {
        stderr += chunk
    })
    let timedOut = false
    const deadline = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
    }, 10000)
    const started = Date.now()
    const closed = once(child, 'close')
    try {
        const ready = await Promise.race([
            once(child, 'message'),
            closed.then(() => {
                throw new Error(`SDK child exited before readiness: ${stderr}`)
            }),
        ])
        assert.deepEqual(ready, ['ready', undefined])
        child.send('go')
        const [code, signal] = await closed
        assert.equal(timedOut, false, `SDK child exceeded its deadline: ${stderr}`)
        return { code, signal, stderr, durationMs: Date.now() - started }
    } finally {
        clearTimeout(deadline)
    }
}

for (const mode of ['v0', 'v1']) {
    for (const format of ['cjs', 'esm']) {
        test(`exception lifecycle ${format}/${mode}: an uncaught TypeError delivers before fatal exit`, async (t) => {
            const { host, requests } = await receiver(t)
            const result = await runChild(t, { host, mode, format })
            assert.equal(result.code, 1)
            assert.equal(result.signal, null)
            assert.match(result.stderr, /TypeError: uncaught lifecycle fixture/)
            assert.equal(requests.length, 1)
            assert.ok(requests[0].path.startsWith(mode === 'v0' ? '/batch' : '/i/v1/analytics/events'))
            assert.equal(requests[0].body.batch.length, 1)
            const event = requests[0].body.batch[0]
            assert.equal(event.event, '$exception')
            const exception = event.properties.$exception_list[0]
            assert.equal(exception.type, 'TypeError')
            assert.equal(exception.value, 'uncaught lifecycle fixture')
            assert.equal(exception.mechanism.type, 'onuncaughtexception')
            assert.equal(exception.mechanism.handled, false)
            assert.equal(exception.mechanism.synthetic, false)
            assert.equal(exception.stacktrace.frames.at(-1).function, 'Immediate.crash')
            // Fatal severity/source conformance is tracked separately in EXCEPTION_COVERAGE.md.
            assert.equal(event.properties.$exception_level, 'error')
            assert.equal(Object.hasOwn(event.properties, '$exception_source'), false)
        })

        test(`exception lifecycle ${format}/${mode}: disabled autocapture leaves the native fatal exit untouched`, async (t) => {
            const { host, requests } = await receiver(t)
            const result = await runChild(t, { host, mode, format, enabled: false })
            assert.equal(result.code, 1)
            assert.equal(result.signal, null)
            assert.match(result.stderr, /TypeError: uncaught lifecycle fixture/)
            assert.equal(requests.length, 0)
        })

        test(`exception lifecycle ${format}/${mode}: application uncaught-exception handling may continue and flush`, async (t) => {
            const { host, requests } = await receiver(t)
            const result = await runChild(t, { host, mode, format, scenario: 'application-handler' })
            assert.equal(result.code, 0)
            assert.equal(result.signal, null)
            assert.equal(requests.length, 1)
            const exception = requests[0].body.batch[0].properties.$exception_list[0]
            assert.equal(exception.type, 'TypeError')
            assert.equal(exception.mechanism.handled, false)
        })

        test(`exception lifecycle ${format}/${mode}: strict monitoring exits with no observed pre-exit delivery`, async (t) => {
            const { host, requests } = await receiver(t)
            const result = await runChild(t, { host, mode, format, strict: true })
            assert.equal(result.code, 1)
            assert.equal(result.signal, null)
            assert.match(result.stderr, /TypeError: uncaught lifecycle fixture/)
            assert.equal(requests.length, 0)
        })

        for (const responseMode of ['failed', 'stalled']) {
            test(`exception lifecycle ${format}/${mode}: ${responseMode} fatal delivery is bounded and is not replayed on restart`, async (t) => {
                const { host, requests } = await receiver(t, responseMode)
                const result = await runChild(t, { host, mode, format })
                assert.equal(result.code, 1)
                assert.equal(result.signal, null)
                assert.ok(result.durationMs < 7000, `Fatal shutdown took ${result.durationMs}ms`)
                assert.equal(requests.length, 1)
                assert.equal(requests[0].body.batch[0].event, '$exception')
                const restarted = await runChild(t, { host, mode, format, scenario: 'restart' })
                assert.equal(restarted.code, 0)
                assert.equal(restarted.signal, null)
                assert.equal(requests.length, 1)
            })
        }
    }
}
