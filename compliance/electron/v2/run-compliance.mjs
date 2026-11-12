// Native macOS + OrbStack hybrid. This network is deliberately not claimed hermetic.
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const directory = fileURLToPath(new URL('.', import.meta.url))
export const harnessImage =
    'ghcr.io/posthog/sdk-test-harness-v2@sha256:c1e36d011ec4dec0102fb52b5e6fd3b156b0de9251e0d6b735385876d9a897b4'
export const specsRevision = '4a9e0e7005260dbd198cd67c6ab6579c64679913'
const [profile, scope, destination] = process.argv.slice(2)
if (
    !['electron-main', 'electron-renderer'].includes(profile) ||
    !['published', 'supplemental'].includes(scope) ||
    !destination ||
    !process.env.POSTHOG_ELECTRON_CONSUMER
)
    throw new Error(
        'POSTHOG_ELECTRON_CONSUMER=... [SDK_SPECS=...] node run-compliance.mjs electron-main|electron-renderer published|supplemental NEW_REPORT_DIRECTORY'
    )
if (process.platform !== 'darwin')
    throw new Error(
        'This hybrid runner is verified only on macOS/OrbStack; Linux sandbox/Xvfb runner is not implemented'
    )
const consumer = resolve(process.env.POSTHOG_ELECTRON_CONSUMER)
const output = resolve(destination)
mkdirSync(output)
copyFileSync(join(consumer, 'build.json'), join(output, 'build.json'))
const identity = randomUUID()
const network = `electron-compliance-${identity}`
const container = `${network}-harness`
const command = (milliseconds, args, name) => {
    try {
        const stdout = execFileSync(
            process.execPath,
            [join(directory, 'run-command.mjs'), String(milliseconds), 'docker', ...args],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 }
        )
        writeFileSync(join(output, `${name}.log`), stdout)
        writeFileSync(join(output, `${name}.exit`), '0\n')
        return 0
    } catch (error) {
        writeFileSync(join(output, `${name}.log`), (error.stdout ?? '') + (error.stderr ?? '') + (error.message ?? ''))
        const code = error.status ?? 1
        writeFileSync(join(output, `${name}.exit`), `${code}\n`)
        return code
    }
}
let adapter,
    lines,
    created = false
