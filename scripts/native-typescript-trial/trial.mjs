import { stripVTControlCharacters } from 'node:util'
import { performance } from 'node:perf_hooks'
import { buildTrial } from './build-trial.mjs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir, cpus, platform, arch, release, totalmem } from 'node:os'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const mode = process.argv[2]
if (!['verify', 'benchmark'].includes(mode)) throw new Error('Usage: node trial.mjs verify|benchmark [report.json]')
if (mode === 'benchmark' && !process.env.TRIAL_QUIET_WINDOW)
    throw new Error('Set TRIAL_QUIET_WINDOW to the evidence that other builds have stopped before timing')
const runs = Number(process.env.TRIAL_RUNS ?? 5)
if (!Number.isInteger(runs) || runs < 3) throw new Error('TRIAL_RUNS must be an integer >= 3')
const output = resolve(process.argv[3] ?? join(tmpdir(), `native-typescript-${mode}.json`))
const scratch = mkdtempSync(join(tmpdir(), 'native-typescript-trial-'))
const packages = ['types', 'core', 'plugin-utils']
const temporaryConfigs = []
const compilers = {
    tsc: join(root, 'node_modules/typescript/bin/tsc'),
    nextPreview: join(root, 'packages/next/node_modules/@typescript/native-preview/bin/tsgo.js'),
    currentPreview: join(here, 'node_modules/@typescript/native-preview/bin/tsgo'),
}
function execute(command, args, cwd = root, timed = false) {
    const start = timed ? performance.now() : null
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
    if (result.error || result.signal) throw result.error ?? new Error(`Process killed: ${result.signal}`)
    return {
        command: [command === process.execPath ? 'node' : command, ...args].map((x) =>
            x.replaceAll(root, '<repo>').replaceAll(scratch, '<scratch>')
        ),
        status: result.status,
        diagnostics: stripVTControlCharacters(result.stdout + result.stderr)
            .replaceAll(root, '<repo>')
            .replaceAll(scratch, '<scratch>'),
        ...(timed ? { ms: performance.now() - start } : {}),
    }
}
function compile(
    compiler,
    pkg,
    extra = [],
    timed = false,
    config = join(root, 'packages', pkg, 'tsconfig.build.json')
) {
    return execute(
        process.execPath,
        [compilers[compiler], '-p', config, '--pretty', 'false', '--incremental', 'false', ...extra],
        root,
        timed
    )
}
function files(dir) {
    return Object.fromEntries(
        readdirSync(dir, { recursive: true, withFileTypes: true })
            .filter((x) => x.isFile())
            .map((x) => {
                const path = join(x.parentPath, x.name)
                return [relative(dir, path), createHash('sha256').update(readFileSync(path)).digest('hex')]
            })
            .sort(([a], [b]) => a.localeCompare(b))
    )
}
function median(samples) {
    const sorted = [...samples].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const report = {
    mode,
    complete: false,
    quietWindow: process.env.TRIAL_QUIET_WINDOW ?? null,
    date: new Date().toISOString(),
    commit: execute('git', ['rev-parse', 'HEAD']).diagnostics.trim(),
    trialLockfileSha256: createHash('sha256')
        .update(readFileSync(join(here, 'pnpm-lock.yaml')))
        .digest('hex'),
    lockfileSha256: createHash('sha256')
        .update(readFileSync(join(root, 'pnpm-lock.yaml')))
        .digest('hex'),
    host: {
        node: process.version,
        pnpm: execute('pnpm', ['--version']).diagnostics.trim(),
        platform: platform(),
        arch: arch(),
        release: release(),
        cpu: cpus()[0].model,
        logicalCpus: cpus().length,
        memoryBytes: totalmem(),
    },
    versions: Object.fromEntries(
        Object.entries(compilers).map(([name, path]) => [name, execute(process.execPath, [path, '--version'])])
    ),
    results: [],
}
try {
    for (const [compiler, version] of Object.entries(report.versions)) {
        if (version.status !== 0) throw new Error(`${compiler} is unavailable; install both workspaces first`)
    }
    if (mode === 'verify') {
        for (const pkg of packages) {
            const emitted = {}
            for (const compiler of Object.keys(compilers)) {
                const check = compile(compiler, pkg, ['--noEmit'])
                if (compiler === 'tsc' && check.status !== 0) throw new Error(`Baseline failed: ${check.diagnostics}`)
                const dest = join(scratch, pkg, compiler)
                mkdirSync(dest, { recursive: true })
                const emit = compile(compiler, pkg, [
                    '--outDir',
                    dest,
                    '--sourceMap',
                    'false',
                    '--declarationMap',
                    'false',
                ])
                emitted[compiler] = files(dest)
                if (pkg === 'types' && emit.status === 0) {
                    const consumer = join(scratch, `consumer-${compiler}.json`)
                    writeFileSync(
                        consumer,
                        JSON.stringify({
                            compilerOptions: {
                                strict: true,
                                skipLibCheck: false,
                                noEmit: true,
                                types: [],
                                lib: ['es2022', 'dom'],
                                moduleResolution: 'node',
                            },
                            files: [join(dest, 'index.d.ts')],
                        })
                    )
                    const minimumConsumer = execute(process.execPath, [
                        join(here, 'node_modules/typescript-min/bin/tsc'),
                        '-p',
                        consumer,
                        '--pretty',
                        'false',
                    ])
                    report.results.push({ pkg, compiler, operation: 'typescript-4.7.4-consumer', ...minimumConsumer })
                    if (minimumConsumer.status !== 0)
                        throw new Error(`Minimum consumer failed: ${minimumConsumer.diagnostics}`)
                }
                const canary = join(scratch, 'canary.ts')
                writeFileSync(canary, 'export const mustFail: string = 123\n')
                const config = join(root, 'packages', pkg, `.native-trial-${process.pid}.json`)
                temporaryConfigs.push(config)
                writeFileSync(
                    config,
                    JSON.stringify({
                        extends: join(root, 'packages', pkg, 'tsconfig.build.json'),
                        compilerOptions: { rootDir: '/' },
                        files: [canary],
                    })
                )
                const negative = compile(compiler, pkg, ['--noEmit'], false, config)
                const semanticCanary = negative.status !== 0 && /canary\.ts.*error TS2322/.test(negative.diagnostics)
                report.results.push({ pkg, compiler, check, emit, semanticCanary, negative, files: emitted[compiler] })
                if (check.status === 0 && !semanticCanary)
                    throw new Error(`${compiler}/${pkg} did not reject semantic canary`)
            }
            for (const compiler of Object.keys(compilers).filter((x) => x !== 'tsc')) {
                const names = [...new Set([...Object.keys(emitted.tsc), ...Object.keys(emitted[compiler])])]
                report.results.push({
                    pkg,
                    compiler,
                    outputParity: names.filter((name) => emitted.tsc[name] !== emitted[compiler][name]),
                    baselineFileCount: Object.keys(emitted.tsc).length,
                    candidateFileCount: Object.keys(emitted[compiler]).length,
                })
            }
        }
    } else {
        report.runs = runs
        report.cacheSemantics =
            'Each sample is a fresh process; incremental=false. First timed sample follows an untimed eligibility check, so is not OS-cache cold. Warm samples follow one unmeasured priming run per command. OS caches are never flushed. Compiler order rotates each round. Emit outputs are removed before each run. Rslib builds bypass Turbo and use fresh temporary outputs; dependencies stay built. CLI compiler order rotates; Rslib compiler runs are grouped, so order bias remains possible.'
        for (const pkg of packages) {
            for (const operation of ['check', 'emit']) {
                const rows = Object.fromEntries(
                    Object.keys(compilers).map((compiler) => [compiler, { pkg, operation, compiler, samplesMs: [] }])
                )
                const run = (compiler, timed) => {
                    const dest = join(scratch, pkg, compiler)
                    rmSync(dest, { recursive: true, force: true })
                    return compile(
                        compiler,
                        pkg,
                        operation === 'check'
                            ? ['--noEmit']
                            : ['--outDir', dest, '--sourceMap', 'false', '--declarationMap', 'false'],
                        timed
                    )
                }
                for (const compiler of Object.keys(compilers)) {
                    const eligibility = run(compiler, false)
                    if (eligibility.status !== 0) {
                        if (compiler === 'tsc') throw new Error(`Baseline failed: ${eligibility.diagnostics}`)
                        rows[compiler].ineligible = eligibility
                        continue
                    }
                    rows[compiler].firstObserved = run(compiler, true)
                    run(compiler, false)
                }
                for (let i = 0; i < runs; i++) {
                    const names = Object.keys(compilers)
                    for (let j = 0; j < names.length; j++) {
                        const compiler = names[(i + j) % names.length]
                        if (rows[compiler].ineligible) continue
                        const sample = run(compiler, true)
                        if (sample.status !== 0)
                            throw new Error(`Refusing to benchmark failed check: ${JSON.stringify(sample)}`)
                        rows[compiler].samplesMs.push(sample.ms)
                    }
                }
                report.results.push(
                    ...Object.values(rows).map((row) => ({
                        ...row,
                        medianMs: row.samplesMs.length ? median(row.samplesMs) : null,
                    }))
                )
            }
        }
    }
    for (const pkg of packages) {
        const artifacts = {}
        for (const compiler of Object.keys(compilers)) {
            const run = (timed = false, negative = false) =>
                buildTrial({ root, here, scratch, pkg, compiler, execute, timed, negative, files })
            const eligibility = run()
            if (compiler === 'tsc' && eligibility.status !== 0)
                throw new Error(`Baseline build failed: ${eligibility.diagnostics}`)
            artifacts[compiler] = eligibility.files
            if (mode === 'verify') {
                const negative = eligibility.status === 0 ? run(false, true) : null
                report.results.push({ pkg, compiler, operation: 'rslib-build', ...eligibility, negative })
                if (negative && !negative.semanticCanary)
                    throw new Error(`${pkg}/${compiler} build lost semantic validation`)
            } else if (eligibility.status === 0) {
                const firstObserved = run(true)
                run()
                const samplesMs = []
                for (let i = 0; i < runs; i++) {
                    const sample = run(true)
                    if (sample.status !== 0) throw new Error(`Build sample failed: ${sample.diagnostics}`)
                    samplesMs.push(sample.ms)
                }
                report.results.push({
                    pkg,
                    compiler,
                    operation: 'rslib-build',
                    productionTypescript: eligibility.productionTypescript,
                    firstObserved,
                    samplesMs,
                    medianMs: median(samplesMs),
                })
            } else report.results.push({ pkg, compiler, operation: 'rslib-build', ineligible: eligibility })
        }
        if (mode === 'verify')
            for (const compiler of ['nextPreview', 'currentPreview']) {
                const names = [...new Set([...Object.keys(artifacts.tsc), ...Object.keys(artifacts[compiler])])]
                report.results.push({
                    pkg,
                    compiler,
                    operation: 'rslib-parity',
                    comparedFiles: names.filter((x) => !x.endsWith('.map')).length,
                    differingMaps: names.filter(
                        (x) => x.endsWith('.map') && artifacts.tsc[x] !== artifacts[compiler][x]
                    ),
                    differingFiles: names.filter(
                        (x) => !x.endsWith('.map') && artifacts.tsc[x] !== artifacts[compiler][x]
                    ),
                })
            }
    }
    report.complete = true
    report.completedAt = new Date().toISOString()
} finally {
    writeFileSync(
        output,
        JSON.stringify(
            report,
            (key, value) =>
                key === 'files'
                    ? {
                          count: Object.keys(value).length,
                          sha256: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
                      }
                    : value,
            2
        ) + '\n'
    )
    rmSync(scratch, { recursive: true, force: true })
    for (const config of temporaryConfigs) rmSync(config, { force: true })
    process.stdout.write(`Report: ${output}\n`)
}
