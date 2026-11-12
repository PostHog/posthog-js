import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../package.json', import.meta.url))
const electron = process.env.ELECTRON_BINARY ?? require('electron')
const directory = await mkdtemp(join(tmpdir(), 'posthog-electron-errors-'))
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
function run(command, args, options = {}) {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000, ...options })
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
    return result
}
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS
let passed = false
try {
    for (const name of ['types', 'core', 'browser-common', 'electron']) {
        run(pnpm, ['pack', '--out', join(directory, `${name}.tgz`)], { cwd: join(root, '..', name) })
    }
    await cp(new URL('./error-autocapture/', import.meta.url), directory, { recursive: true })
    await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({
            name: 'electron-error-autocapture-consumer',
            private: true,
            version: '1.0.0',
            main: 'main.cjs',
            packageManager: 'pnpm@11.7.0',
            dependencies: { '@posthog/electron': 'file:./electron.tgz' },
        })
    )
    await writeFile(
        join(directory, 'pnpm-workspace.yaml'),
        "packages: []\nminimumReleaseAge: 10080\nautoInstallPeers: false\noverrides:\n  '@posthog/core': file:./core.tgz\n  '@posthog/types': file:./types.tgz\n  '@posthog/browser-common': file:./browser-common.tgz\n"
    )
    run(pnpm, ['install', '--ignore-scripts', '--config.minimum-release-age=10080'], { cwd: directory })
    // Bundle only the installed consumer; no SDK source aliases or workspace symlinks.
    await build({
        entryPoints: [join(directory, 'renderer.js')],
        outfile: join(directory, 'renderer-bundle.js'),
        bundle: true,
        platform: 'browser',
        format: 'iife',
        target: 'chrome148',
    })

    // Separate Node children prove the exact monitor binding preserves real native fatal/warning behavior.
    // This supplements (not substitutes for) the installed-package Electron scenarios below.
    await build({
        entryPoints: [join(root, 'src/main/exception-autocapture.ts')],
        outfile: join(directory, 'process-observer.cjs'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
    })
    for (const [scenario, mode, code, captures] of [
        ['throw', 'throw', 1, 1],
        ['reject', 'throw', 1, 1],
        ['reject', 'strict', 1, 1],
        ['reject', 'warn', 0, 0],
        ['reject', 'warn-with-error-code', 1, 0],
        ['reject', 'none', 0, 0],
        ['host-once', 'throw', 1, 1],
    ]) {
        const execute = (enabled) =>
            spawnSync(process.execPath, [`--unhandled-rejections=${mode}`, join(directory, 'process.cjs'), scenario], {
                encoding: 'utf8',
                timeout: 10000,
                env: { ...env, FIXTURE_ENABLED: String(enabled) },
            })
        const baseline = execute(false),
            observed = execute(true)
        assert.equal(baseline.error, undefined)
        assert.equal(observed.error, undefined)
        assert.equal(baseline.status, code, `${scenario}/${mode}: baseline exit`)
        assert.equal(observed.status, code, `${scenario}/${mode}: observed exit`)
        const normalize = (text) => text.replace(/\(node:\d+\)/g, '(node:PID)')
        assert.equal(normalize(observed.stderr), normalize(baseline.stderr), 'native diagnostics must not change')
        assert.equal(observed.stdout.split('\n').filter((line) => line.startsWith('{"capture":')).length, captures)
        if (scenario === 'host-once') {
            assert.ok(observed.stdout.includes('host handled first rejection'))
            assert.ok(baseline.stdout.includes('host handled first rejection'))
        }
        console.log(
            `Native Node ${scenario}/${mode}: unchanged exit ${code} and diagnostics; ${captures} monitor captures.`
        )
    }

    const reports = []
    for (const enabled of [false, true]) {
        const events = [],
            paths = [],
            receiverErrors = []
        const server = createServer(async (request, response) => {
            try {
                const chunks = []
                for await (const chunk of request) chunks.push(chunk)
                const body = JSON.parse(Buffer.concat(chunks).toString())
                paths.push(request.url)
                assert.equal(request.method, 'POST')
                assert.equal(body.api_key, 'phc_electron_error_fixture')
                assert.match(request.url, /^\/(batch|capture|e)\/?$/)
                assert.ok(Array.isArray(body.batch))
                events.push(...body.batch)
                response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":1}')
            } catch (error) {
                receiverErrors.push(String(error))
                response.writeHead(400).end('{}')
            }
        })
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
        const host = `http://127.0.0.1:${server.address().port}`
        const reportPath = join(directory, `report-${enabled}.json`)
        const userData = join(directory, `user-data-${enabled}`)
        try {
            await new Promise((resolve, reject) => {
                const child = spawn(electron, [directory], {
                    cwd: directory,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    env: {
                        ...env,
                        FIXTURE_HOST: host,
                        FIXTURE_ENABLED: String(enabled),
                        FIXTURE_REPORT: reportPath,
                        FIXTURE_USER_DATA: userData,
                    },
                })
                let output = '',
                    timedOut = false,
                    killTimer
                child.stdout.on('data', (data) => {
                    output += data
                })
                child.stderr.on('data', (data) => {
                    output += data
                })
                const timer = setTimeout(() => {
                    timedOut = true
                    child.kill('SIGTERM')
                    killTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
                }, 45000)
                child.once('error', (error) => {
                    clearTimeout(timer)
                    reject(error)
                })
                child.once('close', (code, signal) => {
                    clearTimeout(timer)
                    clearTimeout(killTimer)
                    if (timedOut || code !== 0)
                        reject(
                            new Error(
                                `Electron enabled=${enabled}: exit ${code}/${signal}, timeout=${timedOut}\n${output}`
                            )
                        )
                    else resolve()
                })
            })
            assert.deepEqual(receiverErrors, [])
            const report = JSON.parse(await readFile(reportPath, 'utf8'))
            reports.push(report)
            assert.deepEqual(report.unexpectedNetwork, [])
            assert.ok(paths.length > 0)
            assert.deepEqual(
                events.filter((event) => event.event !== '$exception').map((event) => event.event),
                ['$identify']
            )
            const exceptionEvents = events.filter((event) => event.event === '$exception')
            assert.equal(exceptionEvents.length, enabled ? 7 : 2)
            const expected = [
                ['main manual', 'main', 'generic', undefined, 'SyntaxError'],
                ['renderer manual', 'renderer', 'generic', undefined, 'SyntaxError'],
                ...(enabled
                    ? [
                          [
                              'main initial throw',
                              'main',
                              'onuncaughtexception',
                              'node.process_uncaught_exception',
                              'TypeError',
                          ],
                          ['renderer initial throw', 'renderer', 'onerror', 'browser.window_onerror', 'TypeError'],
                          [
                              'renderer initial rejection',
                              'renderer',
                              'onunhandledrejection',
                              'browser.unhandledrejection',
                              'RangeError',
                          ],
                          [
                              'renderer reinitialized throw',
                              'renderer',
                              'onerror',
                              'browser.window_onerror',
                              'TypeError',
                          ],
                          [
                              'renderer reinitialized rejection',
                              'renderer',
                              'onunhandledrejection',
                              'browser.unhandledrejection',
                              'RangeError',
                          ],
                      ]
                    : []),
            ]
            for (const [message, processType, mechanism, source, type] of expected) {
                const matching = exceptionEvents.filter(
                    (event) => event.properties.$exception_list[0].value === message
                )
                assert.equal(matching.length, 1, `exactly one ${message}`)
                const event = matching[0],
                    detail = event.properties.$exception_list[0]
                assert.equal(event.event, '$exception')
                assert.equal(event.distinct_id, 'electron-error-user')
                assert.ok(event.properties.$session_id)
                assert.equal(event.properties.$electron_process, processType)
                if (processType === 'renderer') assert.ok(event.properties.$window_id)
                assert.equal(event.properties.$exception_source, source)
                assert.equal(detail.type, type)
                assert.equal(detail.mechanism.type, mechanism)
                assert.equal(detail.mechanism.handled, mechanism === 'generic')
                assert.ok(detail.stacktrace.frames.length > 0)
                if (mechanism !== 'generic') {
                    const crash = detail.stacktrace.frames.at(-1)
                    assert.match(
                        crash.function,
                        processType === 'main'
                            ? /^(?:Timeout\.)?main(Throw|Rejection)(?: \[as _onTimeout\])?$/
                            : /^renderer(Throw|Rejection)$/
                    )
                }
            }
            assert.equal(new Set(exceptionEvents.map((event) => event.properties.$session_id)).size, 1)
            console.log(
                `Installed Electron enabled=${enabled}: ${exceptionEvents.length} wire exceptions; real sandboxed JS throws/rejections, consent, disposal and reinit passed.`
            )
        } finally {
            await new Promise((resolve) => server.close(resolve))
        }
    }
    const [baseline, observed] = reports
    assert.deepEqual(baseline.hostEvents, observed.hostEvents, 'main app handlers see identical real events')
    assert.deepEqual(baseline.warnings, observed.warnings, 'native Electron warnings remain unchanged')
    assert.deepEqual(
        baseline.renderer,
        observed.renderer,
        'renderer handlers and uncancelled native events are unchanged'
    )
    console.log(
        'Not exercised: fatal Electron app termination/delivery (Electron installs its own uncaught handler); Node fatal behavior is compared above. No native crash capture is claimed.'
    )
    passed = true
} finally {
    if (passed) await rm(directory, { recursive: true, force: true })
    else console.error(`Error fixture artifacts retained at ${directory}`)
}