let result = 1
try {
    let specs = join(directory, 'features')
    if (scope === 'published') {
        if (!process.env.SDK_SPECS) throw new Error('SDK_SPECS checkout with pinned Git object required')
        specs = join(output, 'specs')
        mkdirSync(specs)
        const archive = execFileSync('git', ['-C', process.env.SDK_SPECS, 'archive', specsRevision], {
            maxBuffer: 100 * 1024 * 1024,
        })
        execFileSync('tar', ['-xf', '-', '-C', specs], { input: archive })
    }
    writeFileSync(
        join(output, 'provenance.json'),
        JSON.stringify(
            {
                purpose:
                    scope === 'published'
                        ? 'Unchanged published acceptance inventory; strict failures are not suppressed'
                        : 'SDK-owned supplemental integration, NOT published conformance',
                specs_revision: scope === 'published' ? specsRevision : null,
                harness_image: harnessImage,
                adapter_revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
                adapter_status: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }),
                adapter_files: Object.fromEntries(
                    readdirSync(directory, { recursive: true, withFileTypes: true })
                        .filter((entry) => entry.isFile())
                        .map((entry) => {
                            const path = join(entry.parentPath, entry.name)
                            return [
                                path.slice(directory.length),
                                createHash('sha256').update(readFileSync(path)).digest('hex'),
                            ]
                        })
                ),
                network: {
                    name: network,
                    internal: false,
                    adapter_bind: '127.0.0.1',
                    mock_routing: 'Native OrbStack routes container private IPv4',
                    limitation:
                        'Not egress-isolated or hermetic; Electron SDK session permits only exact private mock HTTP origin',
                },
            },
            null,
            2
        ) + '\n'
    )
    adapter = spawn(process.execPath, [join(directory, 'server.mjs')], {
        env: { ...process.env, POSTHOG_ELECTRON_CONSUMER: consumer, HOST: '127.0.0.1', PORT: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const log = []
    adapter.stdout.on('data', (data) => log.push(data.toString()))
    adapter.stderr.on('data', (data) => log.push(data.toString()))
    lines = createInterface({ input: adapter.stdout })
    const startup = await new Promise((resolveStartup, reject) => {
        const timer = setTimeout(() => reject(new Error('Adapter startup deadline exceeded')), 5000)
        const done = (callback) => (value) => {
            clearTimeout(timer)
            callback(value)
        }
        lines.once(
            'line',
            done((line) => {
                try {
                    resolveStartup(JSON.parse(line))
                } catch (error) {
                    reject(error)
                }
            })
        )
        adapter.once('error', done(reject))
        adapter.once(
            'exit',
            done(() => reject(new Error('Adapter exited before startup')))
        )
    })
    writeFileSync(join(output, 'startup.json'), JSON.stringify(startup) + '\n')
    adapter.once('close', () => writeFileSync(join(output, 'adapter.log'), log.join('')))
    if (command(30000, ['network', 'create', network], 'network-create') !== 0)
        throw new Error('Network creation failed')
    created = true
    // No host ports are published. OrbStack routes native Electron to the per-case
    // private container listener; host.docker.internal routes the reverse direction.
    const run = command(
        1200000,
        [
            'run',
            '--rm',
            '--name',
            container,
            '--network',
            network,
            '--mount',
            `type=bind,src=${specs},dst=/specs,readonly`,
            '--mount',
            `type=bind,src=${output},dst=/reports`,
            '--entrypoint',
            'sh',
            harnessImage,
            '-c',
            `exec posthog-test-harness-v2 run --specs /specs --all-features --adapter-url http://host.docker.internal:${startup.port} --allow-private-network --mock-bind-host 0.0.0.0 --mock-advertised-host "$(hostname -i)" --profile ${profile} --timeout-ms 15000 --report /reports/report.json`,
        ],
        'run'
    )
    const check = command(
        30000,
        [
            'run',
            '--rm',
            '--network',
            'none',
            '--mount',
            `type=bind,src=${output},dst=/reports,readonly`,
            harnessImage,
            'check-report',
            '--report',
            '/reports/report.json',
            '--profile',
            profile,
        ],
        'check-report'
    )
    const report = JSON.parse(readFileSync(join(output, 'report.json')))
    const selected = report.inventory.filter((row) => row.selected && row.applicability.kind === 'applicable').length
    const executed = report.results.filter((row) => row.result.executed).length
    writeFileSync(
        join(output, 'counts.json'),
        JSON.stringify(
            { selected, executed, inventory: report.inventory.length, results: report.results.length },
            null,
            2
        ) + '\n'
    )
    result = run === 0 && check === 0 && selected > 0 && executed > 0 ? 0 : 1
} finally {
    if (adapter) {
        const exited = once(adapter, 'close')
        adapter.kill('SIGTERM')
        const kill = setTimeout(() => adapter.kill('SIGKILL'), 5000)
        await exited
        clearTimeout(kill)
        lines?.close()
    }
    if (created) {
        // Only our uniquely named resources; a timed-out run may still own its container.
        const query = command(
            30000,
            ['ps', '--all', '--quiet', '--filter', `name=^/${container}$`],
            'container-cleanup-query'
        )
        if (query !== 0) result = 1
        else if (readFileSync(join(output, 'container-cleanup-query.log'), 'utf8').trim()) {
            if (command(30000, ['rm', '--force', container], 'container-cleanup') !== 0) result = 1
        }
        if (command(30000, ['network', 'rm', network], 'network-cleanup') !== 0) result = 1
    }
    writeFileSync(join(output, 'wrapper.exit'), `${result}\n`)
}
process.exitCode = result
